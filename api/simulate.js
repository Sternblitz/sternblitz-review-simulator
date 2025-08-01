// Datei: api/simulate.js
// Erwartet: Environment Variable SERPAPI_KEY mit deinem SerpApi-Key
export default async function handler(req, res) {
  const placeId = req.query.placeId || req.query.place_id;
  const serpApiKey = process.env.SERPAPI_KEY;

  if (!placeId || !serpApiKey) {
    return res.status(400).json({ error: "Missing placeId or API key" });
  }

  const serpUrl = `https://serpapi.com/search.json?engine=google_maps_reviews&place_id=${encodeURIComponent(
    placeId
  )}&api_key=${encodeURIComponent(serpApiKey)}&hl=de`;

  try {
    const response = await fetch(serpUrl);
    if (!response.ok) {
      const text = await response.text();
      return res
        .status(502)
        .json({ error: "SerpApi responded with non-OK status", details: text });
    }
    const data = await response.json();

    const reviewsRaw = data.reviews || [];

    // Breakdown 1..5 Sterne und Durchschnitt aus den Reviews berechnen
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    reviewsRaw.forEach((r) => {
      const rating = parseInt(r.rating, 10);
      if (rating >= 1 && rating <= 5) {
        breakdown[rating]++;
        sum += rating;
      }
    });

    const totalReviews = reviewsRaw.length;
    const averageFromReviews = totalReviews > 0 ? sum / totalReviews : 0;

    // Fallback auf place_results.rating falls vorhanden
    const averageRating =
      (data.place_results && parseFloat(data.place_results.rating)) ||
      parseFloat(averageFromReviews.toFixed(2)) ||
      0;

    // CORS (für Webflow, kann später enger eingeschränkt werden)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    return res.status(200).json({
      placeId,
      totalReviews,
      averageRating: parseFloat(averageRating.toFixed(2)),
      breakdown, // {1: x, 2: y, ...}
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Failed to fetch from SerpApi", details: error.message });
  }
}
