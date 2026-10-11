<!--
CONVERT TO: PDF. One PDF per case (3 files): vessel-green.pdf, vessel-orange.pdf, vessel-red.pdf
USE IN: Intake form > "Auto-fill from document" (employee portal or globe page).
These comment blocks do not render in a PDF. Delete them if your converter prints them.
Split at each "CASE" marker. One vessel per PDF.

IMO numbers here are real on purpose: the app now checks every IMO on VesselFinder and blocks one that does not exist.
The server needs internet access for that check. Position and destination change daily, so the route on the globe will differ from run to run.
All commercial details (owners, operators, charter terms, history) are invented for testing.

After auto-fill, check the Remarks field before submitting GREEN and ORANGE:
  it must not contain "dark", "transshipment", "anomaly", or the letters "sts" (as in "lists" or "costs").
  The vessel rule matches those inside Remarks and would raise the case.
-->

<!--
CASE: GREEN  |  save as vessel-green.pdf
EXPECTED: Entity type Vessel · Country DNK · IMO verified as MADRID MAERSK, no mismatch · Request status Approved · Screening Clear · AI result Low Risk · DDQ not required
GLOBE (with Ongoing Monitoring on): marker at last AIS position, arrowed route to the broadcast destination.
WHY: contract under SGD 100,000, Denmark flag (CPI 89, not a flag of convenience), name, flag and type match the registry.
-->

# Vessel Particulars and Charter Summary

**Document type:** Vessel particulars sheet (Q88 extract)
**Prepared for:** Meridian Commodities, Chartering Desk
**Date:** 2 October 2026

## Vessel identity

| Field | Details |
| --- | --- |
| Vessel name | MADRID MAERSK |
| IMO number | 9778791 |
| Flag | Denmark |
| Vessel type | Container ship |
| Year built | 2017 |
| Registered owner | Nordhavn Container Carriers A/S, Copenhagen |
| Commercial operator | Nordhavn Liner Services A/S, Copenhagen |
| Classification society | Member of IACS, class maintained |
| P&I cover | International Group club, in force |

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Customer/Trading Partner |
| Purpose | Slot booking for 40 containers of packaged lubricants, Singapore to Rotterdam |
| Anticipated contract value | SGD 90,000 |
| Period | Single voyage, November 2026 |

## Operating record, last 12 months

| Item | Record |
| --- | --- |
| Flag or name changes | None |
| Port state control detentions | None |
| AIS transmission | Continuous |
| Calls at restricted ports | None |

*Mock test document. The vessel identity is real so the IMO check can pass. Owner, operator and charter details are invented.*

<div style="page-break-after: always"></div>

<!--
CASE: ORANGE  |  save as vessel-orange.pdf
EXPECTED: Entity type Vessel · Country IDN · IMO verified as ANDHIKA VIDYANATA, no mismatch · Request status Pending DDQ · Screening Watchlist Match · AI result Medium Risk (score 62) · DDQ required
GLOBE (with Ongoing Monitoring on): pending marker at last AIS position, arrowed route if a destination is broadcast.
WHY: Policy §2.1 (contract over SGD 100,000) and §4.1 (Indonesia flag state, CPI 34, below 40).
NEXT: use ddq-vessel-orange.md in the counterparty DDQ portal.
-->

# Vessel Particulars and Charter Summary

**Document type:** Vessel particulars sheet (Q88 extract)
**Prepared for:** Meridian Commodities, Chartering Desk
**Date:** 3 October 2026

## Vessel identity

| Field | Details |
| --- | --- |
| Vessel name | ANDHIKA VIDYANATA |
| IMO number | 9823417 |
| Flag | Indonesia |
| Vessel type | Oil products tanker |
| Registered owner | PT Samudra Vidyanata Tankers, Jakarta |
| Commercial operator | Nusantara Tanker Management Pte Ltd, Singapore |
| Classification society | Member of IACS, class maintained |
| P&I cover | International Group club, in force |

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Customer/Trading Partner |
| Purpose | Six-month time charter for clean petroleum products between Singapore and East Java |
| Anticipated contract value | SGD 420,000 |
| Period | 1 December 2026 to 31 May 2027 |

## Operating record, last 12 months

| Item | Record |
| --- | --- |
| Flag or name changes | None |
| Port state control detentions | One, Surabaya, March 2026, released after 2 days (lifeboat davit defect, rectified) |
| AIS transmission | Continuous |
| Calls at restricted ports | None |

*Mock test document. The vessel identity is real so the IMO check can pass. Owner, operator, charter and inspection details are invented.*

<div style="page-break-after: always"></div>

<!--
CASE: RED  |  save as vessel-red.pdf
EXPECTED: Entity type Vessel · Country PAN · IMO 9876543 exists but is registered as TEST609, Vietnam flag
          Registry mismatch flagged on Name and Flag · Request status Pending DDQ · Screening High Risk · AI score 68 · DDQ required
          The AI chip reads "Medium Risk" because the score is under 75; the red signals are the screening result and the mismatch findings.
GLOBE (with Ongoing Monitoring on): pending marker near 11°N 107°E (approximate), no route (no destination broadcast).
WHY: Policy §2.1, §5.4 (Panama flag and AIS gaps), and the VesselFinder registry mismatch clause.
     Remarks must contain the word "dark" for the High Risk screening result.
NEXT: use ddq-vessel-red.md in the counterparty DDQ portal. The agent should recommend Escalate.
TO TEST THE HARD BLOCK INSTEAD: change the IMO to 9823411 (wrong check digit) or 1000007 (not on VesselFinder). Submission is refused.
-->

# Vessel Particulars and Charter Summary

**Document type:** Vessel particulars sheet supplied by the broker
**Prepared for:** Meridian Commodities, Chartering Desk
**Date:** 4 October 2026

## Vessel identity

| Field | Details |
| --- | --- |
| Vessel name | MT Black Heron |
| Former names | Sea Falcon (to 2024), Oriental Grace (to 2022) |
| IMO number | 9876543 |
| Flag | Panama (previously Cameroon, Palau) |
| Vessel type | Crude oil tanker |
| Year built | 2004 |
| Registered owner | Heron Maritime Holdings SA, Panama City |
| Commercial operator | Blue Reef Ship Management FZE, Sharjah |
| Classification society | Not a member of IACS |
| P&I cover | Certificate not provided |

## Proposed engagement

| Field | Details |
| --- | --- |
| Relationship type | Customer/Trading Partner |
| Purpose | Voyage charter, 700,000 barrels of crude oil, loading point to be advised at sea |
| Anticipated contract value | SGD 2,400,000 |
| Payment | Through a trading company in Hong Kong not party to the charter |

## Operating record, last 12 months

| Item | Record |
| --- | --- |
| Flag or name changes | Two name changes and two flag changes since 2022 |
| AIS transmission | Three dark periods of more than 24 hours each, in the Gulf of Oman and off eastern Malaysia |
| Ship-to-ship transfers | Four transfers at night off Johor with vessels that were not identified |
| Calls at restricted ports | Not declared. Port call list not provided |
| Ownership | Shares in the registered owner are held by nominees |

**Broker note:** AIS dark activity and repeated transshipment at sea. Owner declined to name the beneficial owner.

*Mock test document. The vessel name, owners, operator and history are invented. The IMO number is used only to exercise the registry mismatch check.*
