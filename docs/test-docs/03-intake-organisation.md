<!--
CONVERT TO: PDF. One PDF per case (3 files): organisation-green.pdf, organisation-orange.pdf, organisation-red.pdf
USE IN: Intake form > "Auto-fill from document" (employee portal or globe page).
These comment blocks do not render in a PDF. Delete them if your converter prints them.
Split at each "CASE" marker. One company per PDF.

After auto-fill, check the Remarks field before submitting:
  - GREEN and ORANGE must not contain the letters "PEP" (the rule engine matches that word in Remarks).
  - RED must contain the word "PEP" in Remarks. Type it in if the extractor left it out.
-->

<!--
CASE: GREEN  |  save as organisation-green.pdf
EXPECTED: Entity type Organisation · Country SGP · Request status Approved · Screening Clear · AI result Low Risk · DDQ not required
WHY: contract under SGD 100,000, Singapore (CPI 84), supplier not a broker, no public officials.
-->

# Business Profile Extract

**Document type:** Company registry business profile
**Prepared for:** Meridian Commodities, Procurement & Logistics
**Date of extract:** 1 October 2026

## Company details

| Field | Details |
| --- | --- |
| Registered name | Tembusu Office Supplies Pte Ltd |
| Registration number (UEN) | 201918834K |
| Country of incorporation | Singapore |
| Date of incorporation | 12 June 2019 |
| Legal form | Private company limited by shares |
| Status | Live |
| Registered address | 31 Ubi Road 1, #04-12, Singapore 408694 |
| Principal activity | Wholesale of stationery and office equipment |
| Parent company | None |

## Directors and shareholders

| Name | Role | Nationality | Shareholding |
| --- | --- | --- | --- |
| Lim Hui Min | Director, shareholder | Singaporean | 70% |
| Goh Jun Wei | Director, shareholder | Singaporean | 30% |

Beneficial owners: Lim Hui Min (70%), Goh Jun Wei (30%).

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Vendor/Supplier |
| Goods | Office consumables and printer supplies for the Singapore office |
| Anticipated contract value | SGD 60,000 |
| Contract period | 12 months from 1 November 2026 |
| Contact email | accounts@tembusu-office.example |

No director or shareholder holds a public office. No litigation or regulatory action is recorded.

*Mock test document. Not issued by any registry. The company and persons are fictional.*

<div style="page-break-after: always"></div>

<!--
CASE: ORANGE  |  save as organisation-orange.pdf
EXPECTED: Entity type Organisation · Country IND · Request status Pending DDQ · Screening Watchlist Match · AI result Medium Risk (score 62) · DDQ required
WHY: Policy §2.1 (contract over SGD 100,000) and §4.1 (India, CPI 39, below 40).
NEXT: use ddq-organisation-orange.md in the counterparty DDQ portal.
-->

# Business Profile Extract

**Document type:** Certificate of incorporation with company master data
**Prepared for:** Meridian Commodities, Procurement & Logistics
**Date of extract:** 2 October 2026

## Company details

| Field | Details |
| --- | --- |
| Registered name | Coromandel Agri Exports Private Limited |
| Registration number (CIN) | U01100TN2014PTC098765 |
| Country of incorporation | India |
| Date of incorporation | 3 September 2014 |
| Legal form | Private limited company |
| Status | Active |
| Registered address | 42 Rajaji Salai, George Town, Chennai 600001, Tamil Nadu, India |
| Principal activity | Export of rice, pulses and spices |
| Parent company | None |

## Directors and shareholders

| Name | Role | Nationality | Shareholding |
| --- | --- | --- | --- |
| Karthik Subramanian | Managing Director, shareholder | Indian | 55% |
| Meenakshi Iyer | Director, shareholder | Indian | 45% |

Beneficial owners: Karthik Subramanian (55%), Meenakshi Iyer (45%).

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Vendor/Supplier |
| Goods | 1,200 tonnes of basmati rice, shipped from Chennai in four lots |
| Anticipated contract value | SGD 320,000 |
| Contract period | 12 months from 1 December 2026 |
| Contact email | exports@coromandel-agri.example |

No director or shareholder holds a public office. No litigation or regulatory action is recorded.

*Mock test document. Not issued by any registry. The company and persons are fictional.*

<div style="page-break-after: always"></div>

<!--
CASE: RED  |  save as organisation-red.pdf
EXPECTED: Entity type Organisation · Country MMR · Request status Pending DDQ · Screening PEP Alert · AI result High Risk (score 78) · DDQ required
WHY: Policy §3.6 (PEP beneficial owner), §2.1 (contract over SGD 100,000), §4.1 (Myanmar, CPI 20, high-risk jurisdiction).
     The PEP rule fires on the word "PEP" in Remarks.
NEXT: use ddq-organisation-red.md in the counterparty DDQ portal. The agent should recommend Escalate.
-->

# Business Profile Extract

**Document type:** Company registry extract with ownership statement
**Prepared for:** Meridian Commodities, Trading
**Date of extract:** 3 October 2026

## Company details

| Field | Details |
| --- | --- |
| Registered name | Mandalay Hills Resources Co., Ltd. |
| Registration number | 118765432 |
| Country of incorporation | Myanmar |
| Date of incorporation | 21 January 2021 |
| Legal form | Private company limited by shares |
| Status | Registered |
| Registered address | 77 Strand Road, Kyauktada Township, Yangon, Myanmar |
| Principal activity | Trading of timber, tin concentrate and rare earth ore |
| Parent company | Mandalay Hills Holdings Ltd, British Virgin Islands |

## Directors and shareholders

| Name | Role | Nationality | Shareholding |
| --- | --- | --- | --- |
| U Kyaw Zin Htet | Chairman, shareholder | Myanmar | 60% (held through the parent) |
| Daw Nilar Htun | Director, shareholder | Myanmar | 20% |
| Northern Resources Enterprise (state-owned) | Shareholder | Myanmar | 20% |

Beneficial owner: U Kyaw Zin Htet (60%).

**Politically Exposed Person (PEP) statement:** PEP declared. U Kyaw Zin Htet is a serving Deputy Director-General at the Ministry of Natural Resources Enterprise.

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Customer/Trading Partner |
| Goods | Purchase of 3,000 tonnes of tin concentrate, loaded at Yangon |
| Anticipated contract value | SGD 1,800,000 |
| Payment | To an account in Dubai held by a company that is not party to the contract |
| Contact email | trade@mandalayhills-resources.example |

Registry note: the shareholder register was last filed in 2021. Audited accounts have not been filed.

*Mock test document. Not issued by any registry. The companies, persons and ministries are fictional.*
