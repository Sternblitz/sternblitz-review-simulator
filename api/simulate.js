// Datei: api/simulate.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  const placeId = req.query.placeId || req.query.place_id;
  const apiKey = process.env.OUTSCRAPER_API_KEY;

  console.log("simulate called", { placeId, hasKey: !!apiKey, method: req.method });

  if (!placeId || !apiKey) {
    return res
      .status(400)
      .json({ error: "Missing placeId or Outscraper API key", placeId, hasKey: !!apiKey });
  }

  const url = `https://api.outscraper.cloud/maps/reviews-v3?query=${encodeURIComponent(
    "place_id:" + placeId
  )}&reviewsLimit=0`;

  let resp;
  let text;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });
  } catch (err) {
    console.error("Network error contacting Outscraper:", err);
    return res
      .status(500)
      .json({ error: "Network error contacting Outscraper", details: err.message });
  }

  try {
    text = await resp.text();
  } catch (e) {
    console.error("Failed to read response text:", e);
    return res.status(502).json({ error: "Failed to read Outscraper response", details: e.message });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error("Invalid JSON from Outscraper:", text);
    return res.status(502).json({ error: "Invalid JSON from Outscraper", raw: text });
  }

  if (!resp.ok || data.error) {
    console.error("Outscraper returned error", resp.status, data);
    return res.status(502).json({
      error: "Outscraper returned non-ok",
      status: resp.status,
      body: data,
    });
  }

  const placeData = Array.isArray(data.data) ? data.data[0] : null;
  if (!placeData) {
    console.error("Missing place data in Outscraper response", data);
    return res.status(500).json({ error: "Missing place data", raw: data });
  }

  const rawBreakdown = placeData.reviews_per_score || {};
  const breakdown = {
    1: parseInt(rawBreakdown["1"] || 0, 10),
    2: parseInt(rawBreakdown["2"] || 0, 10),
    3: parseInt(rawBreakdown["3"] || 0, 10),
    4: parseInt(rawBreakdown["4"] || 0, 10),
    5: parseInt(rawBreakdown["5"] || 0, 10),
  };

  const totalReviews =
    typeof placeData.reviews === "number" && placeData.reviews > 0
      ? placeData.reviews
      : Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  let averageRating = parseFloat(placeData.rating) || 0;
  if ((!averageRating || averageRating === 0) && totalReviews > 0) {
    const weighted =
      breakdown[1] * 1 +
      breakdown[2] * 2 +
      breakdown[3] * 3 +
      breakdown[4] * 4 +
      breakdown[5] * 5;
    averageRating = weighted / totalReviews;
  }

  return res.status(200).json({
    placeId,
    totalReviews,
    averageRating: parseFloat(averageRating.toFixed(2)),
    breakdown,
  });
}
