// Datei: api/simulate.js
export default async function handler(req, res) {
  // CORS (für Webflow o.ä.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const placeId = req.query.placeId || req.query.place_id;
  const apiKey = process.env.OUTSCRAPER_API_KEY;

  if (!placeId || !apiKey) {
    return res.status(400).json({ error: "Missing placeId or Outscraper API key" });
  }

  // Outscraper erwartet bei gezielter Place-ID z.B. "place_id:ChIJS-..."
  const queryString = `place_id:${placeId}`;

  try {
    const resp = await fetch("https://api.outscraper.cloud/maps/reviews-v3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        query: [queryString],
        reviewsLimit: 0, // 0 = unlimited, damit breakdown genau ist
        language: "de", // optional, kannst du anpassen
      }),
    });

    const rawText = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }

    if (!resp.ok) {
      return res.status(502).json({
        error: "Outscraper error",
        status: resp.status,
        body: rawText,
      });
    }

    const placeData = Array.isArray(parsed?.data) ? parsed.data[0] : null;
    if (!placeData) {
      return res.status(500).json({
        error: "Unexpected Outscraper response format",
        raw: parsed,
      });
    }

    // Breakdown aus reviews_per_score (falls vorhanden)
    const rawBreakdown = placeData.reviews_per_score || {};
    const breakdown = {
      1: parseInt(rawBreakdown["1"] || 0, 10),
      2: parseInt(rawBreakdown["2"] || 0, 10),
      3: parseInt(rawBreakdown["3"] || 0, 10),
      4: parseInt(rawBreakdown["4"] || 0, 10),
      5: parseInt(rawBreakdown["5"] || 0, 10),
    };

    // Gesamtanzahl Reviews: entweder das Feld oder Summe der Breakdown-Werte
    const totalReviews =
      typeof placeData.reviews === "number" && placeData.reviews > 0
        ? placeData.reviews
        : Object.values(breakdown).reduce((sum, v) => sum + v, 0);

    // Durchschnitt: bevorzugt das vom API gegebene rating, sonst berechnen
    let averageRating = parseFloat(placeData.rating || 0);
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
      averageRating: parseFloat((averageRating || 0).toFixed(2)),
      breakdown,
      source: { usedOutscraper: true },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Exception calling Outscraper", details: err.message });
  }
}
