// Datei: api/simulate.js
// Erwartet: Environment Variable OUTSCRAPER_API_KEY mit deinem Outscraper-Key
export default async function handler(req, res) {
  const placeId = req.query.placeId || req.query.place_id;
  const apiKey = process.env.OUTSCRAPER_API_KEY;

  if (!placeId || !apiKey) {
    return res.status(400).json({ error: "Missing placeId or Outscraper API key" });
  }

  const headers = {
    "X-API-KEY": apiKey,
    "Accept": "application/json",
  };

  // Baue die URL für Google Maps Reviews v3; reviewsLimit=0 = alle (für exakte breakdowns)
  const base = "https://api.outscraper.cloud/maps/reviews-v3";
  const params = new URLSearchParams({
    query: placeId,
    reviewsLimit: "0", // unlimited, damit breakdown vollständig ist
    language: "de", // optional, kannst du weglassen oder ändern
  });
  const url = `${base}?${params.toString()}`;

  try {
    const initial = await fetch(url, { headers });
    if (!initial.ok) {
      const txt = await initial.text();
      return res.status(502).json({ error: "Outscraper initial request failed", details: txt });
    }

    let json = await initial.json();

    // Manchmal kommt noch ein pending job zurück -> pollen
    const getFinalResult = async (jobInfo) => {
      // Prüfe ob wir direkt Daten haben
      if (
        (jobInfo.status && jobInfo.status.toLowerCase() === "success") ||
        (jobInfo.data && Array.isArray(jobInfo.data))
      ) {
        return jobInfo;
      }
      // Fallback: wenn raw mit pending und results_location
      const location =
        jobInfo.results_location ||
        jobInfo.raw?.results_location ||
        jobInfo.raw?.resultsLocation;
      if (!location) {
        throw new Error("Keine result location zum Polling vorhanden");
      }

      // Polling mit begrenzten Versuchen
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 500)); // 500ms delay
        const poll = await fetch(location, { headers });
        if (!poll.ok) continue;
        const pjson = await poll.json();
        if (
          (pjson.status && pjson.status.toLowerCase() === "success") ||
          (pjson.data && Array.isArray(pjson.data))
        ) {
          return pjson;
        }
        // sonst weiter versuchen
      }
      throw new Error("Outscraper job still pending");
    };

    const final = await getFinalResult(json);

    // Extrahiere das erste Element (Place)
    const place = Array.isArray(final.data) && final.data[0] ? final.data[0] : null;
    if (!place) {
      return res.status(502).json({ error: "Missing place data", raw: final });
    }

    // Breakdown: outscraper nennt es reviews_per_score
    const rawBreakdown = place.reviews_per_score || place.reviews_per_score || {};
    // Stelle sicher, dass alle 1..5 da sind als integers
    const breakdown = {
      1: parseInt(rawBreakdown["1"] || 0, 10),
      2: parseInt(rawBreakdown["2"] || 0, 10),
      3: parseInt(rawBreakdown["3"] || 0, 10),
      4: parseInt(rawBreakdown["4"] || 0, 10),
      5: parseInt(rawBreakdown["5"] || 0, 10),
    };

    const totalReviews = parseInt(place.reviews || 0, 10);

    // averageRating: wenn geliefert, nutze; sonst berechne gewichteten Durchschnitt
    let averageRating = parseFloat(place.rating || 0);
    if (!averageRating && totalReviews > 0) {
      let sum = 0;
      Object.entries(breakdown).forEach(([star, count]) => {
        sum += parseInt(star, 10) * count;
      });
      averageRating = sum / totalReviews;
    }

    // CORS für Webflow etc.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    return res.status(200).json({
      placeId,
      totalReviews,
      averageRating: Math.round(averageRating * 100) / 100,
      breakdown, // {1: x, 2: y, ...}
      source: { usedOutscraper: true },
    });
  } catch (err) {
    return res.status(500).json({ error: "Outscraper error", details: err.message });
  }
}
