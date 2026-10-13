/**
 * Country risk views: how a country's value in a view becomes a colour on the Globe.
 * Used by safe-globe.html and by the tests, so the rule is written once.
 *
 * Higher risk is always redder. A country the view has no data for is neutral grey, never green.
 *   risk(view, country)  a number from 0 (lowest risk) to 1 (highest), or null when there is no data
 *   band(risk)           'high' | 'mid' | 'low' | 'none'  (the app's risk tokens: red, amber, green, grey)
 * A categorical view takes the level of the country's category from the view's own definition.
 * A score view places the source's own number on the source's own scale, turned round when a low number is bad.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CountryRiskViews = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LEVEL_RISK = { low: 0, mid: 0.5, high: 1 };
  const BANDS = ['low', 'mid', 'high'];

  function risk(view, country) {
    if (!view || !country) return null;
    if (view.kind === 'score') {
      const scale = view.scale;
      if (!scale || typeof country.score !== 'number' || scale.max === scale.min) return null;
      const t = Math.max(0, Math.min(1, (country.score - scale.min) / (scale.max - scale.min)));
      return scale.lowIsBad ? 1 - t : t;
    }
    const category = (view.categories || []).find(c => c.id === country.category);
    return category && category.level in LEVEL_RISK ? LEVEL_RISK[category.level] : null;
  }

  const band = r => (r === null || r === undefined ? 'none' : r >= 2 / 3 ? 'high' : r >= 1 / 3 ? 'mid' : 'low');

  /**
   * tokens: the page's colours by name ('high', 'high-soft', 'mid', 'mid-soft', 'low', 'low-soft', 'land-none').
   * mix(a, b)(t): blends two colours (d3.interpolateRgb on the page). A categorical view uses the plain token.
   */
  function colour(view, country, tokens, mix) {
    const r = risk(view, country);
    const b = band(r);
    if (b === 'none') return tokens['land-none'];
    if (view.kind !== 'score' || !mix) return tokens[b];
    const within = (r - BANDS.indexOf(b) / 3) * 3;
    // In the green band the strongest green is the lowest risk; in the other two the strongest colour is the highest
    return mix(tokens[b + '-soft'], tokens[b])(0.28 + 0.72 * Math.max(0, Math.min(1, b === 'low' ? 1 - within : within)));
  }

  /** Redness for ordering and tests: grey is not on the scale (-1), then green, amber, red. */
  const redness = (view, country) => { const r = risk(view, country); return r === null ? -1 : r; };

  return { risk, band, colour, redness, LEVEL_RISK };
});
