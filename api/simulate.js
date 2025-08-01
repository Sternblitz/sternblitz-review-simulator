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

  const baseUrl = `https://api.outscraper.cloud/maps/reviews-v3?query=${encodeURIComponent(
    "place_id:" + placeId
  )}&reviewsLimit=0`;

  const headers = {
    "X-API-KEY": apiKey,
    Accept: "application/json",
  };

  let initialResp;
  let text;
  try {
    initialResp = await fetch(baseUrl, { method: "GET", headers });
  } catch (err) {
    console.error("Network error contacting Outscraper:", err);
    return res.status(500).json({ error: "Network error contacting Outscraper", details: err.message });
  }

  try {
    text = await initialResp.text();
  } catch (e) {
    console.error("Failed to read initial response text:", e);
    return res.status(502).json({ error: "Failed to read Outscraper initial response", details: e.message });
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error("Invalid JSON from Outscraper initial:", text);
    return res.status(502).json({ error: "Invalid JSON from Outscraper initial", raw: text });
  }

  // Wenn Pending, pollen
  if (json.status === "Pending" && json.results_location) {
    let attempts = 0;
    const maxAttempts = 10;
    const delay = 500; // ms

    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, delay));
      let pollResp;
      let pollText;
      try {
        pollResp = await fetch(json.results_location, { method: "GET", headers });
        pollText = await pollResp.text();
      } catch (err) {
        console.error("Error polling Outscraper:", err);
        return res.status(502).json({ error: "Error polling Outscraper", details: err.message });
      }

      let pollJson;
      try {
        pollJson = JSON.parse(pollText);
      } catch (e) {
        console.error("Invalid JSON during polling:", pollText);
        return res.status(502).json({ error: "Invalid JSON during polling", raw: pollText });
      }

      if (pollJson.status && pollJson.status !== "Pending") {
        json = pollJson; // aktualisieren auf fertige Antwort
        break;
      }

      attempts++;
    }

    if (json.status === "Pending") {
      // noch nicht fertig nach retries
      return res.status(202).json({
        error: "Outscraper job still pending",
        note: "Bitte in ein paar hundert Millisekunden nochmal anfragen oder retry-Logik einbauen.",
      });
    }
  }

  if (json.status !== "Success") {
    console.error("Outscraper final returned non-success", json);
    return res.status(502).json({
      error: "Outscraper returned non-success status",
      status: json.status,
      body: json,
    });
  }

  const placeData = Array.isArray(json.data) ? json.data[0] : null;
  if (!placeData) {
    console.error("Missing place data after polling", json);
    return res.status(500).json({ error: "Missing place data", raw: json });
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
    source: { usedOutscraper: true },
  });
}
