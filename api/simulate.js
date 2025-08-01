// Datei: api/simulate.js
// Benötigt: Environment Variable SERPAPI_KEY mit deinem SerpApi-Key
export default async function handler(req, res) {
  const { placeId } = req.query;
  const serpApiKey = process.env.SERPAPI_KEY;

  if (!placeId || !serpApiKey) {
    return res.status(400).json({ error: "Missing placeId or API key" });
  }

  // SerpApi-Request: Google Maps Reviews
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

    // Normalisiere die Reviews
    const reviews = reviewsRaw.map((r) => {
      // Datum: SerpApi kann unterschiedliche Felder liefern; versuche mehrere
      let datetime = "";
      if (r.time) {
        // epoch seconds
        datetime = new Date(r.time * 1000).toISOString();
      } else if (r.datetime) {
        datetime = r.datetime;
      }

      return {
        id: r.review_id || r.id || `${r.user?.name || "anon"}_${r.rating}_${r.time || ""}`,
        rating: parseInt(r.rating, 10),
        text: r.snippet || r.text || "",
        reviewer: r.user?.name || r.reviewer || "",
        datetime,
        url: r.source || r.url || "",
        likes: r.likes || 0,
      };
    });

    // Breakdown 1..5 Sterne und Durchschnitt aus den Reviews berechnen
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    reviews.forEach((r) => {
      if (r.rating >= 1 && r.rating <= 5) {
        breakdown[r.rating]++;
        sum += r.rating;
      }
    });

    const totalReviews = reviews.length;
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
      reviews, // Array einzelner Reviews
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Failed to fetch from SerpApi", details: error.message });
  }
}
