DUEDILLY — HACKATHON READINESS CHECKLIST
Benchmarked against h2oai/h2oai-flood-intelligence-agent

Legend: [MUST] blocks the win case | [SHOULD] strengthens it | [STRETCH] if time remains

———————————————

1. MAKE ONE AGENT GENUINELY REASON (~1 day)

Flood intelligence won partly because its agents call real models for real judgment calls, not scripted scoring. Pick ONE DueDilly agent and do the same — don't spread this thin across all five.

[MUST] Replace the rule-based contradiction check in truthCheck.js with an actual LLM call. Feed it the statement text + retrieved registry facts, ask it to label each claim Consistent / Unverified / Contradicted with a one-line reason.

[MUST] Keep a local fallback path for when the API key is missing or the call times out — reuse the same pattern places.js already uses (curated data → live API → graceful empty state).

[MUST] Log and surface the prompt + raw model output in the case drawer. Judges reward visible reasoning — an "Explain this finding" expandable beats a black-box score.

[SHOULD] Forecast → swap the "Beta" placeholder for a simple, stated model (e.g. exponential-decay over historical sanctions-event frequency). State the method name out loud in the demo.

[SHOULD] Compute and display one backtest number, e.g. "flagged 8 of 10 true escalations on held-out cases."

Don't wire all five agents (Sentry, Ripples, Web, Tide, Forecast) to real LLM calls under time pressure. One agent done convincingly beats five done shallowly.

———————————————

2. WIRE ONE AGENT TO A REAL EXTERNAL FEED (~0.5 day)

Flood intelligence polls USGS and NOAA live. Right now every DueDilly agent reads seed data only — judges will ask "is this calling a real API, or is it fixtures?"

[MUST] Pick one real, free, no-auth-friction source:
• OpenSanctions API for Sentry (free tier, no key needed for light use) — matches the "41 sanctions lists" copy already in your PRD
• Or AISHub / a free AIS feed for Tide — dark-period detection against a live feed is a strong live-demo beat

[MUST] Cache responses to disk/SQLite with a TTL, same pattern as sources.js health states (ok / stale / new) — so a flaky upstream API during the demo degrades to "stale, last good data" instead of a blank panel.

———————————————

3. TWO-TRACK ARCHITECTURE (~0.5 day)

You already have Cloud Run + Firebase Hosting config and a SQLite/Firestore abstraction in src/db/ — the gap isn't new infrastructure, it's keeping local and deployed explicitly separate, so a deploy-side failure never touches the demo machine.

LOCAL TRACK — UAT & live demo
Demo laptop → Node + Express (src/server.js) on localhost:8080 → SQLite file (data/safe_globe.db)
Optional: cached live feed, TTL (polled, not required)

Single process, SQLite file, everything on one machine. No internet required for the core demo.
• npm start, zero cloud dependency
• External feeds cached with TTL — stale data beats no data
• Seed-reset script so a bad demo run resets in seconds
• No load balancer, no autoscaling — nothing extra to fail
• USE FOR: the actual pitch. A dead wifi connection or a cold Cloud Run instance must never be visible on stage.

DEPLOY TRACK — judge follow-up only
Firebase Hosting → /api/** and /v1/** rewrite → Cloud Run (managed load balancer) → Instance A + Instance B → Firestore (shared state)

Firebase Hosting rewrites API routes to Cloud Run; Cloud Run's managed load balancer fans out across autoscaled, stateless instances; Firestore replaces SQLite as shared state (something a single SQLite file can't do across instances).
• DATABASE_TYPE=firestore flips the existing src/db/ abstraction
• min-instances: 0 already set — accept the cold-start cost, it's not demo-critical
• Cloud Build pipeline already wired (cloudbuild.yaml) — push-to-deploy
• USE FOR: the link in your submission form, so judges can click around after the room empties. Never the thing you present from.

———————————————

4. HARDEN WHAT'S ALREADY BUILT (~0.5 day)

[MUST] A one-command reset script: kill the dev server, delete and reseed data/safe_globe.db, restart. If a live click corrupts demo state mid-pitch, recovery is 10 seconds, not a restart from scratch.

[MUST] Feature-flag any live external API call behind a cached/offline fallback, defaulted ON for the local build. Conference wifi is the single most common hackathon demo failure.

[MUST] Record a 60-second screen capture of the full golden path as literal backup.

[SHOULD] Deploy via cloudbuild.yaml once before submission, confirm /api/health on the live URL.

[SHOULD] Set Cloud Run min-instances: 1 only for the 48h judging window, then back to 0.

[SHOULD] Freeze the deploy branch after the pre-submission check — no more pushes.

———————————————

5. THE PITCH ITSELF

Open → Globe loads, pins render, watchlist populated
Say: "Every counterparty here is live-screened, not a static list."

Real reasoning → Open a claimed org, trigger Truth Check, expand the reasoning panel
Say: read the model's actual output out loud — this answers "is this just rules?"

Real data → Sentry/Tide panel pulling the live feed from step 2
Say: "That score just came from [OpenSanctions / AISHub], queried seconds ago."

Judgment, not noise → Confidence × Risk quadrant routing a case to Escalate vs. Auto-clear
Say: this is your actual differentiator — the flood project has no human-in-the-loop routing model.

Close → Deploy URL on a slide, not opened live
Say: "It's also live at this link if you want to dig in afterward."

———————————————

WHAT TO CUT IF TIME RUNS SHORT

Cut in this order:
1. Forecast backtest number — state the method, skip the number
2. Second live data source — one real feed is enough
3. Deploy-track Firestore migration — SQLite-on-Cloud-Run with a single instance still proves the story

NEVER CUT: the one real LLM call in Truth Check, and the demo-day reset script. Those are what the whole pitch leans on.
