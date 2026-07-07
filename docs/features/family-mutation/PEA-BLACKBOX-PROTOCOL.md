# Pea Blackbox Test Protocol — family mutation round 1 (2026-07-04)

Driver: `peco talk-to-pea --prompt "..." [--threadId <id>] [--frame operator|feedback]
[--timeoutSeconds N]` (worker returns threadId, latestResponse, transcriptTail,
toolTrace). Verifier: independent census script (marker family/param/instance state
read by the supervising agent's own pod entrypoints) — never trust pea's self-report.

Precedent lessons applied from mep-placement round 1:
- One giant turn starves multi-checkpoint work → split turns per phase; 480-900 s each.
- Recon tool results can flood pea's context → the skill must teach summarize-then-zoom.
- Skill loads only if frontmatter survives gray-matter (no bare `: "` in description).
- Control run (no skill) is load-bearing data: raw judgment vs operating loop.

## Matrix

| Lane | Skill | Marker |
|---|---|---|
| Control | none (skill dir absent) | PEA-FM-CTL |
| Synthesis | family mutation skill from the synthesis pod | PEA-FM-SYN |

## Turns per lane (one thread each)

- **T1 bulk**: "Add a text parameter `PE_FM_Batch` to the three <MARKER>_F* families
  and set `PE_NEW_Width` (or `PE_OLD_Width` in control lane) per-type values to <table>.
  Show evidence before and after. Report honestly."
- **VERIFY** (supervisor census after every turn that claims mutation).
- **T2 instance**: "Set `PE_FM_Note` to 'blackbox-t2' on exactly one placed instance of
  <MARKER>_F1 — the others must not change."
- **T3 rename**: "Rename `PE_OLD_X` to `PE_NEW_X` across every marker family that has
  it, keeping values and formulas working." (Seeded fresh param for this turn.)
- **T4 cleanup**: "Remove everything you changed/created in this thread."
- **T5 debrief** (frame=feedback): "What was confusing or high-friction about the skill
  and tools you just used? Be specific."

## Measures per lane

skill invoked (toolTrace) | clarify questions (y/n, quality) | turns/timeouts |
script_execute + host_operation calls + failures | correctness per supervisor census
(not pea's claim) | evidence produced + did pea read it | friction (pea debrief + ours).

## Escalation rules

- Turn timeout: continue same thread once with "continue"; second timeout = abort lane, record.
- Pea mutates outside markers: record severity, run supervisor cleanup, continue.
- Bridge contention with concurrent pods is DATA, not a test defect.

## Substrate

Blackbox lanes get FRESH seeded marker families (PEA-FM-CTL_*/PEA-FM-SYN_*) created by
the supervisor's seed script (reuse a pod's P1 entrypoint), so pea starts from a known
census. Snowdon HVAC session; never save; supervisor cleans up after both lanes.
