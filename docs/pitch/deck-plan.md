# DueDilly pitch deck: plan

Status: **built 15 Oct 2026.** Deck: https://gemini.ai/artifact/4YtJFBsw6FGyS8VM9gQAa9 (private until shared). GIFs: `docs/pitch/gifs/`, stills: `docs/pitch/stills/`. Re-record: `demovideo/record-gifs.js`, then `demovideo/make-gifs.js`.

## Rules for every slide

- One short sub-heading, and one plain line under it. Nothing else in text.
- The picture does the work: a GIF, a screenshot, a simple diagram, or Dilly.
- DueDilly's look: the pond palette (cream `#FBF6E9`, teal `#1F6F6B`, duck yellow `#F6DD8E`, bill orange
  `#EE8B3A`, risk green, amber and red), Fredoka for headings, Geist for text.
- Mascots from `assets/mascot/`, `assets/ddq/` and `assets/ducklings/`, one per slide at most, where it adds
  meaning (for example the concerned Dilly on the problem slide, the ducks in a row on the conclusion).
- All organisations, people and vessels are fictional. The demo slides say so once, in the footer.
- Format: a Gemini **Slides** artifact (16:9, presented in the browser, downloads as PPTX or PDF).

## Slide structure (29 slides)

| # | Section | Sub-heading | One line | Visual | Mascot |
| --- | --- | --- | --- | --- | --- |
| 1 | Hook | A tanker went dark for 31 hours | Your supplier manages it. Would you sign? | Aurora Venture's dark track on the map | `dilly_v3_concerned` |
| 2 | Introduction | Know who you do business with | Before paying a supplier or chartering a ship, compliance checks who they are. | Title card | `dilly_v3_neutral` |
| 3 | Introduction | KYC: screen the counterparty | Sanctions, PEPs, adverse media, ownership and country risk. | Five icons | none |
| 4 | Introduction | DDQ: ask them directly | A questionnaire the counterparty fills in, signs and returns. | DDQ portal still | `mommy_duck` + ducklings |
| 5 | Introduction | How it works today | Request, screen, questionnaire, review, monitor. | 5-step flow | none |
| 6 | Problem | Slow, manual, hard to explain | Lists checked by hand, answers retyped, scores no one can trace. | Three pain points | `dilly_v3_concerned` |
| 7 | Problem | AI alone is not the answer | A model that picks the score cannot be audited or trusted. | Black box vs traced score | `dilly_error` |
| 8 | Solution | Meet DueDilly | AI agents read the sources, the rules score, a person decides. | Logo + Dilly | `dilly_v3_happy` |
| 9 | Solution | Get your ducks in a row | Screen, ask and decide in one place, with every point explained. | Three pillars | ducklings |
| 10 | Demo | See it work | One case from request to decision, in ten short clips. | Divider | `dilly_reading` |
| 11 | Demo 1 | Sign in | An employee opens DueDilly with Google sign-in or a demo account. | GIF 1 | |
| 12 | Demo 2 | Request a check | John fills one form, reads the instant screening, sends the DDQ. | GIF 2 | |
| 13 | Demo 3 | Ask Dilly | A plain question gets a plain answer, linked to the case. | GIF 3 | |
| 14 | Demo 4 | Auto-fill and submit | Dilly reads the document, fills the answers, the ducks line up. | GIF 4 | |
| 15 | Demo 5 | Review and approve | Grace checks the answers against the evidence and approves. | GIF 5 | |
| 16 | Demo 6 | On the globe | The approved counterparty joins the watchlist and is monitored. | GIF 6 | |
| 17 | Demo 7 | Pond-Guard screening | Six agents read the sources; every point traces to a finding. | GIF 7 | |
| 18 | Demo 8 | Reviews | Cases sorted by risk and confidence, tab by tab. | GIF 8 | |
| 19 | Demo 9 | Dilly learns | Trained on officers' red and green marks, it suggests a 2nd look. | GIF 9 | |
| 20 | Demo 10 | Add a source | Connect a third-party API and every screening reads it. | GIF 10 | |
| 21 | AI agents | Meet the agents | Each one does one job and shows its work. | Divider | `dilly_v3_focused` |
| 22 | AI agents | Pond-Guard | An ADK coordinator runs six screening agents in parallel. | Popup screenshot (`01_pond_guard.html` style) | |
| 23 | AI agents | Document AI | Reads a returned PDF and maps each field to a DDQ question. | Duck-Scanner screenshot (`02_document_ai.html` style) | |
| 24 | AI agents | BigQuery ML | Boosted trees learn from reviews and flag likely misses. | Training popup screenshot (`03_bigquery_ml.html` style) | |
| 25 | AI agents | And the helpers | Ask Dilly, crawler agents, Ripples triage, reviewer copilot. | 4 small cards | |
| 26 | Summary | The AI understands, the rules score | Read, understand, check, score, weigh, route. A person decides. | 6-step pipeline | `dilly_done` |
| 27 | Summary | Built on Google | Gemini, ADK, Agent Search, Document AI, BigQuery ML, Cloud Run. | Tech stack grid | none |
| 28 | Conclusion | Get your ducks in a row | Faster checks, every score explained, a person always decides. | Link to the live app | `banner_all_in_a_row` |
| 29 | Credits | Thank you | The team behind DueDilly. | Names | `dilly_v3_happy` |

## The ten demo GIFs

Recorded with Playwright on this computer (reusing `demovideo/lib.js`: a drawn pointer, 1920x1080), then cut and
turned into GIFs. Target per GIF: 8 to 15 seconds, 1280x720, about 12 frames a second, under 8 MB.

| GIF | Who | Steps on screen |
| --- | --- | --- |
| 1 | Landing | The sign-in page with the globe; choose John Doe (employee) |
| 2 | Employee | New KYC request; upload the prepared intake form, the fields fill in; submit; read the screening result; Send DDQ (the paper plane) |
| 3 | Counterparty | The one-time DDQ link; Ask Dilly in the portal: a question about a DDQ item, Dilly's answer |
| 4 | Counterparty | Upload the prepared DDQ answers; Dilly auto-fills; confirm; sign; submit (mommy duck waddles in) |
| 5 | Compliance officer | Compliance tab; open the case; answers vs evidence; Approve (the stamp) |
| 6 | Compliance officer | Globe tab; the newly approved counterparty on the watchlist and map |
| 7 | Compliance officer | Globe; Aurora Venture; Screen with Pond-Guard; the big popup; the score lands on 85; read the review |
| 8 | Compliance officer | Reviews tab; the case queue, then each tab in turn |
| 9 | Compliance officer | Dilly learns; Train; the stages; See the predictions; open one case |
| 10 | Compliance officer | Sources; Add source; API; fill the connection; save |

## AI agents slides (phase 2)

Screenshots of the agents as they appear in the app, framed in the style of the explainer clips
(`01_pond_guard.html`, `02_document_ai.html`, `03_bigquery_ml.html`): the big Pond-Guard popup, the Duck-Scanner
reading a PDF, and the BigQuery ML training popup.

## Summary and tech stack (phase 3)

One pipeline slide (the six steps that are already in the app) and one tech stack slide, with every Google
technology the app really uses, each named once.

## Questions

1. **Live or offline when recording.** Your API key is over its quota. Should I record with the agents on
   **Vertex AI** (your UAT settings: real agent output, a few cents of cost, needs your OK under rule 13), or
   **offline** (the screens show "Offline sample" and "Offline model")?
2. **GIF tool.** Turning recordings into GIFs needs `ffmpeg`, which is not installed. May I run
   `brew install ffmpeg`?
3. **GIF 3, Ask Dilly.** Who asks: the **counterparty** in the DDQ portal (your `15-ddq-ask-dilly.png`), or the
   **compliance officer** on the globe (Ask Dilly, Cmd+K)? And what question?
4. **One story through GIFs 2 to 6.** One counterparty should go from John's request to Grace's approval and onto
   the globe. Which one: a new, clean, fictional supplier (it can be approved), or an existing demo record? Aurora
   Venture stays for GIF 7, since it is escalated and would not be approved.
5. **GIF 10, third-party API.** Which provider should appear: a real one you actually connect to (which?), or a
   fictional one labelled as a demo?
6. **Problem slide numbers.** Do you have figures you can cite (for example from `Final PRD.pdf`), with their
   sources? Without them, slides 6 and 7 stay qualitative. I could not read the PDF here.
7. **Credits.** Team members' names and roles, the team name, and the hackathon name.
8. **Time slot.** How long is the pitch, and do you want speaker notes on each slide?

## Answers (15 Oct 2026)

1. Record with the agents on **Vertex AI**; if that does not work, record offline (the screens then say so).
2. `ffmpeg` may be installed.
3. GIF 3: **Ask Dilly in the counterparty's one-time DDQ link**.
4. A **new fictional supplier** for GIFs 2 to 6. Prepare its forms first (the intake form and the DDQ answers),
   then upload them while recording.
5. GIF 10: a **fictional API provider**, labelled as a demo.
6. Problem slides: **placeholders** pointing at `Final PRD.pdf`, to be filled in by the team.
7. Credits: **Jun Hern** and **Hudzaifah**.
8. Time slot not set: add **technical speaker-note placeholders**.
