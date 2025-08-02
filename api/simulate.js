export default async function handler(req, res) {
  const placeId = req.query.placeId || req.query.place_id;
  const apiKey = process.env.OUTSCRAPER_API_KEY;

  if (!placeId || !apiKey) {
    return res.status(400).json({ error: "Missing placeId or Outscraper API key" });
  }

  const headers = {
    "X-API-Key": apiKey,
    "Accept": "application/json",
  };

  try {
    // Variante A: search-v3 direkt mit Place ID (schnellste Summary)
    const searchUrl = new URL("https://api.outscraper.com/maps/search-v3");
    searchUrl.searchParams.set("query", `place_id:${placeId}`);
    searchUrl.searchParams.set("organizationsPerQueryLimit", "1");
    searchUrl.searchParams.set("async", "false"); // direkt synchron
    // optional: language, region etc.

    const searchResp = await fetch(searchUrl.toString(), { method: "GET", headers });
    if (!searchResp.ok) {
      const text = await searchResp.text();
      return res.status(502).json({ error: "Outscraper search-v3 failed", details: text });
    }
    const searchJson = await searchResp.json();

    // Drill down in die Antwortstruktur
    const entry = Array.isArray(searchJson.data?.[0]) ? searchJson.data[0][0] : searchJson.data?.[0];
    if (!entry) {
      return res.status(404).json({ error: "Place not found in search-v3 response", raw: searchJson });
    }

    const breakdown = entry.reviews_per_score || {};

    // Fallback: Wenn reviews_per_score fehlt, hole von reviews-v3 nur summary
    let totalReviews = Object.values(breakdown).reduce((sum, v) => sum + Number(v || 0), 0);
    let averageRating = entry.rating ?? 0;

    if (!entry.reviews_per_score) {
      const reviewsUrl = new URL("https://api.outscraper.com/maps/reviews-v3");
      reviewsUrl.searchParams.set("query", placeId);
      reviewsUrl.searchParams.set("reviewsLimit", "0"); // keine einzelnen Reviews
      const reviewsResp = await fetch(reviewsUrl.toString(), { method: "GET", headers });
      if (!reviewsResp.ok) {
        const t = await reviewsResp.text();
        return res.status(502).json({ error: "Outscraper reviews-v3 failed", details: t });
      }
      const reviewsJson = await reviewsResp.json();
      const reviewEntry = Array.isArray(reviewsJson.data) ? reviewsJson.data[0] : null;
      if (reviewEntry) {
        if (reviewEntry.reviews_per_score) {
          for (let i = 1; i <= 5; i++) {
            breakdown[i] = Number(reviewEntry.reviews_per_score[i] || 0);
          }
          totalReviews = Object.values(breakdown).reduce((sum, v) => sum + Number(v || 0), 0);
        }
        averageRating = parseFloat(
          (reviewEntry.rating ??
            (totalReviews
              ? Object.entries(breakdown).reduce((acc, [star, cnt]) => acc + Number(star) * Number(cnt), 0) /
                totalReviews
              : 0)
          ).toFixed(2)
        );
      }
    } else {
      // aus search-v3 some averageRating nehmen oder berechnen
      if (!averageRating && totalReviews > 0) {
        const sum = Object.entries(breakdown).reduce((acc, [star, cnt]) => acc + Number(star) * Number(cnt), 0);
        averageRating = parseFloat((sum / totalReviews).toFixed(2));
      }
      averageRating = parseFloat(averageRating.toFixed ? averageRating.toFixed(2) : averageRating);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).json({
      placeId,
      totalReviews,
      averageRating,
      breakdown,
      source: { usedOutscraper: true },
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch from Outscraper", details: err.message });
  }
}
