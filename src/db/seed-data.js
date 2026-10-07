/**
 * Seed data for Safe Globe.
 * Aligns 1:1 with PRD specifications (Phase 1 Screen & Alert, Phase 2 Clarify & Engage).
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
    summary: "Halcyon manages the crude tanker Aurora Venture, which went dark for 31 hours in the Arabian Sea and then completed a ship-to-ship transfer east of Johor. The vessel's registered owner sits three ownership hops from a sanctioned individual.",
    factors: [
      ["+", "Registration number and directors match the registry extract"],
      ["+", "Manager of Aurora Venture per vessel registry (IMO match)"],
      ["-", "Owner chain above Caribe Fuel relies partly on a news inference"]
    ],
    raise: "Request the Aurora Venture ship management agreement (estimated +6% confidence)",
    findings: [
      {
        agent: "Tide",
        title: "Managed vessel went dark for 31 hours",
        detail: "Aurora Venture switched off AIS in the Arabian Sea for 31 hours (24–25 Sep), then completed a ship-to-ship transfer with Kestrel Spirit east of Johor on 2 Oct.",
        risk: "High",
        conf: 94,
        status: "Open",
        src: "AIS position feed"
      },
      {
        agent: "Web",
        title: "Vessel owner links to a sanctioned person",
        detail: "Registered owner Caribe Fuel Trading S.A. → Halden Holdings Ltd → Varnell Capital Ltd → Arkady Zemtsov.",
        risk: "High",
        conf: 71,
        status: "Open",
        src: "Cyprus and Panama registry filings"
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
    id: "strait",
    kind: "org",
    name: "Strait Bunkering Pte. Ltd.",
    short: "Strait Bunkering",
    role: "Bunker supplier",
    a3: "SGP",
    city: "Singapore",
    ll: [103.744, 1.297],
    reg: "UEN 200604187M",
    risk: 12,
    conf: 97,
    owner: "Sofia Lim",
    trigger: "Sentry · name-similar list entry",
    since: "2017",
    claimed: false,
    factors: [
      ["+", "Registration number differs from the listed entity"],
      ["+", "Different jurisdiction and directors"],
      ["+", "Registry extract is current"]
    ],
    findings: [
      {
        agent: "Sentry",
        title: "Potential match: “Straits Bunkering Trading LLC”",
        detail: "Name similarity 88% to an entry on a sanctions list.",
        risk: "Low",
        conf: 97,
        status: "Auto-cleared",
        reason: "Different registration number, jurisdiction (SG vs AE) and directors. Sample-checked by Sofia Lim on 4 Oct.",
        src: "Vendor X sanctions API"
      }
    ]
  },
  {
    id: "lumen",
    kind: "org",
    name: "Lumen Freight Forwarding Pte. Ltd.",
    short: "Lumen Freight",
    role: "Freight forwarder",
    a3: "SGP",
    city: "Singapore",
    ll: [103.838, 1.266],
    reg: "UEN 201033561D",
    risk: 18,
    conf: 93,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2019",
    claimed: false,
    factors: [
      ["+", "All directors verified against registry"],
      ["+", "Operates Lumen Harmony, no Tide signals"]
    ],
    findings: []
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
    summary: "Kestrel is 50% owned by Halden Holdings, which is wholly owned by Varnell Capital. A news report links Varnell to Arkady Zemtsov, a sanctioned individual. The link is not yet confirmed by a registry, so confidence is low and the case needs investigation.",
    factors: [
      ["+", "Halden Holdings' 50% stake confirmed in a registry filing"],
      ["-", "Varnell Capital control by Zemtsov comes only from news (62%)"],
      ["-", "Trade licence extract is older than 12 months"],
      ["-", "Seychelles registry gives no public beneficial-ownership data"]
    ],
    raise: "Send a Smart DDQ asking for the certified shareholder register (estimated +18% confidence)",
    findings: [
      {
        agent: "Web",
        title: "50% owned through two holding companies by a sanctioned person",
        detail: "Halden Holdings Ltd (CY) owns 50%. Halden is owned by Varnell Capital Ltd (SC), reportedly controlled by Arkady Zemtsov.",
        risk: "High",
        conf: 58,
        status: "Open",
        src: "Cyprus registry filing, 12 Aug 2026; news report"
      },
      {
        agent: "Tide",
        title: "Operated vessel took part in a ship-to-ship transfer",
        detail: "Kestrel Spirit met Aurora Venture east of Johor after Aurora's 31-hour dark period.",
        risk: "High",
        conf: 81,
        status: "Open",
        src: "AIS position feed"
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
    id: "halden",
    kind: "org",
    name: "Halden Holdings Ltd",
    short: "Halden Holdings",
    role: "Holding company",
    a3: "CYP",
    city: "Limassol",
    ll: [33.04, 34.68],
    reg: "HE 389114",
    risk: 80,
    conf: 64,
    owner: "Hafiz Rahman",
    trigger: "Web · linked entity",
    linked: true,
    since: "",
    claimed: false,
    factors: [
      ["+", "Shareholding confirmed in registry filing"],
      ["-", "Directors are nominee service providers"]
    ],
    findings: [
      {
        agent: "Web",
        title: "Owns 50% of Kestrel Trading and 100% of Caribe Fuel",
        detail: "Linked entity, not a direct counterparty.",
        risk: "High",
        conf: 64,
        status: "Open",
        src: "Cyprus registry filing"
      }
    ]
  },
  {
    id: "varnell",
    kind: "org",
    name: "Varnell Capital Ltd",
    short: "Varnell Capital",
    role: "Holding company",
    a3: "SYC",
    city: "Victoria",
    ll: [55.45, -4.62],
    reg: "IBC 214077",
    risk: 90,
    conf: 52,
    owner: "Hafiz Rahman",
    trigger: "Radar · list update possible match",
    linked: true,
    since: "",
    claimed: false,
    factors: [
      ["-", "No public beneficial-ownership register"],
      ["-", "Control by Zemtsov inferred from news"]
    ],
    findings: [
      {
        agent: "Sentry",
        title: "Possible match on a sanctions list update",
        detail: "Name and registered agent match an entity added in today's list update.",
        risk: "High",
        conf: 64,
        status: "Open",
        src: "UK sanctions list (via Radar)"
      }
    ]
  },
  {
    id: "caribe",
    kind: "org",
    name: "Caribe Fuel Trading S.A.",
    short: "Caribe Fuel",
    role: "Registered vessel owner",
    a3: "PAN",
    city: "Panama City",
    ll: [-79.52, 8.98],
    reg: "Folio 155702241",
    risk: 76,
    conf: 71,
    owner: "Priya Nair",
    trigger: "Web · linked entity",
    linked: true,
    since: "",
    claimed: false,
    factors: [
      ["+", "Registered owner of Aurora Venture (IMO match)"],
      ["-", "Director appears on 43 other companies (nominee pattern)"]
    ],
    findings: []
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
    summary: "Severny Agro is based in Russia and is 51% owned by Federal Grain Corporation JSC, a state-owned enterprise. It has claimed its profile and published a statement. Truth check found one of its claims contradicted by registry data.",
    factors: [
      ["+", "Registry extract current (Aug 2026)"],
      ["+", "Ownership confirmed by registry"],
      ["+", "Profile claimed and verified as the real entity"]
    ],
    raise: "Ask for evidence of the external compliance adviser appointment",
    findings: [
      {
        agent: "Sentry",
        title: "State ownership: 51% Federal Grain Corporation JSC",
        detail: "Majority owner is a Russian state-owned enterprise subject to sectoral restrictions.",
        risk: "High",
        conf: 90,
        status: "Open",
        src: "Russian registry extract, Aug 2026"
      },
      {
        agent: "Radar",
        title: "Country sanctions exposure",
        detail: "Extensive EU, UK and US sanctions measures apply to Russia. Radar maps each change to this counterparty.",
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
  },
  {
    id: "fedgrain",
    kind: "org",
    name: "Federal Grain Corporation JSC",
    short: "Federal Grain Corp.",
    role: "State-owned enterprise",
    a3: "RUS",
    city: "Moscow",
    ll: [37.62, 55.75],
    reg: "OGRN 1027700198763",
    risk: 92,
    conf: 88,
    owner: "Daniel Tan",
    trigger: "Web · linked entity",
    linked: true,
    stateOwned: true,
    since: "",
    claimed: false,
    factors: [["+", "State ownership confirmed by registry"]],
    findings: []
  },
  {
    id: "bosphorus",
    kind: "org",
    name: "Bosphorus Ship Agency A.Ş.",
    short: "Bosphorus Agency",
    role: "Port agent",
    a3: "TUR",
    city: "Istanbul",
    ll: [28.98, 41.02],
    reg: "MERSIS 0187034562100015",
    risk: 55,
    conf: 62,
    owner: "Daniel Tan",
    trigger: "Web · new ownership link",
    since: "2022",
    claimed: false,
    factors: [
      ["+", "Registry extract current"],
      ["-", "30% shareholder Severny Agro is state-linked"],
      ["-", "Agent for Sea Marten, which calls at Novorossiysk"]
    ],
    raise: "Request the shareholder agreement with Severny Agro",
    findings: [
      {
        agent: "Web",
        title: "30% owned by Severny Agro Export",
        detail: "Two ownership hops from a Russian state-owned enterprise.",
        risk: "Medium",
        conf: 62,
        status: "Open",
        src: "Turkish trade registry gazette"
      }
    ]
  },
  {
    id: "rhein",
    kind: "org",
    name: "Rhein Nordsee Logistik GmbH",
    short: "Rhein Nordsee",
    role: "Inland logistics",
    a3: "DEU",
    city: "Hamburg",
    ll: [9.97, 53.54],
    reg: "HRB 148220",
    risk: 10,
    conf: 98,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2016",
    claimed: false,
    factors: [["+", "All identifiers match Handelsregister"]],
    findings: []
  },
  {
    id: "noordkade",
    kind: "org",
    name: "Noordkade Terminals B.V.",
    short: "Noordkade Terminals",
    role: "Terminal operator",
    a3: "NLD",
    city: "Rotterdam",
    ll: [4.05, 51.95],
    reg: "KvK 62781455",
    risk: 9,
    conf: 96,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2018",
    claimed: false,
    factors: [["+", "Registry and UBO register match"]],
    findings: []
  },
  {
    id: "nusantara",
    kind: "org",
    name: "PT Nusantara Nikel Resources",
    short: "Nusantara Nikel",
    role: "Nickel supplier",
    a3: "IDN",
    city: "Jakarta",
    ll: [106.82, -6.21],
    reg: "NIB 9120004417382",
    risk: 38,
    conf: 54,
    owner: "Priya Nair",
    trigger: "Radar · new disclosure rule",
    since: "2023",
    claimed: false,
    factors: [
      ["+", "Mining licence found in public database"],
      ["-", "No company extract on file"],
      ["-", "Beneficial owners not yet disclosed"]
    ],
    raise: "Request a current company extract (estimated +21% confidence)",
    findings: [
      {
        agent: "Radar",
        title: "New beneficial-ownership filing rule applies",
        detail: "Disclosure now required for mining licence holders. Filing not yet seen.",
        risk: "Medium",
        conf: 72,
        status: "Open",
        src: "Indonesia regulation monitor (web)"
      }
    ]
  },
  {
    id: "brightway",
    kind: "org",
    name: "Shenzhen Brightway Electronics Co., Ltd.",
    short: "Brightway Electronics",
    role: "Component supplier",
    a3: "CHN",
    city: "Shenzhen",
    ll: [114.06, 22.54],
    reg: "USCC 91440300MA5F3K2X1P",
    risk: 30,
    conf: 61,
    owner: "Priya Nair",
    trigger: "Onboarding screen",
    since: "2026",
    claimed: false,
    factors: [
      ["+", "Unified credit code verified"],
      ["-", "Shareholder data partial"],
      ["-", "Two director name transliterations unresolved"]
    ],
    raise: "Ask for the business licence and shareholder list",
    findings: []
  },
  {
    id: "lagos",
    kind: "org",
    name: "Eko Petroleum Logistics Ltd",
    short: "Eko Petroleum",
    role: "Fuel distributor",
    a3: "NGA",
    city: "Lagos",
    ll: [3.39, 6.45],
    reg: "RC 1452208",
    risk: 64,
    conf: 73,
    owner: "Hafiz Rahman",
    trigger: "Sentry · PEP link",
    since: "2022",
    claimed: false,
    summary: "Eko's chairman is a former state commissioner, which makes him a politically exposed person. No sanctions or fraud matches. Enhanced due diligence applies under policy rule R4.",
    factors: [
      ["+", "Chairman identified by name, date of birth and role"],
      ["-", "Source of wealth not documented"]
    ],
    raise: "Send a Smart DDQ on source of funds",
    findings: [
      {
        agent: "Sentry",
        title: "PEP: chairman is a former state commissioner",
        detail: "Match on name, date of birth and nationality.",
        risk: "Medium",
        conf: 73,
        status: "Open",
        src: "Built-in PEP database"
      }
    ]
  },
  {
    id: "konkan",
    kind: "org",
    name: "Konkan Polymers Pvt. Ltd.",
    short: "Konkan Polymers",
    role: "Packaging supplier",
    a3: "IND",
    city: "Mumbai",
    ll: [72.88, 19.08],
    reg: "CIN U25209MH2008PTC181220",
    risk: 22,
    conf: 88,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2020",
    claimed: false,
    factors: [
      ["+", "CIN and directors verified"],
      ["-", "Country risk elevated (CPI 2025: 39)"]
    ],
    findings: []
  },
  {
    id: "andes",
    kind: "org",
    name: "Andes Copper Holdings S.A.",
    short: "Andes Copper",
    role: "Copper concentrate supplier",
    a3: "CHL",
    city: "Santiago",
    ll: [-70.65, -33.45],
    reg: "RUT 76.512.884-3",
    risk: 14,
    conf: 92,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2019",
    claimed: false,
    factors: [["+", "All identifiers verified"]],
    findings: []
  },
  {
    id: "serra",
    kind: "org",
    name: "Serra Verde Agro Ltda.",
    short: "Serra Verde",
    role: "Soybean supplier",
    a3: "BRA",
    city: "Santos",
    ll: [-46.33, -23.96],
    reg: "CNPJ 18.442.917/0001-60",
    risk: 26,
    conf: 84,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2021",
    claimed: false,
    factors: [
      ["+", "CNPJ verified"],
      ["-", "One director's ID not yet matched"]
    ],
    findings: []
  },
  {
    id: "northpoint",
    kind: "org",
    name: "Northpoint Energy Analytics Inc.",
    short: "Northpoint Analytics",
    role: "Data vendor",
    a3: "USA",
    city: "Houston",
    ll: [-95.37, 29.76],
    reg: "TX SOS 0803571124",
    risk: 8,
    conf: 99,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2018",
    claimed: false,
    factors: [["+", "All identifiers verified"]],
    findings: []
  },
  {
    id: "pilbara",
    kind: "org",
    name: "Pilbara Ore Logistics Pty Ltd",
    short: "Pilbara Ore",
    role: "Iron ore logistics",
    a3: "AUS",
    city: "Port Hedland",
    ll: [118.6, -20.31],
    reg: "ACN 612 448 093",
    risk: 11,
    conf: 95,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2020",
    claimed: false,
    factors: [["+", "ABN and directors verified"]],
    findings: []
  },
  {
    id: "thameside",
    kind: "org",
    name: "Thameside Marine Insurance Brokers Ltd",
    short: "Thameside Marine",
    role: "P&I broker",
    a3: "GBR",
    city: "London",
    ll: [-0.08, 51.51],
    reg: "Company no. 08861247",
    risk: 7,
    conf: 98,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    since: "2015",
    claimed: false,
    factors: [["+", "Companies House and PSC register match"]],
    findings: []
  },
  {
    id: "alnoor",
    kind: "org",
    name: "Al Noor Petroleum Brokers LLC",
    short: "Al Noor Petroleum",
    role: "Crude broker",
    a3: "OMN",
    city: "Muscat",
    ll: [58.41, 23.59],
    reg: "CR 1294408",
    risk: 58,
    conf: 79,
    owner: "Hafiz Rahman",
    trigger: "Tide · cargo nexus",
    since: "2023",
    claimed: false,
    factors: [
      ["+", "Commercial registration verified"],
      ["-", "Brokered the cargo loaded by Aurora Venture"]
    ],
    raise: "Ask for the bill of lading and cargo origin certificate",
    findings: [
      {
        agent: "Tide",
        title: "Brokered cargo later moved by a dark vessel",
        detail: "Aurora Venture loaded off Fujairah after a fixture brokered by Al Noor.",
        risk: "Medium",
        conf: 79,
        status: "Open",
        src: "Fixture report, AIS position feed"
      }
    ]
  }
];

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
    note: "Sanctioned individual. Control of Varnell Capital comes from a news inference, so links through him carry lower confidence."
  },
  {
    id: "adebanjo",
    kind: "person",
    name: "T. Adebanjo-Cole",
    role: "Chairman, Eko Petroleum Logistics",
    risk: 64,
    conf: 73,
    owner: "Hafiz Rahman",
    trigger: "Sentry · PEP",
    pep: true,
    lists: [],
    note: "Former state commissioner (PEP). No sanctions or fraud matches."
  },
  {
    id: "quintero",
    kind: "person",
    name: "Rafael Quintero",
    role: "Director, Caribe Fuel Trading",
    risk: 61,
    conf: 70,
    owner: "Priya Nair",
    trigger: "Web · nominee pattern",
    pep: false,
    lists: [],
    note: "Listed as director of 44 companies, a pattern typical of nominee directors."
  },
  {
    id: "morozov",
    kind: "person",
    name: "Ilya Morozov",
    role: "General director, Severny Agro Export",
    risk: 34,
    conf: 88,
    owner: "Daniel Tan",
    trigger: "Scheduled re-screen",
    pep: false,
    lists: [],
    note: "No list, PEP or fraud matches. Two transliterations resolved (Il'ya Morozov)."
  },
  {
    id: "tan",
    kind: "person",
    name: "Mei Ling Tan",
    role: "Director, Halcyon Marine Services",
    risk: 14,
    conf: 95,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    pep: false,
    lists: [],
    note: "No list, PEP or fraud matches."
  }
];

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
    links: [["caribe", "Registered owner"], ["halcyon", "Ship manager"]],
    signals: [
      { t: "06 Oct 2026, 09:42", c: "bad", x: "Tide linked the dark period to the ship-to-ship transfer below" },
      { t: "02 Oct 2026", c: "bad", x: "Ship-to-ship transfer with Kestrel Spirit, 38 nm east of Johor" },
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
  },
  {
    id: "kspirit",
    kind: "vessel",
    name: "Kestrel Spirit",
    type: "Product tanker",
    imo: "9512733",
    mmsi: "636019482",
    flag: "Liberia",
    built: 2010,
    dwt: "49,990",
    risk: 68,
    conf: 70,
    owner: "Hafiz Rahman",
    trigger: "Tide · ship-to-ship transfer",
    dest: "Drifting, east of Johor",
    names: [["2010", "Kestrel Spirit"]],
    flags: [["2010", "Liberia"]],
    links: [["kestrel", "Operator"]],
    signals: [
      { t: "02 Oct 2026", c: "bad", x: "Ship-to-ship transfer with Aurora Venture" },
      { t: "21 Sep 2026", c: "warn", x: "AIS gap of 9 h in the South China Sea" }
    ],
    factors: [
      ["+", "IMO and operator verified"],
      ["-", "Cargo origin unknown"]
    ]
  },
  {
    id: "marten",
    kind: "vessel",
    name: "Sea Marten",
    type: "General cargo ship",
    imo: "9451068",
    mmsi: "671220350",
    flag: "Togo",
    built: 2009,
    dwt: "12,650",
    risk: 70,
    conf: 77,
    owner: "Daniel Tan",
    trigger: "Tide · port calls in sanctioned country",
    dest: "Port Said",
    names: [["2009", "Baltic Fern"], ["2022", "Sea Marten"]],
    flags: [["2009", "Malta"], ["2022", "Togo"]],
    links: [["severny", "Charterer"], ["bosphorus", "Port agent"]],
    signals: [
      { t: "30 Sep 2026", c: "warn", x: "Departed Novorossiysk (4th call in 90 days)" },
      { t: "14 Aug 2026", c: "warn", x: "Port call: Novorossiysk" },
      { t: "2022", c: "warn", x: "Flag change: Malta to Togo" }
    ],
    factors: [
      ["+", "IMO, past names and owners match"],
      ["-", "Cargo manifests not provided"]
    ]
  },
  {
    id: "mstar",
    kind: "vessel",
    name: "Meridian Star",
    type: "Container ship",
    imo: "9812676",
    mmsi: "563081940",
    flag: "Singapore",
    built: 2019,
    dwt: "118,200",
    risk: 6,
    conf: 97,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    dest: "Rotterdam",
    chartered: true,
    names: [["2019", "Meridian Star"]],
    flags: [["2019", "Singapore"]],
    links: [],
    signals: [{ t: "05 Oct 2026", c: "", x: "Transited Bab-el-Mandeb" }],
    factors: [["+", "Chartered by you; all identifiers verified"]]
  },
  {
    id: "lharmony",
    kind: "vessel",
    name: "Lumen Harmony",
    type: "Bulk carrier",
    imo: "9735191",
    mmsi: "352617008",
    flag: "Panama",
    built: 2016,
    dwt: "81,600",
    risk: 12,
    conf: 94,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    dest: "Shanghai",
    names: [["2016", "Lumen Harmony"]],
    flags: [["2016", "Panama"]],
    links: [["lumen", "Operator"]],
    signals: [{ t: "04 Oct 2026", c: "", x: "Departed Singapore" }],
    factors: [["+", "IMO and operator verified"]]
  },
  {
    id: "serranav",
    kind: "vessel",
    name: "Serra Navigator",
    type: "Bulk carrier",
    imo: "9628441",
    mmsi: "248931000",
    flag: "Malta",
    built: 2013,
    dwt: "63,500",
    risk: 9,
    conf: 95,
    owner: "Sofia Lim",
    trigger: "Scheduled re-screen",
    dest: "Rotterdam",
    names: [["2013", "Serra Navigator"]],
    flags: [["2013", "Malta"]],
    links: [["serra", "Charterer"]],
    signals: [{ t: "01 Oct 2026", c: "", x: "Crossed the equator northbound" }],
    factors: [["+", "IMO and charter verified"]]
  }
];

const EDGES = [
  ["zemtsov", "varnell", "controls", "news", "62%"],
  ["varnell", "halden", "100%", "filing"],
  ["halden", "kestrel", "50%", "registry"],
  ["halden", "caribe", "100%", "filing"],
  ["caribe", "aurora", "owner", "registry"],
  ["halcyon", "aurora", "manager", "registry"],
  ["kestrel", "kspirit", "operator", "registry"],
  ["fedgrain", "severny", "51%", "registry"],
  ["severny", "bosphorus", "30%", "filing"],
  ["severny", "marten", "charterer", "filing"],
  ["lumen", "lharmony", "operator", "registry"],
  ["serra", "serranav", "charterer", "registry"],
  ["adebanjo", "lagos", "chairman", "registry"],
  ["quintero", "caribe", "director", "registry"],
  ["morozov", "severny", "director", "registry"],
  ["tan", "halcyon", "director", "registry"]
];

const ALERTS = [
  { t: "06 Oct, 09:42", agent: "Tide", id: "aurora", x: "Aurora Venture: 31-hour AIS gap linked to a ship-to-ship transfer with Kestrel Spirit", q: "escalate" },
  { t: "06 Oct, 07:15", agent: "Radar", id: "varnell", x: "Sanctions list update: possible match on Varnell Capital Ltd (64% confidence)", q: "investigate" },
  { t: "05 Oct, 18:30", agent: "Web", id: "kestrel", x: "New ownership link: Halden Holdings owns 50% of Kestrel Trading FZE (Cyprus filing)", q: "investigate" },
  { t: "05 Oct, 11:02", agent: "Radar", id: "nusantara", x: "Indonesia: beneficial-ownership filing rule now applies to PT Nusantara Nikel Resources", q: "gaps" },
  { t: "04 Oct, 16:48", agent: "Sentry", id: "strait", x: "Strait Bunkering potential match auto-cleared with a written reason (97%)", q: "monitor" },
  { t: "03 Oct, 10:20", agent: "Truth check", id: "severny", x: "Severny Agro updated its public statement. One claim is contradicted by registry data", q: "escalate" },
  { t: "02 Oct, 14:05", agent: "Forecast", id: "MMR", x: "Risk outlook for Myanmar rose to 0.71 on sanctions momentum", q: "investigate", country: true }
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
  },
  {
    id: "s4",
    label: "Indonesia regulation monitor",
    type: "Web",
    how: "National regulation database, daily",
    cover: "Organisations",
    trust: "Medium",
    health: "stale",
    kv: [["Last successful read", "3 days ago"], ["Error", "Page layout changed"], ["Affected findings", "1, confidence reduced"]]
  }
];

const POLICIES = [
  { id: "R1", sec: "§3.2", t: "Block direct dealings with any entity 50% or more owned, in aggregate, by sanctioned persons.", hits: ["kestrel", "caribe"], note: "Ownership summed across all paths in the graph" },
  { id: "R2", sec: "§4.1", t: "Apply enhanced due diligence to counterparties in countries scoring below 40 on CPI 2025.", hits: ["severny", "fedgrain", "bosphorus", "nusantara", "lagos", "konkan"], note: "Uses the loaded CPI 2025 scores" },
  { id: "R3", sec: "§5.4", t: "Vessels with an AIS gap over 12 hours in the last 90 days need a Tide review before any fixture.", hits: ["aurora"], note: "Gaps under 6 hours and known coverage holes are ignored" },
  { id: "R4", sec: "§3.6", t: "Counterparties linked to a politically exposed person need sign-off from a senior reviewer.", hits: ["lagos"], note: "" },
  { id: "R5", sec: "§7.2", t: "A ship-to-ship transfer involving a vessel tied to a counterparty triggers a review within 2 business days.", hits: ["aurora", "kspirit"], note: "" },
  { id: "R6", sec: "§6.1", t: "Re-screen every counterparty at least every 24 hours and on every list update.", hits: [], met: true, note: "Met for all 1,284 counterparties" }
];

const STATEMENTS = {
  severny: {
    orgId: "severny",
    date: "3 Oct 2026",
    text: "Severny Agro Export has shipped grain from Novorossiysk since 2009, before current sanctions measures were introduced. We have appointed an external compliance adviser, ended all business with designated entities, and publish a quarterly list of our vessel charters.",
    remediation: "Appointed independent compliance counsel; certified charter party list published.",
    claims: [
      { q: "Shipping grain since 2009, before current sanctions", tc: "consistent", c: 91, why: "Registry shows incorporation on 14 May 2009." },
      { q: "Ended all business with designated entities", tc: "contradicted", c: 88, why: "Majority owner Federal Grain Corporation JSC is state-owned and subject to sectoral restrictions (registry extract, Aug 2026)." },
      { q: "Appointed an external compliance adviser", tc: "unverified", c: 40, why: "No filing or document provided. Smart DDQ can ask for the engagement letter." },
      { q: "Publishes a quarterly list of vessel charters", tc: "consistent", c: 76, why: "Q2 2026 list matches AIS port calls for all 9 named vessels." }
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
