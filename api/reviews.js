// api/reviews.js
export default async function handler(req, res) {
  // erlaubt einfache CORS-Tests aus dem Browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    // Preflight
    return res.status(204).end();
  }

  const { placeId, name, address } = req.query;
  const key = process.env.OUTSCRAPER_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing Outscraper API key" });

  if (!name && !placeId) {
    return res.status(400).json({ error: "Provide at least placeId or name (plus optional address)" });
  }

  // Baue die Query: wenn Name vorhanden, nutze "Name, Address", sonst fallback auf placeId
 let queryStr;
if (placeId) {
  queryStr = `place_id:${placeId}`;
} else {
  queryStr = name + (address ? `, ${address}` : "");
}

  const url = new URL("https://api.app.outscraper.com/maps/search-v3");
  url.searchParams.set("query", queryStr);
  url.searchParams.set("language", "en");
  url.searchParams.set("organizationsPerQueryLimit", "1");
  url.searchParams.set("async", "false");

  const headers = {
    "X-Api-Key": key,
    Accept: "application/json",
  };

  try {
    const out = await fetch(url.toString(), { method: "GET", headers });
    if (!out.ok) {
      const txt = await out.text();
      return res.status(502).json({ error: "Outscraper search-v3 failed", details: txt });
    }
    const json = await out.json();

    // Suche das erste Place-Objekt
    const first = Array.isArray(json.data) && Array.isArray(json.data[0]) ? json.data[0][0] : null;
    if (!first) {
      return res.status(404).json({ error: "Place not found in search-v3 response", raw: json });
    }

    // Breakdown vorbereiten
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (first.reviews_per_score) {
      for (let i = 1; i <= 5; i++) {
        breakdown[i] = Number(first.reviews_per_score[i] || 0);
      }
    } else if (Array.isArray(first.reviews)) {
      first.reviews.forEach((r) => {
        const rating = Math.round(Number(r.review_rating ?? r.rating ?? 0));
        if (rating >= 1 && rating <= 5) breakdown[rating]++;
      });
    }

    const totalReviews = Object.values(breakdown).reduce((a, b) => a + b, 0);
    let averageRating = parseFloat(first.rating ?? first.review_rating_average ?? 0);
    if (!averageRating && totalReviews > 0) {
      const sum = Object.entries(breakdown).reduce((acc, [star, cnt]) => acc + Number(star) * Number(cnt), 0);
      averageRating = sum / totalReviews;
    }

    return res.status(200).json({
      placeId: first.place_id || placeId || null,
      totalReviews,
      averageRating: totalReviews ? parseFloat(averageRating.toFixed(2)) : 0,
      breakdown,
    });
  } catch (err) {
    return res.status(500).json({ error: "Fetch error", details: err.message });
  }
}
