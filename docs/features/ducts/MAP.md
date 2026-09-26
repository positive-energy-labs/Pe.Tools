# Pea duct modeling goal

## Acceptance and user intent

Given duct sizes and terminal CFM. Three real Chadds cases, each repeated three times from resettable starting states: long terminal run <=10 minutes, branched group <=20, congested equipment connection <=30. Clock includes initial Pea inspection, creation, independent committed read-back and interruptions. Then unseen runs. Demonstrate through web Pea via chrome-agent. Preserve originals and user sessions.

2026-09-26 user amendment: aim to avoid clashes, but a connected, correctly sized run within cap counts with remaining clashes clearly reported for engineer review. Record severity separately. Do not call unknown coverage clear. Given CFM, no unintended changes and no human geometric rescue remain hard gates. Loaded architectural IFC is the known coordination context; unloaded links, evolving ACC coordination, unspecified service access and future insulation remain unverified.

Prefer smallest primitives covering 80-90 percent of work. Sol 6 and Opus 5.5 are primary operator comparisons; cheaper-model diagnostic is secondary. Fable supplies pragmatic skeptic review. No model-specific prompt tuning.

## Evidence and current result

All three initial diagnostics failed; acceptance repetitions have not started. The clash amendment does not retroactively pass them.

- Branch thread f9a1563c-9fe4-483a-8b9f-76b40d63aa7e: four terminals connected, sizes/600 CFM preserved; full clock about20m27 exceeded20. 17/41 new duct/fitting native intersection hits. Saved Chadds-branch-trial0-result.rvt; `.artifacts/duct-eval/branch-trial0-verdict.json`.
- Long thread63dcfdc7-fbf6-47e7-8dba-9354aaf96001: about15m before read-back exceeded10; terminal50CFM became0 after commit. Two of seven new parts intersect loaded IFC. `.artifacts/duct-eval/chadds-long-flow-restore-probe1.json` proves associated Price LBP15A input can restore50 in a second transaction; generic family handling still owed.
- Hard thread7a14616e-8022-445e-aa1c-d9e3c3446341: no route committed, two manual dialog recoveries. Independent capturec82a76fcab63420eb01878358a0e0426 shows original endpoints open,75CFM each preserved, no IDs/coarse changes. Exact consumed Apply retained under `.artifacts/duct-eval/hard-modal-red-input`.

PROVEN[session/dev, controlled duct-goal-eval, HEAD248f78d8 plus owned changes, 2026-09-26]: ducts.ports native31a181a89e634fa38c56421616422e12 reads five elements in98ms and excludes electrical port; web Pea discover/read threadeff54cef-c460-4b60-9ed0-291cb600b16b. No multi-peer native witness yet.

PROVEN[same session, same bytes]: conservative WriteTransaction failure policy turns deliberate commit Error into RolledBack without modal, and exact failing Apply8ea720b05b584175b273724faf4539c6 rolls back without modal. Capturedee701ee4d014d78bec40a7b13f04bb9 preserves IDs/coarse fingerprint and75CFM. Positive write11c618f1426e495394e38052789ef65c, independent read e1cf22dbec3c4794af5cdce8050626b4, restore f16d9906c3a54168a2885cbb458e6318, verify fe0715cb682f4190b96a8786e3c5da33 all succeeded.

Spatial corridor v2 native da88a59f501e4be4b10df25419e53bb2 finds three known long-run IFC obstacles but reports UNKNOWN. Geometry probe9b36453fcbde4e6fabe282d5130f22e6 proves objects1301790/1329463 mesh-only at every detail level;1344072 has solid but Boolean fails. Opus owns bounded useful witness fallback; zero-clash gate is superseded, honest reporting remains required. Local-view v5 native cleanup succeeded; v6 highlighted views native2934d66d4d98456db32189cbbfe77acb passed after correcting ambiguous Transform namespace; added/removed IDs empty and active view restored.

## Active work and custody

- Root owns native/browser contact and integration Pe.Tools-duct-goal, branch goal/pea-ducts. Revit controlled duct-goal-eval PID38760, start2026-09-26T20:01:44.7887916Z, dev generation20260926200119823, stamp626185543854. Product session-cb4c655d28515e14. Commit-error copy openIdcf36537d924149de9ee6d67d05864b5c; long-result copy openId8af1d4adc38c4c7d93eb660a5f041c1a. Re-census before dispatch.
- Owned non-watching host refreshed to PID68052 port50746; web5174. Browser chrome-agent pe.tools-duct-goal-01 headless and pe.tools-duct-goal-02 visible observer; latter has multiple tabs, requires target ID. Preserve observer tabs for user.
- SDK beta167 committed521915b7 local release in Pe.Revit.Sdk-session-dialogs. PackagedCLI inspection proven on current session; automatic contact-loss diagnostic native proof owed. No MSI/external release. Integration regular manifest remains165; isolated `.artifacts/sdk-dialogs-proof` manifest167.
- Sol observation fix50b43adb in Pe.Tools-om-bounded, not grafted: root found unconditional prior-observation clipping and requested correction before integration. Dry replay9 bounded requests, real-provider recovery owed. Hard postmortem has not answered because prior OM failed (402755 estimated tokens).
- Sol model picker agent owns separate worktree; native catalog lacks requested new models. Exact provider acceptance pending. Anthropic OAuth refreshed successfully through existing Mastra AuthStorage on2026-09-26; no secrets in artifacts.
- Opus CLI sessionea1aa99c-4ca8-4b5c-bd09-88d01e24d88d owns corridor v3 source prototype. Fable session56524930-eb2e-4a4d-9536-1ee3401d243a stopped after report `.artifacts/handoffs/fable-duct-api-design.md` in main. Its zero-clash language is superseded.

## Next proof

1. Finish highlighted view proof, bounded collision witness, OM host recovery and model picker actual calls.
2. Native-test minimal connector/waypoint builder from `.artifacts/duct-construction-eval`; no production API promotion until Pea comparison. Post-commit flow preservation and full document version/change census required; marker-only undo rejected.
3. Run primary-model examples with independent verifier and reported residual clashes, then3x repetitions and unseen cases. Strengthen reset/verifier beyond coarse fingerprints.
4. Focused/full repo checks, stage only owned changes, regenerate catalog hash after staging new files, commit integration. Remove spent owned resources when no longer needed.

Engineer review: temporary view creation/deletion commits affect undo/modified state; direct-peer exclusions hide some intersections; family-associated CFM repair needs broader validation; modeled insulation only; unloaded links/access/future insulation not verified. Rooms and custom GRDs need designer demand kept distinct from Revit calculated flow. No custom GRD flow-restoration proof yet.

## Checkpoint 2026-09-26 20:46 UTC

Integration HEAD8f516164 includes OM fix e0dba6c0+599c848a and new-model picker. Anthropic OAuth refresh succeeded; actual web smoke thread0402b71b-0a4b-442b-b9f5-5b1dfbb110ec answered with Opus5.5 then Sol6. Opus read real duct ports in thread6af7de37-c64f-4eb6-a838-ae09402460c0, target new long-builder-proof copy, productopenId3924b479c57a4ec58a523b06e073249d. Visible observer tab E411AED4D7BE97E9D6B0B55E755F2BF9 mirrors it.

OM postmortem recovery on original hard thread now PROVEN[web+provider, host68052]: cycleea5d1501-0a98-428f-b816-136291af76d0 completed45929ms, estimated402878 tokens observed,3813 observation tokens, recordd07a7056-da06-455c-b28a-779e95d178e3; Pea answered postmortem. `.artifacts/runs/duct-goal/om-recovery-final.json`. Requested improvements: rollback-only fitting probe, local precise collision feedback, transaction-safe connector/waypoint builder. Observation content still includes stale session facts despite profile instruction; do not treat them as current truth.

Builder v2 native dry87ce6f70adff4e54899ec7f8d6d434d7 passed on independent Chadds-long-builder-proof.rvt. It created7HVAC parts, detected50->0CFM atinnercommit, restored50 insecondtransaction, verifiedsizes/closedports/otherports, then rolledback fullIDs+versionsclean. Receipt `.artifacts/duct-construction-eval-v2/receipts/long-v2-dry1-20260926T204011Z.json`.12 existingmodifiedIDs whilecommitted include equipment,terminal,siblingducts/insulation,systems,and4metadata/viewIDs; classification stillowed. Opus builder followup packages only new owned workspace Pod `Pods/duct-run-experiment`, exactassociatedflowrestore and exactconsumedinputreceipt. RootmusttestthroughPea; notacceptanceyet.

Corridor v3 nativebe6ff60bf80c48d3b6272b4198b39812:3surfaceintersection rows against1301790and1344072,2UNKNOWNagainst1329463. Reviewcaught endpointtouch cancount, so artifactcorrectedlabels SURFACE-INTERSECTION (not hardclash) andboundedallvisitedtrianglepairs; deterministic12checks, correctednativeowed. Neverclaimstrictpenetrationvolumefromtrianglewitness. Opusspatialdone/stopped, report `.artifacts/handoffs/duct-corridor-v3.md`.

Full pnpm verify afterformatfix passed check/knip and package tests, failed8repo-guardchecks in5files (logs integration-verify2). Solport_seam_critic owns bounded regressioncensus/fix inisolatedtree; no fullverifyclaim. Nativeproductsource andcapturetargetfix stagedonly, notcommitted; generatedcataloghash refreshedafternewfilesstaged. No acceptancepassadded.

## Web builder checkpoint 2026-09-26 20:49 UTC

PROVEN[web Pea Opus5.5 + session/dev controlled duct-goal-eval, 2026-09-26]: thread6af7de37-c64f-4eb6-a838-ae09402460c0 turn2 discovered `pod:duct-run-experiment.run`, read README/request, ran NoTransaction dry-run, read fullreceipt and independently rereadports. Request unchanged sha7B1605C861048A4C7F5FE6A5B4A6E98D2A0240CB9FA0371E4316D022371D2DBE. Nativeexecutionf03bd1bedfdc4766b4a6f04845066736: created7HVACparts, restored50CFM bysetting ONLYassociatedparameter1635140, fullID/versionrollbackclean. Pea portsreadmatchesbefore. Exactinputs/fullreceipt in userworkspace `Pods/duct-run-experiment/output/20260926-204805-f03bd1bedfdc4766b4a6f04845066736/`. This is a guided unchanged-waypoint prototype test, NOTacceptance, no geometrycommitted. Pea didnotindependentlyreadCFMafterrollback (portsoperationdoesnotexposeflow).

Peafeedback `.artifacts/runs/duct-goal/opus-builder-ui-final.json`: PodcatalogdefaultReadOnly/WriteTransactionguidance conflictswithNoTransaction requirement; pe_do echoesbase64sourcebundle+assemblydiagnostics3times; workspacegrep alternationreturned0; output/hiddenfromlisting; resultdocumentnull; nullablewarnings. Prioritizetransactioncontractandboundedmodel-facingreceipt, preservefullconsumedsource/receiptartifacts. Fable8minreviewresumed56524930 usingmain `.artifacts/handoffs/fable-duct-api-next-brief.txt`; outputfable-duct-api-next.md. Opusbuilderae6c6a0d stoppedafterpackageproof; canresumeforimplementationafterreview. No publicductchainAPIpromoted.

Guardfixgrafted8ee5ba69 addsducts.ports rawreceiptexplicitchoice. Remainingfullverify8failuresin5files inheritedHEAD (includesrooms.trace rawdecision); exactcensus `.artifacts/handoffs/duct-integration-guards.md`. Do notbumpguardceilings. Solduct_routing_sol nowowns independentverifierartifact15minmission in `.artifacts/duct-verifier-v2`; rootownsallnativecontact. Needfullparameter/domainclassificationof12modifiedexistingIDsbeforecommittedacceptance. Firstkernelpreservesrollbackbutcannotcertifyallunintendedwritesonitsown.
