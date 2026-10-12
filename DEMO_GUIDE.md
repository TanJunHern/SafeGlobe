# DueDilly demo guide

A step-by-step script for showing DueDilly end to end: an employee wants to work with a counterparty, the
counterparty is screened, a due diligence questionnaire (DDQ) goes out and comes back, and compliance reviews the
case with AI. Each step says what to click, what you will see, what to say, and which Google technology is at work.

- **Link:** https://duedilly-uat-gqthvx5oha-as.a.run.app
- **Length:** about 8 minutes for everything, about 3 minutes for the short cut in section 9.
- **All organisations, people and vessels in the demo are fictional.**

The numbers in this guide were measured on 12 Oct 2026 by running the same steps on a local copy of the app
against Gemini on Vertex AI. Where a step has not been run on the link itself, the guide says so.

---

## 1. The idea in three sentences

**The AI understands, the rules score, a person decides.**
Gemini and the agents read sources and turn them into findings, each with a quote and a source. A fixed points
table turns findings into a risk score, so every point can be traced. A trained model then learns from how
compliance officers classify cases and flags the ones the rules may have missed.

## 2. Google technology, and where it shows

| Technology | What it does in DueDilly | Where you show it |
| --- | --- | --- |
| **Google ADK** | Runs the agents: Pond-Guard (five screening sub-agents in parallel), Ask Dilly, one crawler agent per website | Step 16, step 19 |
| **Gemini on Vertex AI** | The model behind the agents, the copilot draft, alert triage, answer verification, document reading | Steps 9, 12, 13, 16 |
| **Grounding with Google Search** | The adverse media agent searches the web; only pages Google returned can be cited | Step 16 |
| **Agent Search** | Finds the policy clause each scoring rule relies on | Step 17 |
| **Document AI** (Form Parser) | Reads an uploaded PDF or image questionnaire, with a confidence per field | Step 9 (PDF only) |
| **BigQuery ML** | Trains the review model (boosted trees, with hyperparameter tuning) on officers' red and green marks | Steps 20 to 22 |
| **Pub/Sub, Cloud Scheduler** | Carry events (alert raised, source changed, re-screen); weekly crawl | Step 19 |
| **Cloud Storage** | Keeps a snapshot of every page a crawler agent reads | Step 19 |
| **Cloud Run** | Hosts the app and the agents service | The link itself |
| **Secret Manager, Google sign-in** | Secrets for Cloud Run; staff sign-in | Not shown |

## 3. Prepare, 40 minutes before

Do these in order. Skipping the first two leaves parts of the demo empty.

1. **Keep the app awake.** Cloud Run sleeps when idle, and a restart wipes everything in the app (cases, the
   trained state). Deploy once with one instance kept warm, then do not deploy again before the demo:
   ```
   MIN_INSTANCES=1 bash scripts/deploy.sh uat
   ```
2. **Train the review model.** Sign in as Grace Teo > Reviews > **Dilly learns** > **Add synthetic demo data
   (800 reviews)** > **Train the model**. It runs on BigQuery ML and takes about **27 minutes**. Leave the page
   open. When it is done the card says "BigQuery ML (boosted trees)".
3. **Rehearse the changed-page step once** (step 19). It has never been run on the link. If no ripple appears
   within 30 seconds, leave step 19 out and tell Gemini.
4. **Have two browser windows ready:** a normal window for staff, and a private (incognito) window for the
   counterparty, who has no account.
5. **Have this file ready to upload:** `docs/test-docs/ddq-organisation-red.md` (in this repo).
6. Pond-Guard is limited to 30 live runs a day on the link. One rehearsal uses one.

## 4. The case

| | |
| --- | --- |
| Counterparty | **Mandalay Hills Resources Co., Ltd.** (fictional) |
| Deal | Buying tin concentrate, SGD 1,800,000 |
| Country | Myanmar (CPI 2025 score 20) |
| The catch | Its beneficial owner is a serving government official: a politically exposed person (PEP) |

---

## Part A. The employee asks to work with a counterparty

**1. Sign in as the employee.** Open the link > **John Doe · Employee**. You land on the employee page: a table
of his KYC requests.

**2. Press "New KYC Request"** and fill in:

| Field | Value |
| --- | --- |
| Counterparty Name | `Mandalay Hills Resources Co., Ltd.` |
| Entity Type | Organisation |
| Country | Myanmar |
| Relationship Type | Customer/Trading Partner |
| Anticipated Contract Value (SGD) | `1800000` |
| Ongoing Monitoring | On |
| Address | any address (pick a landmark chip if the map search is off) |
| Counterparty Contact Email | `trade@mandalayhills-resources.example` |
| Remarks & Commercial Context | `PEP declared: beneficial owner U Kyaw Zin Htet is a serving Deputy Director-General.` |

The word "PEP" in Remarks matters: the offline rule engine reads it.

> **Say:** "John wants to buy from a new supplier. He does not need to know the compliance policy. He fills in
> one form."

**3. Press "Submit KYC Request".** In a second or two the new row shows:

| You see | Value |
| --- | --- |
| Request status | **Pending DDQ** |
| Screening result | **PEP Alert** |
| AI result | **Medium Risk** |
| Policy clauses | §2.1 (contract over SGD 100,000), §3.6 (PEP), §4.1 (CPI below 40) |

> **Say:** "The counterparty was screened the moment he pressed submit: sanctions and PEP lists, country risk,
> and the company policy. Three policy clauses fired, so a due diligence questionnaire is required."

**What happened behind the screen.** The score is **50 of 100**: PEP owner +25, high-risk country +20, contract
value +5. Those numbers come from the points table, not from a model. The Compliance Agent's first stage
recommends "Require DDQ". This step is rules; the AI comes in at steps 9 to 22. Say that plainly if asked.

## Part B. The questionnaire goes out

**4. Open the new request** (click its row) to see the audit drawer.

**5. Press "Send DDQ to Counterparty".** The DDQ status changes to **Sent to Counterparty**.

**6. Press "Copy Link".** This is a signed, one-time link, valid for 14 days. It is the counterparty's only way in.

> **Say:** "The supplier gets a secure link. No account, no password. The link locks after they submit."

Today the employee copies the link and sends it himself. Automatic email is not built.

## Part C. The counterparty answers

**7. Paste the link into the private window.** The DDQ portal opens with Dilly and seven sections, 77 questions.

**8. On the welcome page press "Upload a document"** and choose `docs/test-docs/ddq-organisation-red.md`.

**9. Wait about 10 seconds.** The portal says it suggested **74 answers**. This is **Duck-Scanner**.

> **Say:** "The supplier already has this information in a document. Dilly reads it and suggests the answers.
> Each suggestion carries the exact words it came from, and the supplier has to confirm every one. Dilly never
> submits for them."

- With a text or Markdown file, **Gemini on Vertex AI** reads it (this run: 9.6 seconds, 74 answers).
- With a **PDF or an image**, **Document AI** (Form Parser) reads the page first and reports how sure it is of
  each field, then Gemini maps the fields to question numbers. Answers under 75% show
  **"Not sure (NN%). Please check"**. To show this, upload any filled-in PDF form instead.

**10. Go through the sections.** On each page press **"Confirm all on this page"**, then Next. Three things to do
on the way:

| Where | Do this | Why |
| --- | --- | --- |
| Question **3.2** (is any owner or director a PEP?) | Change the answer from Yes to **No** | This plants the lie that compliance will catch in step 13 |
| Question **6.11** | Type a sentence of details (15 characters or more) | The portal will not accept a bare "Yes" |
| Declaration (last page) | Tick the box; type a full name, a job title, the date and a signature | Required before submitting |

**11. Press Submit.** The portal locks and says the questionnaire is under compliance review.

> **Say:** "The supplier has just told us nobody in the company is a politically exposed person."

## Part D. Back to compliance: the review, with AI

**12. In the normal window, sign out and sign in as "Grace Teo · Compliance officer".** Open **Compliance**. The
request is at the top with status **DDQ Under Review**. Press **Review**.

The dialog has three columns: what the employee submitted, what the counterparty answered, and the Compliance
Agent's assessment.

**13. Middle column: "Answer verification".** It shows **1 contradiction**:

| | |
| --- | --- |
| The questionnaire says | "Is any director, officer, shareholder or Beneficial Owner a ... Politically Exposed Person (PEP)?" **No** |
| The screening found | "PEP declared: beneficial owner U Kyaw Zin Htet is a serving Deputy Director-General." |
| Checked by | Gemini (gemini-3.5-flash-lite) |

> **Say:** "Dilly compared the supplier's answers with what the screening found. The supplier said no PEP. The
> evidence says the owner is a serving official. Both sides are quoted, so the reviewer can judge it. It adds
> fifteen points, once."

The score moves from **50 to 65**. If the supplier had answered honestly (3.2 Yes), there is no contradiction
and the score stays at 50. That was checked.

How it works: which answers are compared with which findings is fixed in code (a "No" on PEP against a PEP
finding, a "No" on sanctions against a sanctions finding, and so on). **Gemini on Vertex AI** is asked one thing
per pair: do these two statements contradict each other? It can only judge the pairs it was given.

**14. Press "Draft with Dilly"** above the memo box. In about 2 seconds the box fills with a summary and a
decision reason. This is the **reviewer copilot**.

> **Say:** "Gemini drafts the case note from the findings. It has to cite the finding ids and the policy
> clauses, and we check every citation. It is not allowed to state its own score or choose the route: if it
> does, the draft is thrown away. It is labelled AI draft, and Grace edits it before she signs."

The line beside the button reads: "AI draft · Gemini (gemini-3.5-flash-lite) · computed route: Escalate (65 of
100)". The draft cites §3.6, §4.1 and §2.1.

**15. Edit a few words, then press Approve, Bounce back to counterparty, or Reject.** Both the AI draft and
Grace's final text are stored.

> **Say:** "A person signs every decision. The AI's draft and the human's final words are both kept for audit."

---

## Part E. How the AI reaches a score (the deep dive)

Use the built-in case **Aurora Venture** here. Its numbers are verified.

**16. Globe > watchlist > Aurora Venture > "Screen with Pond-Guard".** Five rows appear, one per agent
(Sanctions, PEP, Adverse media, Ownership, Vessel behaviour), each going from "Reading…" to its findings. About
20 seconds.

> **Say:** "This is Google's Agent Development Kit. A coordinator runs five specialist agents in parallel, each on
> Gemini on Vertex AI. The sanctions and PEP agents only see our own lists. Only the adverse media agent may
> search the web, through Grounding with Google Search, and it can only cite a page Google actually returned."

What keeps the agents honest, all in code: a finding must cite evidence the agent was given and quote it
exactly; a sanctions match is only "confirmed" with a second identifier; news about a namesake is left out. Left-out
findings are stored with the reason.

**17. Scroll to "Why 85?"** One row per finding: the points, the rule, the policy clause, the quote and the
source. AIS dark +20, ship-to-ship transfer +20, flag changes +10, Cameroon (CPI 26) +20, ownership unclear +15.
Total **85, High, Escalate**.

> **Say:** "Every point traces to a finding, a rule and a source. The clause text beside each rule was found by
> Agent Search in our policy files."

Each row with a policy clause shows the clause text and "Found by Agent Search".

**18. Policies > "Policy search".** Type `when is a vessel questionnaire required?`. The top result is clause
§5.4. The card says "Agent Search".

**19. Sources > "Crawler agents" > "Add the demo page" > "Publish a change".** The demo page is a fictional port
authority notice board served by DueDilly. A new notice names Aurora Venture. Within about 30 seconds the bell
shows a **High** ripple for Aurora Venture with "Screened again: 85 of 100, Escalate".

> **Say:** "Each website source has its own crawler agent. It obeys robots.txt, never signs in, and keeps a
> snapshot of the page in Cloud Storage. When a page changes, an event goes through Pub/Sub, Gemini rates the
> alert, and a high one triggers a re-screen."

Not yet run on the link. Rehearse it (section 3, item 3).

## Part F. The reviews tab: Dilly learns from the officers

**20. Reviews > "Case queue".** Each case shows "NN% likely real risk" and two buttons, **Red** and **Green**.
**Halcyon Marine** scored 40 under the rules and was auto-cleared, but it is listed with a **Likely miss** flag.

> **Say:** "This is machine learning, not a language model. The compliance officer marks a case red for real
> risk or green for not a risk. Every mark is a training example. The model predicts how an officer would mark a
> new case, and flags the ones the rules scored low. That is how we attack false negatives."

On the link on 12 Oct, Halcyon showed 59% and "Likely miss" with "Points from vessel behaviour" as the top
reason.

**21. Press Red on Halcyon Marine.** A message confirms the mark and says it differs from the rules.

**22. Open "Dilly learns".** Four cards and a glossary:

| Card | What to point at |
| --- | --- |
| 1. Training data | How many reviews, and how many are synthetic |
| 2. Training and hyperparameter tuning | "BigQuery ML (boosted trees)" and the table of six tuning trials, the kept one highlighted |
| 3. How good is it? | Measured on reviews it never saw: low-scored risks caught, recall, precision |
| 4. Predictions and suggestions | The likely misses, with the reasons |

> **Say:** "The more you review, the better the model gets at how your team classifies risk. It never changes a
> score or a route. It suggests a second look, and a person decides."

Do **not** press Retrain on stage: it takes about 27 minutes on BigQuery ML.

**23. "Risk and confidence" tab.** A red ring marks Halcyon in the Auto-clear quadrant. The text under the chart
explains the three signals: risk from the rules, confidence from the evidence, prediction from past reviews.

---

## 8. What to say honestly

- **The review model is trained on synthetic reviews.** Say: "This is the learning loop. It trains on your
  officers' real decisions as they accumulate." Do not quote its accuracy as real-world accuracy.
- **The risk score is not AI.** It is added up from a points table. That is deliberate: it is what makes every
  point traceable.
- **The intake screening in step 3 is rules.** The agents (step 16) and the model (step 20) are the AI.
- **Everything shown is fictional demo data.**

## 9. The 3-minute version

| Time | Steps | Line |
| --- | --- | --- |
| 0:00 | 2, 3 (form filled in beforehand) | "One form. Screened on submit. Three policy clauses fire." |
| 0:30 | 8, 9 (link open beforehand) | "Dilly reads the supplier's own document and suggests answers." |
| 1:00 | 13, 14 (questionnaire submitted beforehand) | "It catches the contradiction, and drafts the case note with citations." |
| 1:45 | 16, 17 | "Five agents on ADK and Gemini. Every point traces to a source." |
| 2:25 | 20, 22 | "And it learns from the officers: BigQuery ML flags the risks the rules missed." |

## 10. Do not show

| What | Why |
| --- | --- |
| Reviews > **Calibration** tab | Its figures ("97.4%, n = 1,906") are placeholders |
| Globe > **forecast** layer | Its six numbers are placeholders; the real forecast is not built |
| **Retrain** in Dilly learns | About 27 minutes |
| Sources cards "MAS enforcement actions" and "Indonesia regulation monitor" | Demo cards with no crawler behind them |

Not built, so do not promise: the Quack-Back chat, automatic DDQ email, the "How Dilly works" page.

## 11. If something goes wrong

| You see | Cause | Do this |
| --- | --- | --- |
| "Offline sample" under Pond-Guard | The agents service is waking up, or the daily limit of 30 is used | Wait 20 seconds and press again; the reason is written under it |
| Dilly learns shows no model | The app restarted | Add synthetic data and train again (27 minutes), or show the screens from a recording |
| The questionnaire will not submit | A section is incomplete | The message names the question; usually 6.11 details or the declaration |
| No ripple in step 19 | The Pub/Sub round trip failed | Skip the step; tell Gemini |
| "Dilly needs a short rest" | 20 AI requests in 10 minutes from one address | Wait, or raise `AI_RATE_LIMIT_MAX` in `.env.uat` and redeploy before the demo |
| Answer verification shows nothing | The questionnaire was not submitted, or the case has no finding to compare with | Press "Check answers against findings" |

## 12. Known gaps in this guide

- Steps 1 to 15 were run through the app's API on a local copy, not clicked through on the link. The results
  (statuses, scores, the contradiction, the draft) are real; the exact position of a button may differ slightly.
- Step 13 on the link needs the latest code: an earlier version also flagged question 3.3, wrongly. That fix is
  in the repo and reaches the link on the next deploy.
- Running **Pond-Guard on the new Mandalay Hills case** was not tested. A live run replaces a case's findings,
  so its score may change. Use Aurora Venture for step 16.
- Whether the new request appears in Reviews > Case queue with a prediction was not checked.


## Suggested Script
The script
Seven scenes, each with what to do on screen and what to say. Step numbers refer to the demo guide.
0:00–0:20 · The idea
On screen: the DueDilly globe with Dilly.
Before a company trades with someone new, it has to know who it's really dealing with. Today that's slow, manual work. DueDilly gets your ducks in a row. The AI understands, the rules score, and a person decides.
0:20–0:45 · One form, screened on submit (steps 2–3)
On screen: as John Doe, press Submit KYC Request. Point at Pending DDQ, PEP Alert and clauses §2.1, §3.6, §4.1.
John wants to buy S$1.8 million of tin concentrate from a new supplier in Myanmar. He doesn't need to know the compliance policy. He fills in one form. The moment he submits, the supplier is screened against sanctions and PEP lists, country risk and our policy. Three clauses fire, so a due diligence questionnaire goes out on a secure one-time link.
0:45–1:05 · Dilly reads the supplier's document (steps 8–9)
On screen: in the private window, Upload a document, then the "74 answers suggested" message.
The supplier already has these answers in a document. They upload it, and Dilly reads it with Gemini on Vertex AI, or Document AI for a scanned PDF. Ten seconds later, 74 answers are suggested, each quoting the words it came from. The supplier confirms every one. Dilly never submits for them.
1:05–1:45 · Catch the contradiction, draft the note (steps 13–14)
On screen: as Grace Teo, Compliance > Review. Point at Answer verification (1 contradiction) and the score moving from 50 to 65. Press Draft with Dilly.
Now compliance. The supplier answered that no owner or director is a politically exposed person. But screening found the beneficial owner is a serving Deputy Director-General. Gemini flags the contradiction, quotes both sides, and the score moves from 50 to 65. Grace presses Draft with Dilly. Gemini writes the case note, citing findings and policy clauses, and every citation is checked. It can't set the score or choose the route. Grace edits it and signs. A person makes every decision.
1:45–2:25 · Five agents, one traceable score (steps 16–17)
On screen: Globe > Aurora Venture > Screen with Pond-Guard. Let the five agent rows fill in, then scroll to "Why 85?".
How does Dilly reach a score? This is Pond-Guard, built on Google's Agent Development Kit. A coordinator runs five specialist agents in parallel on Gemini: sanctions, PEP, adverse media, ownership and vessel behaviour. Only the adverse media agent searches the web, through Grounding with Google Search, and it can only cite pages Google returned. Why 85? Every point traces to a finding, a rule, a quote and a source, with the policy clause found by Agent Search.
2:25–2:52 · Dilly learns from the officers (steps 20, 22)
On screen: Reviews > Case queue, Halcyon Marine with Likely miss at 59%. Then Dilly learns, card 2 showing BigQuery ML (boosted trees).
But rules can miss things. Halcyon Marine scored 40 and was auto-cleared, yet Dilly flags it as a likely miss. Officers mark cases red or green, and every mark trains a boosted-trees model in BigQuery ML. It never changes a score. It asks for a second look.
2:52–3:00 · Close
On screen: back to the globe with Dilly.
DueDilly, built with Antigravity and Google AI Studio, running on Cloud Run. The AI understands, the rules score, a person decides.

