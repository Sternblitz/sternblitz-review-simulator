// Datei: api/simulate.js
// Erwartet: Environment Variable OUTSCRAPER_API_KEY mit deinem Outscraper-Key

export default async function handler(req, res) {
  // CORS erlauben (für Webflow etc.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // für Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const placeId = req.query.placeId || req.query.place_id;
  const outscraperKey = process.env.OUTSCRAPER_API_KEY;

  if (!placeId || !outscraperKey) {
    return res.status(400).json({ error: "Missing placeId or Outscraper API key" });
  }

  // Google Maps Place URL, wie Outscraper sie erwartet
  const placeUrl = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

  try {
    const resp = await fetch("https://api.outscraper.com/maps/reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": outscraperKey,
      },
      body: JSON.stringify({
        queries: [placeUrl],
        // optional: language: "de"  // wenn du deutsche Ausgabe willst
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(502).json({ error: "Outscraper error", details: text });
    }

    const data = await resp.json();
    const place = Array.isArray(data) ? data[0] : data;

    // normalization: breakdown aus reviews_per_score
    const raw = place.reviews_per_score || {};
    const breakdown = {
      1: parseInt(raw["1"] || 0, 10),
      2: parseInt(raw["2"] || 0, 10),
      3: parseInt(raw["3"] || 0, 10),
      4: parseInt(raw["4"] || 0, 10),
      5: parseInt(raw["5"] || 0, 10),
    };

    // totalReviews: entweder direkt oder Summe aus breakdown
    const totalReviews =
      typeof place.reviews === "number" && place.reviews > 0
        ? place.reviews
        : Object.values(breakdown).reduce((sum, v) => sum + v, 0);

    // averageRating: nehmen, falls vorhanden, sonst selbst berechnen
    let averageRating = parseFloat(place.rating || 0);
    if ((!averageRating || averageRating === 0) && totalReviews > 0) {
      const weightedSum =
        breakdown[1] * 1 +
        breakdown[2] * 2 +
        breakdown[3] * 3 +
        breakdown[4] * 4 +
        breakdown[5] * 5;
      averageRating = weightedSum / totalReviews;
    }

    return res.status(200).json({
      placeId,
      totalReviews,
      averageRating: parseFloat(averageRating.toFixed(2)),
      breakdown,
      source: { usedOutscraper: true },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Failed to fetch from Outscraper", details: error.message });
  }
}
