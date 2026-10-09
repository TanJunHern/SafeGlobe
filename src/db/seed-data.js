/**
 * Seed data for Safe Globe.
 * Trimmed to 5 distinct entities for clean, focused local testing:
 * 1. Halcyon Marine Services Pte. Ltd. (Org · Singapore · Ship manager)
 * 2. Kestrel Trading FZE (Org · UAE · Fuel oil trader · Smart DDQ pending)
 * 3. Severny Agro Export LLC (Org · Russia · Grain exporter · Claimed profile with statement)
 * 4. Aurora Venture (Vessel · IMO 9304124 · Crude tanker · AIS dark period & STS transfer)
 * 5. Arkady Zemtsov (Person · Sanctioned individual · Beneficial ownership controller)
 */

const CPI_2025 = [
  { a3: "DNK", name: "Denmark", score: 89, rank: 1 },
  { a3: "SGP", name: "Singapore", score: 84, rank: 3 },
  { a3: "DEU", name: "Germany", score: 78, rank: 9 },
  { a3: "GBR", name: "United Kingdom", score: 71, rank: 20 },
  { a3: "ARE", name: "United Arab Emirates", score: 69, rank: 21 },
  { a3: "USA", name: "United States", score: 67, rank: 24 },
  { a3: "CHL", name: "Chile", score: 66, rank: 29 },
  { a3: "OMN", name: "Oman", score: 43, rank: 70 },
  { a3: "CHN", name: "China", score: 43, rank: 76 },
  { a3: "IND", name: "India", score: 39, rank: 93 },
  { a3: "BRA", name: "Brazil", score: 36, rank: 104 },
  { a3: "IDN", name: "Indonesia", score: 34, rank: 109 },
  { a3: "TUR", name: "Türkiye", score: 31, rank: 124 },
  { a3: "NGA", name: "Nigeria", score: 26, rank: 142 },
  { a3: "RUS", name: "Russia", score: 22, rank: 157 },
  { a3: "MMR", name: "Myanmar", score: 20, rank: 162 },
  { a3: "PRK", name: "North Korea", score: 17, rank: 172 },
  { a3: "VEN", name: "Venezuela", score: 13, rank: 177 },
  { a3: "SYR", name: "Syria", score: 13, rank: 178 },
  { a3: "SOM", name: "Somalia", score: 11, rank: 180 }
];

// Exactly 3 Organisations
const ORGS = [
  {
    id: "halcyon",
    kind: "org",
    name: "Halcyon Marine Services Pte. Ltd.",
    short: "Halcyon Marine",
    role: "Ship manager",
    a3: "SGP",
    city: "Singapore",
    ll: [103.851, 1.283],
    reg: "UEN 201812345K",
    risk: 78,
    conf: 86,
    owner: "Priya Nair",
    trigger: "Tide · managed vessel went dark",
    since: "2021",
    claimed: false,
    summary: "Halcyon manages the crude tanker Aurora Venture, which went dark for 31 hours in the Arabian Sea and completed a ship-to-ship transfer east of Johor.",
    factors: [
      ["+", "Registration number and directors match the registry extract"],
      ["+", "Manager of Aurora Venture per vessel registry (IMO match)"],
      ["-", "Operating ties to dark vessel and STS transfer area"]
    ],
    raise: "Request the Aurora Venture ship management agreement (estimated +6% confidence)",
    findings: [
      {
        agent: "Tide",
        title: "Managed vessel went dark for 31 hours",
        detail: "Aurora Venture switched off AIS in the Arabian Sea for 31 hours (24–25 Sep), then completed a ship-to-ship transfer east of Johor on 2 Oct.",
        risk: "High",
        conf: 94,
        status: "Open",
        src: "AIS position feed"
      },
      {
        agent: "Sentry",
        title: "No direct list match",
        detail: "Screened against 41 sanctions lists, PEP and fraud data.",
        risk: "Low",
        conf: 98,
        status: "Cleared",
        reason: "No name, registration or director match on any list.",
        src: "Built-in sanctions and PEP data"
      }
    ]
  },
  {
    id: "kestrel",
    kind: "org",
    name: "Kestrel Trading FZE",
    short: "Kestrel Trading",
    role: "Fuel oil trader",
    a3: "ARE",
    city: "Dubai",
    ll: [55.06, 24.99],
    reg: "Free zone licence 165382",
    risk: 84,
    conf: 58,
    owner: "Hafiz Rahman",
    trigger: "Web · new ownership link",
    since: "2024",
    claimed: false,
    ddqPending: true,
    summary: "Kestrel is reportedly controlled by Arkady Zemtsov, a sanctioned individual. The link comes from news inference, so confidence is low and requires Smart DDQ verification.",
    factors: [
      ["+", "Commercial trade license verified in UAE Free Zone registry"],
      ["-", "Control by Arkady Zemtsov inferred from news (62%)"],
      ["-", "Trade licence extract is older than 12 months"]
    ],
    raise: "Send a Smart DDQ asking for the certified shareholder register (estimated +18% confidence)",
    findings: [
      {
        agent: "Web",
        title: "50% owned through holding structure by a sanctioned person",
        detail: "Holding structure reportedly controlled by Arkady Zemtsov.",
        risk: "High",
        conf: 58,
        status: "Open",
        src: "Registry filings and news report"
      },
      {
        agent: "Doc forensics",
        title: "Trade licence metadata mismatch",
        detail: "Uploaded licence PDF was created 3 days after its stated issue date.",
        risk: "Medium",
        conf: 66,
        status: "Open",
        src: "Uploaded document"
      }
    ]
  },
  {
    id: "severny",
    kind: "org",
    name: "Severny Agro Export LLC",
    short: "Severny Agro",
    role: "Grain supplier",
    a3: "RUS",
    city: "Novorossiysk",
    ll: [37.77, 44.72],
    reg: "OGRN 1092315000418",
    risk: 88,
    conf: 90,
    owner: "Daniel Tan",
    trigger: "Phase 2 · statement updated",
    since: "2015",
    claimed: true,
    stateOwned: true,
    summary: "Severny Agro is based in Russia and is 51% state-owned. It has claimed its profile and published an official clarification statement.",
    factors: [
      ["+", "Registry extract current (Aug 2026)"],
      ["+", "Ownership confirmed by registry"],
      ["+", "Profile claimed and verified as the real entity"]
    ],
    raise: "Ask for evidence of the external compliance adviser appointment",
    findings: [
      {
        agent: "Sentry",
        title: "State ownership: 51% Russian state enterprise",
        detail: "Majority owner is a Russian state-owned enterprise subject to sectoral restrictions.",
        risk: "High",
        conf: 90,
        status: "Open",
        src: "Russian registry extract, Aug 2026"
      },
      {
        agent: "Ripples",
        title: "Country sanctions exposure",
        detail: "Extensive EU, UK and US sanctions measures apply to Russia.",
        risk: "High",
        conf: 96,
        status: "Monitoring",
        src: "Official sanctions publications"
      },
      {
        agent: "Truth check",
        title: "1 of 4 statement claims contradicted",
        detail: "“Ended all business with designated entities” conflicts with the majority owner's status.",
        risk: "High",
        conf: 88,
        status: "Open",
        src: "Statement vs registry"
      }
    ]
  }
];

// Exactly 1 Vessel
const VESSELS = [
  {
    id: "aurora",
    kind: "vessel",
    name: "Aurora Venture",
    type: "Crude oil tanker",
    imo: "9304124",
    mmsi: "613004217",
    flag: "Cameroon",
    built: 2005,
    dwt: "104,800",
    risk: 86,
    conf: 82,
    owner: "Priya Nair",
    trigger: "Tide · AIS dark period",
    dest: "Johor anchorage (STS area)",
    names: [["2005", "Pacific Dawn"], ["2021", "Ocean Lyra"], ["2024", "Aurora Venture"]],
    flags: [["2005", "Panama"], ["2024", "Gabon"], ["2025", "Cameroon"]],
    links: [["halcyon", "Ship manager"], ["kestrel", "Cargo counterparty"]],
    signals: [
      { t: "06 Oct 2026, 09:42", c: "bad", x: "Tide linked the dark period to the ship-to-ship transfer below" },
      { t: "02 Oct 2026", c: "bad", x: "Ship-to-ship transfer, 38 nm east of Johor" },
      { t: "24–25 Sep 2026", c: "bad", x: "AIS dark for 31 h in the Arabian Sea; resumed west of India" },
      { t: "22 Sep 2026", c: "warn", x: "Loaded off Fujairah; draught increased 6.1 m" },
      { t: "Mar 2025", c: "warn", x: "Flag change: Gabon to Cameroon (2nd in 24 months)" }
    ],
    factors: [
      ["+", "IMO number, past names and owners all match"],
      ["+", "Dark period corroborated by satellite AIS gap"],
      ["-", "Position during gap cannot be verified"]
    ],
    raise: "Request voyage records and cargo documents from Halcyon"
  }
];

// Exactly 1 Person
const PEOPLE = [
  {
    id: "zemtsov",
    kind: "person",
    name: "Arkady Zemtsov",
    role: "Reported controller of Varnell Capital",
    risk: 92,
    conf: 62,
    owner: "Hafiz Rahman",
    trigger: "Sentry · sanctions list match",
    pep: false,
    lists: [{ list: "UK sanctions list", match: "Name, date of birth, nationality", conf: 96 }],
    note: "Sanctioned individual. Indirect control of Kestrel Trading comes from news inference, so links carry lower confidence."
  }
];

// Edges linking our 5 distinct entities
const EDGES = [
  ["zemtsov", "kestrel", "controls 50%", "news", "62%"],
  ["kestrel", "aurora", "STS fixture", "registry"],
  ["halcyon", "aurora", "manager", "registry"],
  ["zemtsov", "severny", "trade nexus", "filing"]
];

const ALERTS = [
  { t: "06 Oct, 09:42", agent: "Tide", id: "aurora", x: "Aurora Venture: 31-hour AIS gap linked to a ship-to-ship transfer", q: "escalate" },
  { t: "06 Oct, 07:15", agent: "Sentry", id: "zemtsov", x: "Sanctions list match on Arkady Zemtsov (96% confidence)", q: "escalate" },
  { t: "05 Oct, 18:30", agent: "Web", id: "kestrel", x: "New ownership link: Arkady Zemtsov reportedly holds 50% indirect control", q: "investigate" },
  { t: "04 Oct, 16:48", agent: "Tide", id: "halcyon", x: "Halcyon Marine: managed vessel Aurora Venture flagged for STS transfer", q: "investigate" },
  { t: "03 Oct, 10:20", agent: "Truth check", id: "severny", x: "Severny Agro updated its public statement. 1 claim contradicted by registry data", q: "escalate" }
];

const SOURCES = [
  {
    id: "s1",
    label: "Group blocklist",
    type: "Data feed",
    how: "CSV via SFTP, daily at 02:00 SGT",
    cover: "Organisations, people",
    trust: "High",
    health: "ok",
    kv: [["Last import", "06 Oct, 02:00"], ["Records", "1,942"], ["Re-screens triggered", "3 this week"]]
  },
  {
    id: "s2",
    label: "Vendor X sanctions API",
    type: "API",
    how: "Queried live at each screen",
    cover: "All entity types",
    trust: "High",
    health: "ok",
    kv: [["Latency p95", "280 ms"], ["Uptime, 30 days", "99.98%"], ["API key", "•••• a9f2, rotated 12 Sep"]]
  },
  {
    id: "s3",
    label: "MAS enforcement actions",
    type: "Web",
    how: "mas.gov.sg page, read every 6 hours",
    cover: "Organisations, people",
    trust: "Medium",
    health: "ok",
    kv: [["Last read", "4 hours ago"], ["Entities extracted", "2 this month"], ["Changes", "None since 28 Sep"]]
  }
];

const POLICIES = [
  { id: "R1", sec: "§3.2", t: "Block direct dealings with any entity 50% or more owned, in aggregate, by sanctioned persons.", hits: ["kestrel"], note: "Ownership summed across all paths in the graph" },
  { id: "R2", sec: "§4.1", t: "Apply enhanced due diligence to counterparties in countries scoring below 40 on CPI 2025.", hits: ["severny"], note: "Uses the loaded CPI 2025 scores" },
  { id: "R3", sec: "§5.4", t: "Vessels with an AIS gap over 12 hours in the last 90 days need a Tide review before any fixture.", hits: ["aurora"], note: "Gaps under 6 hours and known coverage holes are ignored" },
  { id: "R4", sec: "§3.6", t: "Counterparties linked to a politically exposed person need sign-off from a senior reviewer.", hits: [], met: true, note: "Met" }
];

const STATEMENTS = {
  severny: {
    orgId: "severny",
    date: "3 Oct 2026",
    text: "Severny Agro Export has shipped grain from Novorossiysk since 2009, before current sanctions measures were introduced. We have appointed an external compliance adviser, ended all business with designated entities, and publish a quarterly list of our vessel charters.",
    remediation: "Appointed independent compliance counsel; certified charter party list published.",
    claims: [
      { q: "Shipping grain since 2009, before current sanctions", tc: "consistent", c: 91, why: "Registry shows incorporation on 14 May 2009." },
      { q: "Ended all business with designated entities", tc: "contradicted", c: 88, why: "Majority owner is a Russian state-owned enterprise subject to sectoral restrictions." },
      { q: "Appointed an external compliance adviser", tc: "unverified", c: 40, why: "No filing or document provided. Smart DDQ can ask for the engagement letter." },
      { q: "Publishes a quarterly list of vessel charters", tc: "consistent", c: 76, why: "Q2 2026 list matches AIS port calls for named vessels." }
    ]
  }
};

module.exports = {
  CPI_2025,
  ORGS,
  PEOPLE,
  VESSELS,
  EDGES,
  ALERTS,
  SOURCES,
  POLICIES,
  STATEMENTS
};
