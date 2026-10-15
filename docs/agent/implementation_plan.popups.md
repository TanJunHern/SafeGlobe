# Implementation plan: big report popups for Pond-Guard and BigQuery ML (requested 15 Oct 2026)

Status: **approved by the user on 15 Oct 2026 ("go ahead").** Train also opens the big popup (minimisable). Frontend only: no new API route, data field or
cloud resource. The three explainer clips (`01_pond_guard.html`, `02_document_ai.html`, `03_bigquery_ml.html`)
are the visual reference only; they are not served, edited or copied into the app.

## Why

Feedback: the Pond-Guard report in the entity drawer (440 px wide) is too small to read. The user wants it to open
large over a dimmed background, run left to right instead of top to bottom, and show Dilly's agents reading the
sources and producing the findings.

## Answers from the user (15 Oct 2026)

| Question | Answer |
| --- | --- |
| Which BigQuery ML clicks | All three, each tweaked: **Train** uses the `dilly_reading.svg` pose (training takes minutes); **Refresh predictions** opens the big popup (it is quick); **a case's prediction** opens the big popup too |
| Animation | Follows the **real run**: real events, real findings, real score. Nothing scripted or hard-coded |
| Minimise | Goes **back into the drawer** (Pond-Guard). For BigQuery ML there is no drawer, so it goes back to the "Dilly learns" card in Reviews |
| Document AI clip | Reference only for now |

## Design

One shared popup shell (`.bigview`), used by every report:
- Opens large (about 92 vw by 86 vh, maximum 1280 px wide) over a dimmed, blurred background.
- Header: title, subject, an "Offline sample" or "Live" pill, and a **Minimise** button. Esc and a click on the
  dimmed background also minimise. Minimising never stops the run.
- Focus moves into the popup and returns to the button that opened it. Under reduced motion every animation is
  skipped and the final state is shown.

### Pond-Guard (opens on "Screen with Pond-Guard" and "Screen again")

```
SOURCES        DILLY          AGENTS, one column each                       RESULT
▢ lists  ─┐                ┌ Sanctions ┬ PEP ┬ Media ┬ Ownership ┬ Country ┬ Vessel ┐   ╭────╮
▢ search ─┼─▶ (Dilly) ───▶ │  ring     │  ✓  │  ! 1  │   ! 1     │  ! 1    │  ! 3   │ ─▶│ 85 │ High
▢ registry┘   reading      │  finding cards with quote, source link and points    │   ╰────╯ Escalate
                           └───────────────────────────────────────────────────────┘   Dilly pose
```
- `agent_started`: a packet travels from Dilly to that column, and a spinner ring runs around its icon.
- `agent_done`: the ring stops, a badge pops in (green tick when nothing was found, amber or red when a finding was
  counted, grey when the agent did not answer), and the finding cards drop in under the column.
- `scored`: the score ring fills and counts up to the **real** score; the route and Dilly's route pose appear.
- `dilly`: Dilly's one-paragraph summary appears under the result.
- The source list on the left is built from the source names in the real findings, not a fixed list.
- On a phone-width screen the columns wrap into two rows.

### BigQuery ML

| Click | What opens |
| --- | --- |
| Train / Retrain | The `dilly_reading.svg` pose with the real training stage from `/api/learning/status` (reviews sent, training boosted trees, done or failed). It can be minimised; the "Dilly learns" card keeps showing the state as today |
| Refresh predictions | The big popup: the cases go through the model and come out as rows, each with its prediction and a "2nd look" flag where the model disagrees with the rules |
| A case's prediction | The big popup for that case: its prediction, its top reasons from the model, and what the rules said. It says plainly that the model never changes the risk score |

## Phases

| Phase | What | Gate |
| --- | --- | --- |
| P1 | Popup shell; Pond-Guard horizontal layout fed by the existing run object; Minimise back to the drawer | Opens, minimises and reopens; drawer unchanged |
| P2 | Pond-Guard animation driven by the real events (packets, rings, badges, score ring) | Aurora Venture shows the real 85 and route |
| | **`npm test`** | |
| P3 | BigQuery ML: Train with the reading pose, Refresh popup, case prediction popup | Each opens and shows real data, offline sample labelled |
| P4 | Browser check of every popup, reduced motion, phone width; docs and walkthrough | |
| | **`npm test`** | |

## Risks

- The drawer re-renders on every Pond-Guard event. The popup renders from the same run object, so both stay in step.
- Several runs at once: the popup belongs to one entity; opening another entity's run replaces it.
- Animations play once per real event (keyed with `DillyMotion` once-keys), never on a re-render.
