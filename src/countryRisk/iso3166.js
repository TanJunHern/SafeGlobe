/**
 * ISO 3166-1: the fixed country list used to turn a name or a code into an alpha-3 code.
 * A name from a source is mapped here, in code, and never by a model. A name that is not here is rejected and logged.
 * This list says which countries exist. It says nothing about which country is on any risk list.
 *
 * One row per country: alpha-3 | alpha-2 | short name | other names it is commonly written as.
 */
const ROWS = `
AFG|AF|Afghanistan
ALA|AX|Åland Islands
ALB|AL|Albania
DZA|DZ|Algeria
ASM|AS|American Samoa
AND|AD|Andorra
AGO|AO|Angola
AIA|AI|Anguilla
ATA|AQ|Antarctica
ATG|AG|Antigua and Barbuda
ARG|AR|Argentina
ARM|AM|Armenia
ABW|AW|Aruba
AUS|AU|Australia
AUT|AT|Austria
AZE|AZ|Azerbaijan
BHS|BS|Bahamas
BHR|BH|Bahrain
BGD|BD|Bangladesh
BRB|BB|Barbados
BLR|BY|Belarus
BEL|BE|Belgium
BLZ|BZ|Belize
BEN|BJ|Benin
BMU|BM|Bermuda
BTN|BT|Bhutan
BOL|BO|Bolivia|Bolivia (Plurinational State of)|Plurinational State of Bolivia
BES|BQ|Bonaire, Sint Eustatius and Saba
BIH|BA|Bosnia and Herzegovina|Bosnia-Herzegovina|Bosnia
BWA|BW|Botswana
BVT|BV|Bouvet Island
BRA|BR|Brazil
IOT|IO|British Indian Ocean Territory
BRN|BN|Brunei Darussalam|Brunei
BGR|BG|Bulgaria
BFA|BF|Burkina Faso
BDI|BI|Burundi
CPV|CV|Cabo Verde|Cape Verde
KHM|KH|Cambodia
CMR|CM|Cameroon
CAN|CA|Canada
CYM|KY|Cayman Islands
CAF|CF|Central African Republic
TCD|TD|Chad
CHL|CL|Chile
CHN|CN|China|People's Republic of China
CXR|CX|Christmas Island
CCK|CC|Cocos (Keeling) Islands
COL|CO|Colombia
COM|KM|Comoros
COG|CG|Congo|Republic of the Congo|Congo (Brazzaville)|Congo-Brazzaville
COD|CD|Democratic Republic of the Congo|Congo, Democratic Republic of the|Congo (Kinshasa)|DR Congo|DRC|Congo-Kinshasa|Democratic Republic of Congo
COK|CK|Cook Islands
CRI|CR|Costa Rica
CIV|CI|Côte d'Ivoire|Ivory Coast
HRV|HR|Croatia
CUB|CU|Cuba
CUW|CW|Curaçao
CYP|CY|Cyprus
CZE|CZ|Czechia|Czech Republic
DNK|DK|Denmark
DJI|DJ|Djibouti
DMA|DM|Dominica
DOM|DO|Dominican Republic
ECU|EC|Ecuador
EGY|EG|Egypt
SLV|SV|El Salvador
GNQ|GQ|Equatorial Guinea
ERI|ER|Eritrea
EST|EE|Estonia
SWZ|SZ|Eswatini|Swaziland
ETH|ET|Ethiopia
FLK|FK|Falkland Islands (Malvinas)|Falkland Islands
FRO|FO|Faroe Islands
FJI|FJ|Fiji
FIN|FI|Finland
FRA|FR|France
GUF|GF|French Guiana
PYF|PF|French Polynesia
ATF|TF|French Southern Territories
GAB|GA|Gabon
GMB|GM|Gambia|The Gambia
GEO|GE|Georgia
DEU|DE|Germany
GHA|GH|Ghana
GIB|GI|Gibraltar
GRC|GR|Greece
GRL|GL|Greenland
GRD|GD|Grenada
GLP|GP|Guadeloupe
GUM|GU|Guam
GTM|GT|Guatemala
GGY|GG|Guernsey
GIN|GN|Guinea
GNB|GW|Guinea-Bissau
GUY|GY|Guyana
HTI|HT|Haiti
HMD|HM|Heard Island and McDonald Islands
VAT|VA|Holy See|Vatican City|Vatican
HND|HN|Honduras
HKG|HK|Hong Kong|Hong Kong SAR|Hong Kong, China
HUN|HU|Hungary
ISL|IS|Iceland
IND|IN|India
IDN|ID|Indonesia
IRN|IR|Iran|Iran (Islamic Republic of)|Islamic Republic of Iran
IRQ|IQ|Iraq
IRL|IE|Ireland
IMN|IM|Isle of Man
ISR|IL|Israel
ITA|IT|Italy
JAM|JM|Jamaica
JPN|JP|Japan
JEY|JE|Jersey
JOR|JO|Jordan
KAZ|KZ|Kazakhstan
KEN|KE|Kenya
KIR|KI|Kiribati
PRK|KP|Democratic People's Republic of Korea|North Korea|Korea (Democratic People's Republic of)|DPRK|Korea, North
KOR|KR|Republic of Korea|South Korea|Korea (Republic of)|Korea, South
KWT|KW|Kuwait
KGZ|KG|Kyrgyzstan|Kyrgyz Republic
LAO|LA|Lao People's Democratic Republic|Laos|Lao PDR
LVA|LV|Latvia
LBN|LB|Lebanon
LSO|LS|Lesotho
LBR|LR|Liberia
LBY|LY|Libya
LIE|LI|Liechtenstein
LTU|LT|Lithuania
LUX|LU|Luxembourg
MAC|MO|Macao|Macau
MDG|MG|Madagascar
MWI|MW|Malawi
MYS|MY|Malaysia
MDV|MV|Maldives
MLI|ML|Mali
MLT|MT|Malta
MHL|MH|Marshall Islands
MTQ|MQ|Martinique
MRT|MR|Mauritania
MUS|MU|Mauritius
MYT|YT|Mayotte
MEX|MX|Mexico
FSM|FM|Micronesia|Micronesia (Federated States of)|Federated States of Micronesia
MDA|MD|Moldova|Republic of Moldova|Moldova, Republic of
MCO|MC|Monaco
MNG|MN|Mongolia
MNE|ME|Montenegro
MSR|MS|Montserrat
MAR|MA|Morocco
MOZ|MZ|Mozambique
MMR|MM|Myanmar|Burma
NAM|NA|Namibia
NRU|NR|Nauru
NPL|NP|Nepal
NLD|NL|Netherlands|The Netherlands
NCL|NC|New Caledonia
NZL|NZ|New Zealand
NIC|NI|Nicaragua
NER|NE|Niger
NGA|NG|Nigeria
NIU|NU|Niue
NFK|NF|Norfolk Island
MKD|MK|North Macedonia|Macedonia|Republic of North Macedonia
MNP|MP|Northern Mariana Islands
NOR|NO|Norway
OMN|OM|Oman
PAK|PK|Pakistan
PLW|PW|Palau
PSE|PS|Palestine|State of Palestine|Palestine, State of|Palestinian Territories
PAN|PA|Panama
PNG|PG|Papua New Guinea
PRY|PY|Paraguay
PER|PE|Peru
PHL|PH|Philippines|The Philippines
PCN|PN|Pitcairn
POL|PL|Poland
PRT|PT|Portugal
PRI|PR|Puerto Rico
QAT|QA|Qatar
REU|RE|Réunion
ROU|RO|Romania
RUS|RU|Russian Federation|Russia
RWA|RW|Rwanda
BLM|BL|Saint Barthélemy
SHN|SH|Saint Helena, Ascension and Tristan da Cunha|Saint Helena
KNA|KN|Saint Kitts and Nevis|St. Kitts and Nevis
LCA|LC|Saint Lucia|St. Lucia
MAF|MF|Saint Martin (French part)|Saint Martin
SPM|PM|Saint Pierre and Miquelon
VCT|VC|Saint Vincent and the Grenadines|St. Vincent and the Grenadines
WSM|WS|Samoa
SMR|SM|San Marino
STP|ST|Sao Tome and Principe|São Tomé and Príncipe
SAU|SA|Saudi Arabia
SEN|SN|Senegal
SRB|RS|Serbia
SYC|SC|Seychelles
SLE|SL|Sierra Leone
SGP|SG|Singapore
SXM|SX|Sint Maarten (Dutch part)|Sint Maarten
SVK|SK|Slovakia
SVN|SI|Slovenia
SLB|SB|Solomon Islands
SOM|SO|Somalia
ZAF|ZA|South Africa
SGS|GS|South Georgia and the South Sandwich Islands
SSD|SS|South Sudan
ESP|ES|Spain
LKA|LK|Sri Lanka
SDN|SD|Sudan
SUR|SR|Suriname
SJM|SJ|Svalbard and Jan Mayen
SWE|SE|Sweden
CHE|CH|Switzerland
SYR|SY|Syrian Arab Republic|Syria
TWN|TW|Taiwan|Taiwan, Province of China|Chinese Taipei
TJK|TJ|Tajikistan
TZA|TZ|Tanzania|United Republic of Tanzania|Tanzania, United Republic of
THA|TH|Thailand
TLS|TL|Timor-Leste|East Timor
TGO|TG|Togo
TKL|TK|Tokelau
TON|TO|Tonga
TTO|TT|Trinidad and Tobago
TUN|TN|Tunisia
TUR|TR|Türkiye|Turkey
TKM|TM|Turkmenistan
TCA|TC|Turks and Caicos Islands
TUV|TV|Tuvalu
UGA|UG|Uganda
UKR|UA|Ukraine
ARE|AE|United Arab Emirates|UAE
GBR|GB|United Kingdom|United Kingdom of Great Britain and Northern Ireland|UK|Great Britain
USA|US|United States of America|United States|USA
UMI|UM|United States Minor Outlying Islands
URY|UY|Uruguay
UZB|UZ|Uzbekistan
VUT|VU|Vanuatu
VEN|VE|Venezuela|Venezuela (Bolivarian Republic of)|Bolivarian Republic of Venezuela
VNM|VN|Viet Nam|Vietnam
VGB|VG|Virgin Islands (British)|British Virgin Islands|Virgin Islands (UK)|Virgin Islands, British
VIR|VI|Virgin Islands (U.S.)|United States Virgin Islands|US Virgin Islands
WLF|WF|Wallis and Futuna
ESH|EH|Western Sahara
YEM|YE|Yemen
ZMB|ZM|Zambia
ZWE|ZW|Zimbabwe
`;

const key = name => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  .trim().replace(/^the /, '');

const COUNTRIES = ROWS.trim().split('\n').map(line => {
  const [a3, a2, name, ...aliases] = line.split('|');
  return { a3, a2, name, aliases };
});
const BY_A3 = new Map(COUNTRIES.map(c => [c.a3, c]));
const BY_A2 = new Map(COUNTRIES.map(c => [c.a2, c]));
const BY_NAME = new Map();
for (const c of COUNTRIES) for (const n of [c.name, ...c.aliases]) BY_NAME.set(key(n), c);

/** The country a name stands for, or null. Codes are not accepted here: a name must be a name. */
const byName = name => BY_NAME.get(key(name)) || null;
/** The country of an alpha-3 code written exactly (upper case), or null. */
const byAlpha3 = code => BY_A3.get(String(code || '')) || null;
const byAlpha2 = code => BY_A2.get(String(code || '')) || null;

module.exports = { COUNTRIES, byName, byAlpha3, byAlpha2, key };
