// Datei: api/simulate.js
export default async function handler(req, res) {
  const placeId = req.query.placeId || req.query.place_id;
  const apiKey = process.env.OUTSCRAPER_API_KEY;

  if (!placeId || !apiKey) {
    return res.status(400).json({ error: "Missing placeId or Outscraper API key" });
  }

  // Baue die Query-URL (placeId als query; Outscraper akzeptiert z.B. place_id direkt als query)
  const baseUrl = "https://api.outscraper.cloud/maps/reviews-v3";
  const url = new URL(baseUrl);
  url.searchParams.set("query", placeId);
  // optional: beschränken, wenn du nur die Zahlen brauchst, kannst du z.B. reviewsLimit=0 (je nach API-Doku)
  url.searchParams.set("reviewsLimit", "0"); // 0 = unlimited / nur summary (falls unterstützt)

  const headers = {
    "X-API-Key": apiKey,
    "Accept": "application/json",
  };

  try {
    // Erste Anfrage: job anstoßen
    const first = await fetch(url.toString(), { method: "GET", headers });
    if (!first.ok) {
      const txt = await first.text();
      return res.status(502).json({ error: "Outscraper initial request failed", details: txt });
    }
    const firstJson = await first.json();

    // Wenn der Job noch pending ist: pollen
    let result;
    if (firstJson.status && firstJson.status !== "Success") {
      // erwartet: firstJson.results_location mit URL zum Abfragen
      const pollUrl = firstJson.results_location || firstJson.raw?.results_location;
      if (!pollUrl) {
        return res.status(500).json({ error: "Missing results_location from Outscraper response", raw: firstJson });
      }

      // Polling mit Backoff (max ~5s)
      const maxAttempts = 10;
      let attempt = 0;
      while (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); // 300ms, 600ms, ...
        const polled = await fetch(pollUrl, { method: "GET", headers });
        if (!polled.ok) {
          const t = await polled.text();
          return res.status(502).json({ error: "Outscraper poll failed", details: t });
        }
        const polledJson = await polled.json();
        if (polledJson.status === "Success") {
          result = polledJson;
          break;
        }
        attempt++;
      }
      if (!result) {
        return res.status(504).json({
          error: "Outscraper job still pending",
          note: "Bitte in ein paar hundert Millisekunden nochmal anfragen oder retry-Logik erweitern.",
          lastStatus: firstJson.status,
        });
      }
    } else {
      result = firstJson;
    }

    // Extrahiere Daten: es kommt ein Array in result.data
    const entry = Array.isArray(result.data) ? result.data[0] : null;
    if (!entry) {
      return res.status(404).json({ error: "Missing place data", raw: result });
    }

    // Breakdown: bevorzugt reviews_per_score wenn vorhanden
    let breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (entry.reviews_per_score) {
      // Erwartet z.B. { "1": 47, "2": 31, ... }
      for (let i = 1; i <= 5; i++) {
        breakdown[i] = Number(entry.reviews_per_score[i] || 0);
      }
    } else if (Array.isArray(entry.reviews)) {
      // Fallback: aus einzelnen Reviews aggregieren
      entry.reviews.forEach((r) => {
        const rating = Math.round(Number(r.review_rating ?? r.rating ?? 0));
        if (rating >= 1 && rating <= 5) {
          breakdown[rating]++;
        }
      });
    }

    const totalReviews = Number(entry.review_count ?? entry.reviews ?? 0) || Object.values(breakdown).reduce((a, b) => a + b, 0);
    let averageRating = parseFloat(entry.rating ?? entry.review_rating_average ?? 0);
    if (!averageRating && totalReviews > 0) {
      // berechne aus breakdown
      const sum = Object.entries(breakdown).reduce((acc, [star, cnt]) => acc + Number(star) * Number(cnt), 0);
      averageRating = sum / totalReviews;
    }

    // response
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).json({
      placeId,
      totalReviews,
      averageRating: parseFloat(averageRating.toFixed(2)),
      breakdown,
      source: { usedOutscraper: true },
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch from Outscraper", details: err.message });
  }
}
