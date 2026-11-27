# First Minute submission

## Project title

First Minute — Self-hosted Runbook Experiment Lab

## Track

Track 3 — Build on Open Source Flagsmith

## GitHub repository

https://github.com/arpitkjaiswal/flagsmith1

## Demo video

Upload the 84-second captioned video at `media/walkthrough.mp4` to YouTube or Loom as public or unlisted, then paste its URL into the form. It shows the Docker stack, local dashboard, a live drill, SDK receipts, verification and rollout.

## Live demo or deployment

https://arpitkjaiswal.github.io/flagsmith1/

This hosts the playable practice demo. The full self-hosted Flagsmith lab is launched with the README's Docker command and shown in the video.

## What did you build, and what problem does it solve?

First Minute is a self-hosted experiment lab for on-call training. Teams often write runbooks without measuring whether those instructions help a responder find the cause of an incident.

Our sample exercise gives the player 60 seconds to diagnose a checkout outage from release history, service metrics and a request trace. Flagsmith assigns a plain desk or a three-step runbook and measures a correct first diagnosis. The debrief explains the evidence and lets the player model a recovery.

Another developer can launch the complete lab with Docker Compose. It provisions Flagsmith, PostgreSQL, an event worker, a local dashboard, the experiment and the application. Toolkit commands verify event counts against the warehouse, rehearse an evidence-based rollout and export the participant results. The sample includes protection against duplicate conversions, concurrent tabs and interrupted event delivery.

## Which parts of Flagsmith did you use?

We self-host the open-source Flagsmith platform with Docker and PostgreSQL. We use the management API to configure a multivariate feature flag, keyed variations, a 50/50 experiment, an occurrence metric and a PostgreSQL warehouse connection. The JavaScript SDK assigns identities, records flag exposures, tracks `drill_resolved` events and flushes them to Flagsmith. The task processor and Bayesian results engine produce the experiment results shown in the native dashboard. The same flag controls the final rollout, which the toolkit checks with fresh SDK identities.

## Track 3 — How did you build on self-hosted Flagsmith?

First Minute packages a complete, reusable experiment lab around self-hosted Flagsmith. Docker Compose starts the database, migrations, local account setup, API/dashboard, event worker and sample app. The dashboard reads its own feature configuration locally, and the app receives a client-side key without exposing management credentials.

Developers can run the entire workflow from containers. `tools verify` sends 240 scripted identities through the real SDK and checks the warehouse counts while retaining the equal split. `tools rehearse` runs a separate programmed-advantage experiment, applies a decision rule and checks the selected flag value for 16 new identities. `tools report` exports the participant experiment's current results.

The incident drill gives the starter a concrete use for an on-call team. Developers can replace its evidence and runbook or reuse the management API setup, event handling and reporting code in another application. Our CI builds the fork's OSS image, starts the same lab and tests the integration.

## Feedback

Flagsmith made it practical to use one feature flag for assignment, experimentation and rollout. The local PostgreSQL warehouse and JavaScript SDK let us verify the event path without a separate analytics service. The native dashboard made the synthetic results inspectable.

Fresh-instance setup took several steps across the account, project, warehouse and experiment. That led us to build the automated lab. Clearer setup diagnostics would help when an API returns a generic permission error because a project limit has been reached. More explicit information about the results refresh interval would also help during a short demo.

## Results images

The two existing captures are under 5 MB each and document the scripted experiments.

- `media/flagsmith-results.png` shows the programmed-advantage run.
- `media/equal-chance-results.png` shows the equal-chance run.

The form asks for these in the optional Track 1 section. The Track 3 video should show the Docker setup, sample app, native dashboard and reusable toolkit.
