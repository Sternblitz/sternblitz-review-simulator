// Datei: api/simulate.js
// Erwartet: Environment Variable SERPAPI_KEY mit deinem SerpApi-Key
export default async function handler(req, res) {
  const id = req.query.placeId || req.query.place_id || req.query.data_id;
  const serpApiKey = process.env.SERPAPI_KEY;

  if (!id || !serpApiKey) {
    return res.status(400).json({ error: "Missing placeId/data_id or API key" });
  }

  // Helper: fetch with timeout to avoid hängende Requests
  async function fetchWithTimeout(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return resp;
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  // Eine Seite laden (Reviews engine)
  async function fetchReviewsPage(nextPageToken = null) {
    const params = new URLSearchParams({
      engine: "google_maps_reviews",
      api_key: serpApiKey,
      hl: "de",
    });
    if (req.query.data_id) params.set("data_id", id);
    else params.set("place_id", id);
    if (nextPageToken) params.set("next_page_token", nextPageToken);

    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`SerpApi non-OK: ${txt}`);
    }
    return await resp.json();
  }

  try {
    // Erste Seite holen (enthält place_info)
    const firstPage = await fetchReviewsPage();

    // place_info für echte Gesamtzahl und Rating
    const placeInfo = firstPage.place_info || {};
    const totalReviewsFromPlace =
      typeof placeInfo.reviews === "number" ? placeInfo.reviews : null;
    const averageRatingFromPlace =
      typeof placeInfo.rating !== "undefined"
        ? parseFloat(placeInfo.rating)
        : null;

    // Breakdown initial aus der ersten Seite
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let countedReviews = 0;

    const accumulate = (reviewsArray) => {
      (reviewsArray || []).forEach((r) => {
        const rating = parseFloat(r.rating);
        if (rating >= 1 && rating <= 5) {
          const intRating = Math.round(rating);
          breakdown[intRating] = (breakdown[intRating] || 0) + 1;
          sum += rating;
          countedReviews++;
        }
      });
    };

    accumulate(firstPage.reviews || []);

    // Vollständige Pagination immer versuchen (wenn wir wissen, wie viele insgesamt sein sollen)
    let fullFetched = false;
    let truncated = false;

    if (totalReviewsFromPlace && countedReviews < totalReviewsFromPlace) {
      fullFetched = true;
      const expectedPages = Math.ceil(totalReviewsFromPlace / 8);
      const capPages = Math.min(expectedPages, 300); // Sicherheitslimit: max. 300 Seiten
      let pagesFetched = 1;
      let nextToken =
        firstPage.serpapi_pagination?.next_page_token ||
        firstPage.next_page_token ||
        null;

      while (nextToken && pagesFetched < capPages) {
        try {
          const page = await fetchReviewsPage(nextToken);
          accumulate(page.reviews || []);
          nextToken =
            page.serpapi_pagination?.next_page_token ||
            page.next_page_token ||
            null;
          pagesFetched++;
        } catch (e) {
          console.warn("Pagination fetch error:", e.message);
          break; // bei Fehler abbrechen, aber Daten verwenden
        }
      }

      if (countedReviews < totalReviewsFromPlace && pagesFetched >= capPages) {
        truncated = true; // nicht komplett geladen wegen Cap
      }
    }

    // Durchschnitt aus dem (vollständigen oder sample) Reviews
    const averageFromSample = countedReviews > 0 ? sum / countedReviews : 0;

    // Finale Werte: bevorzugt place_info
    const totalReviews = totalReviewsFromPlace || countedReviews;
    const averageRating =
      averageRatingFromPlace !== null
        ? averageRatingFromPlace
        : parseFloat(averageFromSample.toFixed(2));

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    return res.status(200).json({
      placeId: id,
      totalReviews,
      averageRating: parseFloat(averageRating.toFixed(2)),
      breakdown,
      breakdown_full: fullFetched,
      truncated,
      source: {
        usedPlaceInfo: !!placeInfo.title,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Failed to fetch from SerpApi", details: error.message });
  }
}
