// Datei: api/simulate.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  const placeId = req.query.placeId || req.query.place_id;
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!placeId || !apiKey) {
    return res.status(400).json({ error: "Missing placeId or Outscraper API key" });
  }

  try {
    const resp = await fetch("https://api.outscraper.cloud/maps/reviews-v3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        query: [`place_id:${placeId}`],
        reviewsLimit: 0, // unbegrenzt, damit breakdown vollständig ist
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(502).json({ error: "Outscraper error", details: data });
    }

    const placeData = Array.isArray(data?.data) ? data.data[0] : null;
    if (!placeData) {
      return res.status(500).json({ error: "Unexpected response format", raw: data });
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
      const weighted = breakdown[1] * 1 +
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
  } catch (err) {
    return res.status(500).json({ error: "Exception calling Outscraper", details: err.message });
  }
}
