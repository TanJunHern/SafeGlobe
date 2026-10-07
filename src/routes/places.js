const express = require('express');
const router = express.Router();

// Curated instant-match global financial, maritime and trade hub addresses
// Provides zero-latency validation and works completely offline / airgapped.
const CURATED_PLACES = [
  {
    id: 'sg_mbfc',
    description: 'Marina Bay Financial Centre, 10 Marina Boulevard, Singapore 018983',
    main_text: 'Marina Bay Financial Centre',
    secondary_text: '10 Marina Boulevard, Singapore 018983',
    formatted_address: 'Marina Bay Financial Centre, 10 Marina Boulevard, Singapore 018983',
    lat: 1.2798,
    lng: 103.8536,
    city: 'Singapore',
    country: 'SGP'
  },
  {
    id: 'sg_mbs',
    description: '12 Marina Boulevard, Marina Bay Suites, Singapore 018982',
    main_text: '12 Marina Boulevard',
    secondary_text: 'Marina Bay Suites, Singapore 018982',
    formatted_address: '12 Marina Boulevard, Marina Bay Suites, Singapore 018982',
    lat: 1.2805,
    lng: 103.8540,
    city: 'Singapore',
    country: 'SGP'
  },
  {
    id: 'sg_robinson',
    description: '71 Robinson Road, Singapore 068895',
    main_text: '71 Robinson Road',
    secondary_text: 'Singapore 068895',
    formatted_address: '71 Robinson Road, Singapore 068895',
    lat: 1.2785,
    lng: 103.8492,
    city: 'Singapore',
    country: 'SGP'
  },
  {
    id: 'sg_raffles',
    description: 'One Raffles Place, Tower 1, Singapore 048616',
    main_text: 'One Raffles Place',
    secondary_text: 'Tower 1, Singapore 048616',
    formatted_address: 'One Raffles Place, Tower 1, Singapore 048616',
    lat: 1.2844,
    lng: 103.8510,
    city: 'Singapore',
    country: 'SGP'
  },
  {
    id: 'sg_jurong',
    description: 'Jurong Port Terminal, 37 Jurong Port Road, Singapore 619110',
    main_text: 'Jurong Port Terminal',
    secondary_text: '37 Jurong Port Road, Singapore 619110',
    formatted_address: 'Jurong Port Terminal, 37 Jurong Port Road, Singapore 619110',
    lat: 1.3060,
    lng: 103.7140,
    city: 'Singapore',
    country: 'SGP'
  },
  {
    id: 'ae_difc',
    description: 'Dubai International Financial Centre (DIFC), Gate District, Dubai, UAE',
    main_text: 'Dubai International Financial Centre (DIFC)',
    secondary_text: 'Gate District, Dubai, United Arab Emirates',
    formatted_address: 'Dubai International Financial Centre (DIFC), Gate District, Dubai, United Arab Emirates',
    lat: 25.2048,
    lng: 55.2708,
    city: 'Dubai',
    country: 'ARE'
  },
  {
    id: 'ae_dmcc',
    description: 'DMCC, Almas Tower, Jumeirah Lakes Towers, Dubai, UAE',
    main_text: 'DMCC - Almas Tower',
    secondary_text: 'Jumeirah Lakes Towers, Dubai, United Arab Emirates',
    formatted_address: 'DMCC, Almas Tower, Jumeirah Lakes Towers, Dubai, United Arab Emirates',
    lat: 25.0683,
    lng: 55.1415,
    city: 'Dubai',
    country: 'ARE'
  },
  {
    id: 'ae_jebel',
    description: 'Jebel Ali Free Zone & Port, Dubai, UAE',
    main_text: 'Jebel Ali Port Authority',
    secondary_text: 'JAFZA, Dubai, United Arab Emirates',
    formatted_address: 'Jebel Ali Free Zone & Port, Dubai, United Arab Emirates',
    lat: 24.9857,
    lng: 55.0273,
    city: 'Dubai',
    country: 'ARE'
  },
  {
    id: 'gb_leadenhall',
    description: '122 Leadenhall Street, London EC3V 4AB, United Kingdom',
    main_text: '122 Leadenhall Street',
    secondary_text: 'City of London, London EC3V 4AB, United Kingdom',
    formatted_address: '122 Leadenhall Street, London EC3V 4AB, United Kingdom',
    lat: 51.5138,
    lng: -0.0820,
    city: 'London',
    country: 'GBR'
  },
  {
    id: 'gb_canary',
    description: 'One Canada Square, Canary Wharf, London E14 5AA, United Kingdom',
    main_text: 'One Canada Square',
    secondary_text: 'Canary Wharf, London E14 5AA, United Kingdom',
    formatted_address: 'One Canada Square, Canary Wharf, London E14 5AA, United Kingdom',
    lat: 51.5050,
    lng: -0.0195,
    city: 'London',
    country: 'GBR'
  },
  {
    id: 'nl_rotterdam',
    description: 'Port of Rotterdam Authority, Wilhelminakade 902, 3072 AP Rotterdam, Netherlands',
    main_text: 'Port of Rotterdam Authority',
    secondary_text: 'Wilhelminakade 902, Rotterdam, Netherlands',
    formatted_address: 'Port of Rotterdam Authority, Wilhelminakade 902, 3072 AP Rotterdam, Netherlands',
    lat: 51.9056,
    lng: 4.4880,
    city: 'Rotterdam',
    country: 'NLD'
  },
  {
    id: 'ch_geneva',
    description: 'Rue du Rhône 42, 1204 Genève, Switzerland',
    main_text: 'Rue du Rhône 42',
    secondary_text: '1204 Genève, Switzerland',
    formatted_address: 'Rue du Rhône 42, 1204 Genève, Switzerland',
    lat: 46.2044,
    lng: 6.1432,
    city: 'Geneva',
    country: 'CHE'
  },
  {
    id: 'ru_novorossiysk',
    description: 'Port of Novorossiysk, Portovaya St 14, Novorossiysk, Krasnodar Krai, Russia',
    main_text: 'Port of Novorossiysk',
    secondary_text: 'Portovaya St 14, Novorossiysk, Russia',
    formatted_address: 'Port of Novorossiysk, Portovaya St 14, Novorossiysk, Russia',
    lat: 44.7242,
    lng: 37.7850,
    city: 'Novorossiysk',
    country: 'RUS'
  },
  {
    id: 'us_wallst',
    description: '11 Wall Street, Financial District, New York, NY 10005, United States',
    main_text: '11 Wall Street',
    secondary_text: 'New York, NY 10005, United States',
    formatted_address: '11 Wall Street, Financial District, New York, NY 10005, United States',
    lat: 40.7071,
    lng: -74.0110,
    city: 'New York',
    country: 'USA'
  },
  {
    id: 'us_houston',
    description: '1000 Louisiana Street, Downtown, Houston, TX 77002, United States',
    main_text: '1000 Louisiana Street',
    secondary_text: 'Houston, TX 77002, United States',
    formatted_address: '1000 Louisiana Street, Downtown, Houston, TX 77002, United States',
    lat: 29.7589,
    lng: -95.3677,
    city: 'Houston',
    country: 'USA'
  },
  {
    id: 'hk_central',
    description: 'Two International Finance Centre, 8 Finance Street, Central, Hong Kong',
    main_text: 'Two International Finance Centre',
    secondary_text: '8 Finance Street, Central, Hong Kong',
    formatted_address: 'Two International Finance Centre, 8 Finance Street, Central, Hong Kong',
    lat: 22.2855,
    lng: 114.1580,
    city: 'Hong Kong',
    country: 'HKG'
  },
  {
    id: 'jp_tokyo',
    description: 'Marunouchi Park Building, 2-6-1 Marunouchi, Chiyoda-ku, Tokyo 100-0005, Japan',
    main_text: 'Marunouchi Park Building',
    secondary_text: '2-6-1 Marunouchi, Chiyoda-ku, Tokyo, Japan',
    formatted_address: 'Marunouchi Park Building, 2-6-1 Marunouchi, Chiyoda-ku, Tokyo 100-0005, Japan',
    lat: 35.6812,
    lng: 139.7671,
    city: 'Tokyo',
    country: 'JPN'
  }
];

// Map 2-letter ISO country code to 3-letter ISO code if needed
const A2_TO_A3 = {
  SG: 'SGP', AE: 'ARE', GB: 'GBR', UK: 'GBR', NL: 'NLD', CH: 'CHE',
  RU: 'RUS', US: 'USA', HK: 'HKG', JP: 'JPN', DE: 'DEU', FR: 'FRA',
  AU: 'AUS', CA: 'CAN', CN: 'CHN', IN: 'IND', ID: 'IDN', MY: 'MYS'
};

/**
 * Perform external geocoding / autocomplete query
 */
async function queryExternalPlaces(query) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

  // 1. Google Places API if configured
  if (apiKey) {
    try {
      const gUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}`;
      const res = await fetch(gUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data && data.predictions && data.predictions.length > 0) {
          // Fetch place details for coordinates
          const results = [];
          for (const p of data.predictions.slice(0, 5)) {
            try {
              const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=formatted_address,geometry,address_components&key=${apiKey}`;
              const detRes = await fetch(detUrl, { signal: AbortSignal.timeout(2000) });
              if (detRes.ok) {
                const det = await detRes.json();
                const geom = det.result?.geometry?.location;
                if (geom) {
                  let countryA3 = 'SGP';
                  let city = p.structured_formatting?.secondary_text || '';
                  for (const c of (det.result?.address_components || [])) {
                    if (c.types.includes('country')) {
                      countryA3 = A2_TO_A3[c.short_name] || c.short_name;
                    }
                    if (c.types.includes('locality')) {
                      city = c.long_name;
                    }
                  }
                  results.push({
                    place_id: p.place_id,
                    description: p.description,
                    main_text: p.structured_formatting?.main_text || p.description,
                    secondary_text: p.structured_formatting?.secondary_text || '',
                    formatted_address: det.result.formatted_address || p.description,
                    lat: geom.lat,
                    lng: geom.lng,
                    city: city || 'City',
                    country: countryA3
                  });
                }
              }
            } catch (err) {}
          }
          if (results.length > 0) return results;
        }
      }
    } catch (e) {
      // Fall through to Photon
    }
  }

  // 2. Photon OpenStreetMap Geocoder (Fast, keyless, global)
  try {
    const pUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(pUrl, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        return data.features.map((f, idx) => {
          const p = f.properties || {};
          const coords = f.geometry?.coordinates || [0, 0];
          const name = p.name || query;
          const street = p.street ? (p.housenumber ? `${p.housenumber} ${p.street}` : p.street) : '';
          const city = p.city || p.town || p.district || p.state || '';
          const post = p.postcode || '';
          const cty = p.country || '';
          const a2 = (p.countrycode || '').toUpperCase();
          const a3 = A2_TO_A3[a2] || a2 || 'SGP';

          const secondaryParts = [street, city, post, cty].filter(Boolean);
          const secondary_text = secondaryParts.join(', ');
          const formatted_address = [name, secondary_text].filter(Boolean).join(', ');

          return {
            place_id: 'ph_' + (p.osm_id || idx + '_' + Date.now()),
            description: formatted_address,
            main_text: name,
            secondary_text: secondary_text,
            formatted_address: formatted_address,
            lat: coords[1],
            lng: coords[0],
            city: city || name,
            country: a3
          };
        });
      }
    }
  } catch (e) {
    // Fall through to curated fallback
  }

  return [];
}

/**
 * Filter curated places by text query
 */
function searchCuratedPlaces(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);

  return CURATED_PLACES.filter(place => {
    const text = `${place.description} ${place.main_text} ${place.secondary_text} ${place.city} ${place.country}`.toLowerCase();
    return words.every(w => text.includes(w));
  });
}

// GET /api/places/autocomplete?input=...
router.get('/autocomplete', async (req, res) => {
  const input = (req.query.input || req.query.q || '').trim();
  if (!input || input.length < 2) {
    return res.json({ predictions: [] });
  }

  // 1. Search curated fast memory first
  const curatedMatches = searchCuratedPlaces(input);

  // 2. Query external geocoder
  let externalMatches = [];
  try {
    externalMatches = await queryExternalPlaces(input);
  } catch (e) {}

  // Merge and deduplicate by description
  const seen = new Set();
  const predictions = [];

  for (const item of [...curatedMatches, ...externalMatches]) {
    const key = (item.formatted_address || item.description).toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      predictions.push(item);
    }
    if (predictions.length >= 7) break;
  }

  res.json({
    status: 'OK',
    query: input,
    predictions
  });
});

// GET /api/places/geocode?address=...
router.get('/geocode', async (req, res) => {
  const address = (req.query.address || req.query.input || '').trim();
  if (!address) {
    return res.status(400).json({ error: 'Parameter "address" is required' });
  }

  // Check curated matches first
  const curated = searchCuratedPlaces(address);
  if (curated.length > 0) {
    return res.json({
      status: 'OK',
      result: curated[0]
    });
  }

  // External lookup
  try {
    const external = await queryExternalPlaces(address);
    if (external.length > 0) {
      return res.json({
        status: 'OK',
        result: external[0]
      });
    }
  } catch (e) {}

  res.status(404).json({
    status: 'ZERO_RESULTS',
    error: 'No address found for query'
  });
});

module.exports = router;
