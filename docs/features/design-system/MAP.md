# RP merge preparation (2026-09-15)

Review checkout: `Pe.Tools-rp-review-7`, branch `review/rp-seven-commit`.
Main is not merged. The user has one final request before merge.
Historical milestone measurements and prototype reports remain in git history.

## Merge boundary

- Prove the RP substrate through Chat, Takeoffs' front half, and Family's structural integration.
- The head projects authoritative state. No fabricated facts, seed-specific head logic,
  compatibility adapters, or competing primitive owners.
- Keep Target, Work, Reading, Action, Page and View distinct. Dedicated route controllers own
  dependent transitions. Private widget mechanics and pure formatting remain local.
- Human buttons, hotkeys and Pea share semantic policy. Work revisions and exact document
  lifetimes constrain execution. ActionJournal owns external outcomes and recovery.
- Frozen seeds prove rendering only. Real-button journeys prove the relevant RP behavior;
  a native mutation additionally requires its durable receipt.
- Full Family engine acceptance, downstream Takeoffs sync/export, tutorial polish and completion
  of low-priority products are deferred. A competing primitive is not a product deferral.
- SDK lifecycle stays in Pe.Revit.Sdk. Preserve concurrent checkout and Revit sessions.

## Current shape

Work envelopes contain document and revision, not external-operation state. Work-local commands
stay in RouteWorkspace; semantic effects use ActionJournal. Receipt detail views observe their
original ID through the shared Reading lifecycle. Completed Chat cards read the document, target
and revision recorded by their own call; the live dock follows the current thread separately.

The Situation and remaining shell verbs use the same action controls. The Situation exposes
Work conflicts and action failures. Seeds refuse actions instead of manufacturing success.
Family and Settings share one Settings owner; the redundant file strip is deleted. Current absent Work initializes through the same open action. Schedule Grid has one owner with Page-selected target/work identity, declared Readings and Actions. Late actions cannot overwrite Page after a target or Work switch, including A-to-B-to-A.

## Evidence and accounting

The seven-commit baseline is `285afc3`; Fable's review fixes are `73f467a` and `288bdd9`.
Fable's earlier review reports are timestamped testimony under
`.artifacts/handoffs/rp-review-7/`; their open findings must be checked against current code.
After `cc14253`, root reran all 23 Chrome/Host Chat and frozen-seed scenarios: passed.
The 50-file formatting/lint/type check and all 93 repository guards also passed.
These scenarios use a deterministic model and no Revit; they do not certify native operations.

Independent real-button Family proof selected `pe-vav-test.json`, clicked Open, observed the
exact file in the sentence and no duplicate strip, and captured the Settings open command after
Work subscription. Settings also passed real picker/Open proof at `2cfc41c`: Work connected and the selected file readout appeared, with no duplicate strip. The visible no-Revit review server is in Herdr pane `w3:p9` at `http://127.0.0.1:5175`; the existing 5173 server was preserved. Native Family build and Schedule Grid push remain outside this close-out proof.

Close-out from `288bdd9`: production +359/-621 across 23 files (net -262); tests +191/-192
across eight files. Deleted the retired Work replay protocol, duplicate Settings owners, and
the second Schedule Grid owner. Added one focused stale-completion regression test;
no new production files or dependencies.

Measure each slice from its actual commit base. Separate production from tests/fixtures and docs;
count retired owners and mutation paths, not renamed symbols. Do not infer cyclomatic complexity
from line counts. The broader engine diff is not an RP-only LOC denominator.
