<!--
CONVERT TO: PDF. One PDF per case (3 files): person-green.pdf, person-orange.pdf, person-red.pdf
USE IN: Intake form > "Auto-fill from document" (employee portal or globe page).
These comment blocks do not render in a PDF. Delete them if your converter prints them.
Split at each "CASE" marker. Do not put two cases in one PDF: the extractor reads one counterparty per file.

After auto-fill, check the Remarks field before submitting:
  - GREEN and ORANGE must not contain the letters "PEP" (the rule engine matches that word in Remarks).
  - RED must have "PEP declared" ticked, or the word PEP in Remarks.
-->

<!--
CASE: GREEN  |  save as person-green.pdf
EXPECTED: Entity type Person · Country SGP · Request status Approved · Screening Clear · AI result Low Risk · DDQ not required
WHY: contract value under SGD 100,000, Singapore (CPI 84), not a broker, no public office.
-->

# Individual Counterparty Profile

**Document type:** Individual onboarding form with passport extract
**Prepared for:** Meridian Commodities, Procurement & Logistics
**Date:** 2 October 2026

## Personal details

| Field | Details |
| --- | --- |
| Full legal name | Rachel Tan Li Wen |
| Other names used | Rachel Tan |
| Date of birth | 14 March 1988 |
| Nationality | Singaporean |
| Country of residence | Singapore |
| Passport number | K4471209E |
| Passport expiry | 21 June 2031 |
| Residential address | 18 Bishan Street 22, #09-114, Singapore 570018 |
| Email | rachel.tan@rtlw-training.example |

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Vendor/Supplier |
| Services | Workplace safety and first-aid training for warehouse staff, 12 sessions |
| Anticipated contract value | SGD 48,000 |
| Contract period | 1 November 2026 to 31 October 2027 |
| Payment | Bank transfer to a personal account at DBS Bank, Singapore |

## Declarations by the individual

| Question | Answer |
| --- | --- |
| Do you hold, or have you held in the last 5 years, any public office or government position? | No |
| Is any close family member a government official? | No |
| Have you been investigated, charged or convicted of any offence? | No |
| Are you acting on behalf of another person or company? | No |

Signed: Rachel Tan Li Wen, 2 October 2026

*Mock test document. Not issued by any authority. All persons are fictional.*

<div style="page-break-after: always"></div>

<!--
CASE: ORANGE  |  save as person-orange.pdf
EXPECTED: Entity type Person · Country IDN · Request status Pending DDQ · Screening Watchlist Match · AI result Medium Risk (score 62) · DDQ required
WHY: Policy §2.1 (contract over SGD 100,000) and §4.1 (Indonesia, CPI 34, below 40).
NEXT: use ddq-person-orange.md in the counterparty DDQ portal.
-->

# Individual Counterparty Profile

**Document type:** Individual onboarding form with passport extract
**Prepared for:** Meridian Commodities, Procurement & Logistics
**Date:** 3 October 2026

## Personal details

| Field | Details |
| --- | --- |
| Full legal name | Budi Santoso Wirawan |
| Other names used | Budi S. Wirawan |
| Date of birth | 9 November 1979 |
| Nationality | Indonesian |
| Country of residence | Indonesia |
| Passport number | C4459012 |
| Passport expiry | 4 February 2029 |
| Residential address | Jalan Raya Darmo 88, Surabaya 60241, East Java, Indonesia |
| Email | budi@bsw-marinesurveys.example |

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Vendor/Supplier |
| Services | Independent cargo and draught surveys at Tanjung Perak and Gresik, on call for 12 months |
| Anticipated contract value | SGD 180,000 |
| Contract period | 1 November 2026 to 31 October 2027 |
| Payment | Bank transfer to Bank Mandiri, Surabaya, in the name of Budi Santoso Wirawan Marine Surveys |

## Declarations by the individual

| Question | Answer |
| --- | --- |
| Do you hold, or have you held in the last 5 years, any public office or government position? | No |
| Is any close family member a government official? | No |
| Have you been investigated, charged or convicted of any offence? | No |
| Are you acting on behalf of another person or company? | No. I trade as a sole proprietor. |

Signed: Budi Santoso Wirawan, 3 October 2026

*Mock test document. Not issued by any authority. All persons are fictional.*

<div style="page-break-after: always"></div>

<!--
CASE: RED  |  save as person-red.pdf
EXPECTED: Entity type Person · Country NGA · PEP declared Yes · Request status Pending DDQ · Screening PEP Alert · AI result High Risk (score 78) · DDQ required
WHY: Policy §3.6 (PEP), §2.1 (contract over SGD 100,000), §4.1 (Nigeria, CPI 26), §5.2 (intermediary).
NEXT: use ddq-person-red.md in the counterparty DDQ portal. The agent should recommend Escalate.
-->

# Individual Counterparty Profile

**Document type:** Individual onboarding form with passport extract
**Prepared for:** Meridian Commodities, Business Development
**Date:** 4 October 2026

## Personal details

| Field | Details |
| --- | --- |
| Full legal name | Olumide Bakare |
| Other names used | Chief O. Bakare |
| Date of birth | 27 July 1966 |
| Nationality | Nigerian |
| Country of residence | Nigeria |
| Passport number | A09872214 |
| Passport expiry | 15 January 2028 |
| Residential address | 14 Yakubu Gowon Crescent, Asokoro, Abuja, Nigeria |
| Email | chief@bakare-advisory.example |

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | 3rd Party Reps & Brokers |
| Services | Introductions to port and customs authorities, and help obtaining a bunkering licence |
| Anticipated contract value | SGD 750,000 |
| Fee basis | Success fee of 6% of the licence value, payable on award |
| Payment | 50% to Bakare Maritime Advisory Ltd in Nigeria, 50% to an account in Dubai in the name of a third party |

## Declarations by the individual

| Question | Answer |
| --- | --- |
| Politically Exposed Person (PEP) declaration | Yes. PEP declared. |
| Do you hold, or have you held in the last 5 years, any public office or government position? | Yes. Deputy Minister, Federal Ministry of Marine Resources, March 2019 to May 2023. |
| Is any close family member a government official? | Yes. My brother-in-law is a serving Comptroller in the customs service at Apapa port. |
| Have you been investigated, charged or convicted of any offence? | An anti-corruption commission opened an inquiry in 2022 into licence awards made during my term. It is not concluded. |
| Are you acting on behalf of another person or company? | Yes, for clients I am not able to name at this stage. |

Signed: Olumide Bakare, 4 October 2026

*Mock test document. Not issued by any authority. All persons, ministries and inquiries are fictional.*
