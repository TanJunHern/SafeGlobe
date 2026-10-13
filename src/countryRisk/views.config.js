/**
 * Country risk views on the Globe: the one definition of each view.
 * The service, the API, the legend, the "How Dilly works" line and the tests all read this file.
 *
 * What is here: where a view's data comes from, how it is read, and what its categories mean and how risky each is.
 * What is never here: which country is in which category. That comes only from the fetched data.
 *
 * These views are for display. They add no risk points and change no score, confidence or route.
 *
 * method      structured: a data file parsed in code, no model
 *             llm:        a web page; the ADK country risk agent extracts the countries with a quote for each
 * fetch.type  page:           one web page
 *             catalogue_file: a data portal's dataset record (JSON) names the files; the newest file of `format` is read
 * level       how risky a category is on the map: high (red), mid (amber), low (green). Higher risk is always redder.
 */
const REFRESH = {
  default: 'weekly',
  options: [
    { id: 'manual', label: 'Manual only', days: null },
    { id: 'daily', label: 'Daily', days: 1 },
    { id: 'weekly', label: 'Weekly', days: 7 },
    { id: 'monthly', label: 'Monthly', days: 30 }
  ]
};

const METHOD_LABELS = { structured: 'Parsed file', llm: 'AI extracted', upload: 'Uploaded' };

// A refresh that loses more than this share of the countries of the last good version is not trusted (a half-read page)
const MAX_DROP = 0.5;

const VIEWS = [
  {
    id: 'fatf_lists',
    label: 'FATF lists',
    sourceName: 'FATF',
    sourceUrl: 'https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html',
    kind: 'categorical',
    method: 'llm',
    fetch: { type: 'page' },
    // The site answers automated readers with a challenge page. DueDilly does not get around it: an officer saves
    // the page in a browser and uploads it.
    upload: { extensions: ['html', 'htm', 'txt'], hint: 'Open the FATF page in your browser, save it (web page, HTML only, or copy the text into a .txt file) and upload it here.' },
    summary: 'Jurisdictions the FATF has publicly identified: call for action (black list) and increased monitoring (grey list).',
    notListed: 'Not on either list',
    categories: [
      { id: 'call_for_action', label: 'Call for action (black list)', level: 'high', description: 'High-risk jurisdictions subject to a call for action.' },
      { id: 'increased_monitoring', label: 'Increased monitoring (grey list)', level: 'mid', description: 'Jurisdictions under increased monitoring.' }
    ],
    instructions: 'List every jurisdiction the page says is currently on one of the two lists. Leave out jurisdictions the page says are no longer on a list, and any that are only mentioned in passing.'
  },
  {
    id: 'ofac_programmes',
    label: 'OFAC sanctions',
    sourceName: 'OFAC (US Treasury)',
    sourceUrl: 'https://ofac.treasury.gov/sanctions-programs-and-country-information',
    kind: 'categorical',
    method: 'llm',
    fetch: { type: 'page' },
    summary: 'Countries an OFAC sanctions programme is named after. Programme level: not a count of listed names.',
    caveat: 'A programme name can mention a country that is not its target. The programme name is shown for each country.',
    notListed: 'No country programme',
    categories: [
      { id: 'sanctions_programme', label: 'Named in an OFAC sanctions programme', level: 'mid', description: 'A sanctions programme on the page is named after this country, or after its government or territory.' }
    ],
    instructions: 'The page lists sanctions programmes by name. For each programme whose name refers to a country, return that country once per programme, with the programme name exactly as written as the quote. A programme that names two countries gives two entries. Leave out programmes that name no country (for example terrorism, narcotics, cyber or human rights programmes).'
  },
  {
    id: 'eu_regimes',
    label: 'EU sanctions',
    sourceName: 'European Commission (consolidated financial sanctions list)',
    sourceUrl: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
    kind: 'categorical',
    method: 'structured',
    fetch: {
      type: 'catalogue_file',
      catalogueUrl: 'https://data.europa.eu/api/hub/search/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
      format: 'CSV',
      maxBytes: 80 * 1024 * 1024,
      timeoutMs: 180000
    },
    parser: 'euRegimes',
    summary: 'Countries an EU sanctions regime is coded after in the consolidated list. Regime level: not a count of listed names.',
    caveat: 'A regime code can be a country that is not its target. The regulation is shown for each country.',
    notListed: 'No country regime',
    categories: [
      { id: 'sanctions_regime', label: 'Named in an EU sanctions regime', level: 'mid', description: 'Entries in the list fall under a regime whose code is this country\'s code.' }
    ]
  }
];

const byId = id => VIEWS.find(v => v.id === id) || null;

module.exports = { VIEWS, REFRESH, METHOD_LABELS, MAX_DROP, byId };
