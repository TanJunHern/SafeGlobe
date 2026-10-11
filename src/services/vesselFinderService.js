/**
 * Vessel identity and voyage lookup by IMO number, from VesselFinder (https://www.vesselfinder.com).
 *
 * - The IMO check digit is verified first, offline.
 * - With VESSELFINDER_API_KEY set, the official API is used (exact position).
 * - Otherwise the public vessel page is read (position rounded to whole degrees).
 * - The destination port is geocoded so the globe can draw last position -> destination.
 *
 * lookup() never throws. It returns { status } as one of:
 *   found        the vessel exists; identity, last position and (when broadcast) destination are filled in
 *   not_found    VesselFinder has no vessel with this IMO number
 *   invalid      not a 7-digit IMO number, or the check digit is wrong
 *   unavailable  the lookup is switched off (VESSELFINDER_LOOKUP=off) or VesselFinder could not be reached
 */

const config = require('../config');

const SOURCE_ID = 'vesselfinder';
const SOURCE_LABEL = 'VesselFinder';
const SITE = 'https://www.vesselfinder.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();

/** The built-in source card: always present, and the sources API refuses to change or delete it. */
const SOURCE = {
  id: SOURCE_ID,
  label: SOURCE_LABEL,
  type: 'Web',
  how: 'Read by IMO number at intake and at every re-screen',
  cover: 'Vessels',
  trust: 'High',
  health: 'ok',
  config: {
    locked: true,
    default_for: 'IMO',
    url: SITE,
    kv: [
      ['Page', SITE],
      ['Default for', 'IMO numbers (vessel screening)'],
      ['Checks', 'IMO exists, registry name, flag and type, last position, destination'],
      ['Managed by', 'DueDilly · cannot be edited or removed']
    ]
  }
};

const imoDigits = value => String(value || '').replace(/\D/g, '');

/** A valid IMO number is 7 digits whose last digit is the weighted sum of the first six, modulo 10. */
function isValidImo(value) {
  const d = imoDigits(value);
  if (d.length !== 7) return false;
  const sum = d.slice(0, 6).split('').reduce((s, c, i) => s + Number(c) * (7 - i), 0);
  return sum % 10 === Number(d[6]);
}

const isEnabled = () => String(process.env.VESSELFINDER_LOOKUP || 'on').toLowerCase() !== 'off';
const sourceUrl = imo => `${SITE}/vessels/details/${imo}`;
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const inRange = (v, max) => (v === null || Math.abs(v) > max ? null : v);
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function stripHtml(html) {
  return clean(String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"'));
}

/** Reads the public vessel page. Returns the vessel fields, or null when the page is not a vessel page for this IMO. */
function parsePage(html, imo) {
  const title = clean((String(html).match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const head = title.match(/^(.*?),\s*(.*?)\s*-\s*Details and current position\s*-\s*IMO\s*(\d{7})/i);
  if (!head || head[3] !== imo) return null;

  let live = {};
  const json = String(html).match(/data-json='([^']+)'/);
  if (json) { try { live = JSON.parse(json[1]); } catch (e) { live = {}; } }

  const text = stripHtml(html);
  const pick = re => clean((text.match(re) || [])[1]);
  // The page reports 91 / 181 when the vessel has no AIS position
  const lat = inRange(num(live.ship_lat), 90);
  const lng = inRange(num(live.ship_lon), 180);
  return {
    name: clean(head[1]),
    type: clean(head[2]),
    flag: pick(/sailing under the flag of\s+(.+?)\s*\./i).replace(/^unknown$/i, ''),
    mmsi: live.mmsi ? String(live.mmsi) : '',
    destination: pick(/en route to\s+(?:the port of\s+)?(.+?)\s*,\s*sailing at/i),
    eta: pick(/expected to arrive there on\s+(.+?)\s*\./i),
    lat: lat === null || lng === null ? null : lat,
    lng: lat === null || lng === null ? null : lng,
    course: num(live.ship_cog),
    speed: lat === null || lng === null ? null : num(live.ship_sog),
    reported: clean(live.lrpd).replace(/^-$/, ''),
    precision: 'approximate'
  };
}

async function fromPage(imo) {
  const res = await fetch(sourceUrl(imo), { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
  if (res.status === 404) return { status: 'not_found' };
  if (!res.ok) return { status: 'unavailable', message: `VesselFinder answered HTTP ${res.status}` };
  const vessel = parsePage(await res.text(), imo);
  if (!vessel) return { status: 'unavailable', message: 'VesselFinder returned a page that could not be read' };
  return Object.assign({ status: 'found', via: 'public page' }, vessel);
}

async function fromApi(imo) {
  const url = `https://api.vesselfinder.com/vessels?userkey=${encodeURIComponent(config.vesselFinderApiKey)}&imo=${imo}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return { status: 'unavailable', message: `VesselFinder API answered HTTP ${res.status}` };
  const data = await res.json();
  if (!Array.isArray(data)) return { status: 'unavailable', message: clean(data && data.error) || 'VesselFinder API returned an unexpected answer' };
  const ais = (data[0] && data[0].AIS) || null;
  if (!ais) return { status: 'not_found' };
  const master = data[0].MASTERDATA || {};
  return {
    status: 'found',
    via: 'API',
    name: clean(ais.NAME || master.NAME),
    type: clean(master.TYPE || ''),
    flag: clean(master.FLAG || ''),
    mmsi: ais.MMSI ? String(ais.MMSI) : '',
    destination: clean(ais.DESTINATION),
    eta: clean(ais.ETA),
    lat: inRange(num(ais.LATITUDE), 90),
    lng: inRange(num(ais.LONGITUDE), 180),
    course: num(ais.COURSE),
    speed: num(ais.SPEED),
    reported: clean(ais.TIMESTAMP),
    precision: 'exact'
  };
}

/** Turns a destination port name into coordinates. Returns [lng, lat] or null. */
async function geocodePort(destination) {
  // AIS destinations are free text: "FOR ORDERS", "DRIFTING" and the like are not places
  if (!destination || /\b(orders?|drifting|anchorage|sea trials?|fishing|tba|n\/?a|unknown)\b/i.test(destination)) return null;
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(`Port of ${destination}`)}&limit=1`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const hit = ((await res.json()).features || [])[0];
    const c = hit && hit.geometry && hit.geometry.coordinates;
    return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [Number(c[0]), Number(c[1])] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Looks one vessel up by IMO number.
 * options.fresh skips the cache (used by re-screens).
 */
async function lookup(rawImo, { fresh = false } = {}) {
  const imo = imoDigits(rawImo);
  const base = { imo, source: SOURCE_LABEL, source_url: sourceUrl(imo), checked_at: new Date().toISOString() };
  if (!isValidImo(imo)) {
    return Object.assign(base, { status: 'invalid', source_url: SITE, message: `"${clean(rawImo)}" is not a valid IMO number. An IMO number has 7 digits and the last one is a check digit.` });
  }
  if (!isEnabled()) return Object.assign(base, { status: 'unavailable', message: 'VesselFinder lookup is switched off' });

  const cached = cache.get(imo);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  let result;
  try {
    result = config.vesselFinderApiKey ? await fromApi(imo) : await fromPage(imo);
  } catch (err) {
    result = { status: 'unavailable', message: `VesselFinder could not be reached (${err.name === 'TimeoutError' ? 'timed out' : err.message})` };
  }
  if (result.status === 'not_found') result.message = `IMO ${imo} was not found on VesselFinder. Check the number and try again.`;
  if (result.status === 'found') {
    const to = await geocodePort(result.destination);
    result.destination_ll = to;
  }
  const value = Object.assign(base, result);
  // Only definite answers are remembered: an outage should be retried on the next submit
  if (value.status === 'found' || value.status === 'not_found') cache.set(imo, { at: Date.now(), value });
  return value;
}

// Flag states as VesselFinder names them, by the ISO code used on the intake form
const FLAG_STATES = {
  PAN: 'Panama', LBR: 'Liberia', MHL: 'Marshall Islands', SGP: 'Singapore', HKG: 'Hong Kong', MLT: 'Malta', BHS: 'Bahamas',
  CHN: 'China', GRC: 'Greece', JPN: 'Japan', CYP: 'Cyprus', NOR: 'Norway', GBR: 'United Kingdom', USA: 'USA', IDN: 'Indonesia',
  VNM: 'Vietnam', MYS: 'Malaysia', KOR: 'Korea', IND: 'India', RUS: 'Russia', IRN: 'Iran', ARE: 'United Arab Emirates',
  DNK: 'Denmark', DEU: 'Germany', NLD: 'Netherlands', ITA: 'Italy', PRT: 'Portugal', TUR: 'Turkey', PHL: 'Philippines',
  THA: 'Thailand', BMU: 'Bermuda', ATG: 'Antigua Barbuda', BLZ: 'Belize', COK: 'Cook Islands', CMR: 'Cameroon', COM: 'Comoros',
  GAB: 'Gabon', PLW: 'Palau', TGO: 'Togo', SLE: 'Sierra Leone', TZA: 'Tanzania', VCT: 'St Vincent Grenadines', KNA: 'St Kitts Nevis',
  BRB: 'Barbados', CYM: 'Cayman Islands', GIB: 'Gibraltar', IMN: 'Isle of Man', SAU: 'Saudi Arabia', QAT: 'Qatar', OMN: 'Oman',
  AUS: 'Australia', FRA: 'France', ESP: 'Spain', BRA: 'Brazil', CAN: 'Canada', TWN: 'Taiwan'
};
const flagName = a3 => FLAG_STATES[String(a3 || '').toUpperCase()] || '';

const normName = s => String(s || '').toUpperCase().replace(/^\s*(M\/?V|M\/?T|M\.V\.|M\.T\.|MS|SS)\s+/, '').replace(/[^A-Z0-9]/g, '');
const VESSEL_CLASSES = [
  ['tanker', /tanker|crude|lng|lpg|chemical|oil|bunker/i],
  ['bulk carrier', /bulk/i],
  ['container ship', /container/i],
  ['passenger ship', /passenger|cruise|ferry/i],
  ['tug or offshore vessel', /tug|offshore|supply/i],
  ['cargo ship', /cargo|ro-?ro|reefer|vehicle/i]
];
const vesselClass = s => (VESSEL_CLASSES.find(([, re]) => re.test(String(s || ''))) || [''])[0];

/**
 * Compares what the employee declared with what the registry says.
 * declared: { name, flag (country name), type }. Returns [{ field, declared, registry }].
 */
function compare(declared, vessel) {
  if (!vessel || vessel.status !== 'found') return [];
  const out = [];
  if (declared.name && vessel.name && normName(declared.name) !== normName(vessel.name)) {
    out.push({ field: 'Name', declared: clean(declared.name), registry: vessel.name });
  }
  if (declared.flag && vessel.flag && clean(declared.flag).toLowerCase() !== vessel.flag.toLowerCase()) {
    out.push({ field: 'Flag', declared: clean(declared.flag), registry: vessel.flag });
  }
  const a = vesselClass(declared.type);
  const b = vesselClass(vessel.type);
  if (a && b && a !== b) out.push({ field: 'Type', declared: clean(declared.type), registry: vessel.type });
  return out;
}

/** Registers the VesselFinder source card, restoring it if it was changed or removed. */
function ensureSource(db) {
  db.addSource(SOURCE);
}

const isLockedSource = id => id === SOURCE_ID;

module.exports = { flagName, SOURCE_ID, SOURCE_LABEL, SITE, imoDigits, isValidImo, isEnabled, parsePage, lookup, compare, ensureSource, isLockedSource, sourceUrl };
