# Implementation plan: the review model (machine learning on officers' reviews)

Status: **approved by the user on 12 Oct 2026 ("Do this now") and built. See `walkthrough.md`.**
This replaces the earlier Phase 4 plan (forecast, anomalies, name matching), kept unbuilt as
`implementation_plan.phase4-bigquery-ai.md`. Earlier plans: `.phase1.md`, `.phase2.md`, `.accounts.md`, `.phase3.md`.

## What the user asked for

- Focus on the AI integration (40% of the scoring), in the Reviews tab. Keep it simple.
- A supervised model that learns from how compliance officers classify cases, aimed at false negatives: a real
  risk the rules scored low. It gets better as officers review more.
- The officer can classify a case red or green.
- Synthetic labelled data, for AI governance and for the demo.
- BigQuery ML boosted trees.
- Hints in Reviews that explain prediction, inference, suggestion and hyperparameter tuning, tied into the
  risk-by-confidence chart.

## What this changes in the AI build spec (`GEMINI.md`)

- **Rule 5 (no model training, `CREATE MODEL` on hold) is lifted for this one model**, by the user's instruction.
- Section 10 still holds: the AI never sets the risk number or the route. The model makes a **suggestion** only.
  A "likely miss" asks for a person; a "likely false alarm" clears nothing.

## Design

| Step | What happens | Where |
| --- | --- | --- |
| Label | An officer marks a case red (real risk) or green (not a risk). The case's features are saved with the label. | `src/learning/learningService.js`, table `review_labels` |
| Features | 18 numbers per case, from its score breakdown: points by group, confidence, findings left out, country CPI, share of checks that ran, and so on. | `src/learning/features.js` |
| Synthetic data | 800 invented cases labelled by an invented officer who mostly agrees with the rules and marks some low-scoring patterns as real risk. Marked synthetic everywhere. | `src/learning/syntheticReviews.js` |
| Train and tune | BigQuery ML `BOOSTED_TREE_CLASSIFIER` with `NUM_TRIALS` and `HPARAM_RANGE` on tree depth and learning rate. Offline: boosted trees trained inside the app, with the same kind of trials. An officer's own review counts 10 times a synthetic one. 15% of reviews are held back and never trained on. | `src/learning/bqModel.js`, `localModel.js` |
| Predict (inference) | For every scored case: the probability an officer would mark it real risk, with the features behind it (`ML.EXPLAIN_PREDICT`). | same |
| Suggest | Rules below 50 and prediction at or above the threshold: "likely miss". Rules at 50 or more and prediction at 20% or less: "likely false alarm". | `learningService.js` |

## Verify

Offline tests for every step, a stand-in for BigQuery to test the BigQuery ML path, and a test that labelling,
training and predicting change no score, confidence or route. Live BigQuery ML after the section 9.1 go-ahead.
