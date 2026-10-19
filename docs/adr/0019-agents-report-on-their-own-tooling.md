# 0019: Agents report on their own tooling, and the product ships its source

Date: 2026-10-14. Status: Accepted 2026-10-14. Decided by: kaitpw (muse on agent feedback harvesting, 2026-10-14). Narrows [ADR 0018](0018-receipt-spine-and-telemetry-export.md) item 4 for one event, `agent_feedback`.

## Context

Pea works on coworkers' machines with tools we wrote. Its friction (a tool that lied, a description that misled, a workaround it invented) stays in transcripts nobody reads. ADR 0018 lets content leave only on a verified human submit, and one report is weak evidence: the owner wants findings formed across many sessions. An agent can read and debug the code it ran on, but the release payload shipped no source and `pea.exe` carried no commit.

## Decision

1. `pe_feedback` is a top-level Pea tool beside `pe_find`, `pe_read` and `pe_do`. It takes `surface`, `expected`, `observed`, optional `workaround` and `refs`. It has no kind field: the description names the cases worth reporting, and the miner owns the taxonomy. The host stamps commit, version, install, caller, thread, turn, harness and model, keeps the report locally first, then exports `agent_feedback`.
2. Agent feedback content leaves the machine automatically while users are coworkers. Reopen this item before outside users.
3. Aggregation is a miner, not event clustering. A shipped scheduled task reads this machine's settled threads and receipts through `route:threads.history` and files at most three findings through `pe_feedback`. Aggregation across machines is a second tier over PostHog, owned by maintainers.
4. The host scheduler is clock-only, interval or fixed time, after T3 Code's shape: a fresh thread per run, no overlap, a ten-minute grace for a missed fixed time. A volume gate runs inside the run: below its count of Revit-touching receipts (native kind, verdict not missing, running or rejected) the run is recorded skipped and no thread starts. A shipped task's definition comes from the build; only its enabled flag and run state persist.
5. The installer ships every tracked file at the build commit, extracted once beside the host (`app/bin/host/src`, `src-manifest.json`). Release staging refuses a dirty checkout. `pe_find`'s map names `source: {root, sha, dirty}`. A full sha plus a repo-relative path and line maps onto a checkout.

## Consequences

- PostHog holds free text from Pea's reports. The description forbids model content and personal information; nothing enforces it.
- Each install grows by about 22 MB. Pea reads implementation instead of guessing from XML docs, and the teaching role has its material.
- A dev host run from source has no build stamp, so its local reports carry a null commit; `pe_find`'s source sha covers that lane.
- Scheduled turns spend the coworker's subscription. The gate and the 03:00 slot are the only brakes, and a machine asleep at 03:00 skips that day.
- Agents and users cannot create tasks yet: there are no Pea scheduling tools, webhooks, thread-event triggers or scheduler UI.
