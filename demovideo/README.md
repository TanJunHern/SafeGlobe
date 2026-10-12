# DueDilly demo clips

21 clips, 1920x1080 `.webm`, no sound, about 4 minutes in all. Each clip is under 20 seconds. Waiting (agents
thinking, a document being read) was done between clips, off camera. A pointer is drawn into the page so the
viewer can follow the clicks. Recorded on 12 Oct 2026 with Playwright against the app running on this computer.

| Clip | Script scene (`DEMO_GUIDE.md`) | What it shows |
| --- | --- | --- |
| `01-globe-intro` | The idea | The globe opening into the map, the watchlist, the Ripples ticker |
| `02-employee-new-request` | One form | John Doe opens New KYC Request: name, Myanmar, relationship, SGD 1,800,000 |
| `03-employee-request-details` | One form | Location, contact email, the remark that the owner is a PEP |
| `04-employee-submit-screened` | Screened on submit | Submit; the new row: Pending DDQ, PEP Alert, Medium Risk |
| `05-employee-send-ddq` | Screened on submit | The request's drawer; Send DDQ to Counterparty; the one-time link |
| `06-supplier-portal-ducks` | Dilly reads the document | The counterparty portal with the ducks; Upload a document |
| `07-supplier-74-suggestions` | Dilly reads the document | 74 answers suggested, each with the words it came from; Confirm all |
| `08-supplier-denies-pep` | (set-up for the next scene) | Section 3: the supplier changes 3.2 (a PEP among the owners?) to No |
| `09-compliance-review-opens` | Catch the contradiction | Grace Teo opens the review: three columns, the Compliance Agent |
| `10-answer-verification` | Catch the contradiction | Answer verification: the answer and the finding, both quoted |
| `11-copilot-draft` | Draft the note | Draft with Dilly: the AI draft with citations, computed route Escalate (65) |
| `12-pond-guard-starts` | Five agents | Aurora Venture; Screen with Pond-Guard; five agents reading |
| `13-pond-guard-findings` | Five agents | Each agent's findings with quotes and sources |
| `14-why-85` | One traceable score | "Why 85?": points, rule, policy clause found by Agent Search, the total |
| `15-policy-search-agent-search` | (extra) | Policy search answered by Agent Search |
| `16-crawler-agent-publishes-change` | (extra) | A crawler agent's source; the demo page publishes a change |
| `17-ripple-and-rescreen` | (extra) | "Read, the page changed"; a High ripple; "Screened again: 85 of 100" |
| `18-reviews-likely-miss` | Dilly learns | Case queue: Halcyon Marine, 59%, Likely miss; marked Red |
| `19-dilly-learns-bigquery-ml` | Dilly learns | The BigQuery ML card: six tuning trials, results, the suggestion |
| `20-risk-confidence-prediction` | Dilly learns | The chart: a ring on Halcyon; risk, confidence and prediction explained |
| `21-close-globe` | Close | Back to the globe |

## What is live and what is replayed

Live during recording, on your own Google Cloud sign-in: Gemini on Vertex AI (document reading, answer
verification, the copilot draft, alert triage), the ADK agents (Pond-Guard, the crawler agent), Grounding with
Google Search, Agent Search, and BigQuery ML **predictions** (the model trained on 12 Oct was asked for its
prediction on each demo case).

Replayed: the **training card** in clip 19 (tuning trials and test results). Training takes 27 minutes, so the
figures of the real run of 12 Oct 2026 on `duedilly_uat.review_risk_model` are shown. Nothing on it is invented,
but it was not trained during the recording. The app itself was running its offline model; `record.js` put
BigQuery ML's output on the screen. Say so if a judge asks.

Not used: Document AI (the supplier uploaded a text file, which Gemini reads), Pub/Sub and Cloud Storage (the
local app handles events itself and keeps snapshots in a folder; the footer of clips 16 and 17 says so).

## Record again

```
bash demovideo/start-local.sh          # local app and agents, fresh demo database
node demovideo/record.js               # every scene, into demovideo/clips/
node demovideo/record.js 6 --from=11   # only scene 6, numbering continued after clip 11
bash demovideo/start-local.sh stop
```

The Pond-Guard and crawler scenes retake themselves when a live agent drops its connection or returns a
different score, so a run can take a few minutes longer. Stills of each clip's last frame are in
`demovideo/.data/shots/`.
