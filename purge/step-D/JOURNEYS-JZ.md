# Kernel journeys JZ

## Standing merge rule

Every production fix line must commit its surface witness in an existing `kernel-journeys-*.test.ts` file. Prove that same journey red at the fix line's base and green at its head. Record the product rule here. Disposable evidence supports the committed witness; it cannot replace it. A production change without a committed witness does not merge.

This rule follows the user's 2026-11-07 ruling and applies to every fix line. It does not require a model turn, a native mutation, or unrelated full suites.

## B05: a selected Place outlives its folded drawing

Witness: [JZ B05 in kernel-journeys-focus.test.tsx](../../ts/apps/web/src/route/kernel-journeys-focus.test.tsx#L83).

- Folding tools does not remove the selected Place from Pea's context.
- First-thread promotion binds that retained Place even when its drawing is already folded.
- The Host reads current Work through the mounted key. A host-bound Family draft and its attached specification must not become empty document-bound Work.
- The folded Place refreshes its lease beyond expiry. Switching conversations retires the old association and binds the same Place to the selected conversation.
- The shipped root registers typed builtins. The thread row names its explicitly remembered Place independently of unfinished Work elsewhere in the document.

The journey renders the production `RouteDock`, tools Activity and typed Family shell. It uses the production file-backed Work store, Work feed, lease bridge, Host HTTP view handler and thread-Work projection. Conversation selection and unavailable native Value are boundary fixtures. A small parsed-spec fixture pins attachment retention; it makes no engineering claim about the PDF. The pane drawing is an inspection output. The journey does not certify browser layout or native Revit behavior.

Run from `ts/apps/web`:

```powershell
vp test run src/route/kernel-journeys-focus.test.tsx -t 'JZ B05' --maxWorkers=1
```

| State | Source | Result |
| --- | --- | --- |
| Red | `cb4f12f95addc45b427722e91e41146b9d639baf`, with only the committed witness copied in | B05 fails at line 153: after folding and promotion, expected HTTP 200 but received 409. |
| Green | `12df48ff2787df4a596e2f75615b1d062f626ffa` | B05 passes, including authoritative Work/spec, expiry, rebinding, discovery and Place label. |
| Neighbor journeys | Same green tree | All 3 tests in the existing focus-journey file pass. Web `vp exec tsc --noEmit` passes. |

The witness's canonical Git-blob SHA-256 is `043c0813234a06c5a5d1a4cc1fcf113694f6bacd0ed38b07650a356d65b5bde6`. The base run used that source with CRLF line endings; Git restored the committed LF version on returning to the branch. The proof manifest verifies that newline normalization is the only difference.

Evidence: `.artifacts/pea-context/journey-base-red.log`, `journey-base-red.json`, `journey-committed-green.log`, `journey-file-green.log`, and `journey-tsc.log`. No production code was changed for this witness revision. No model turn, Revit, browser, or persistent server was started.

FALSIFIED[deterministic, cb4f12f9 JZ B05 loses the selected Family Place when tools fold before thread promotion: HTTP 409 instead of 200]

PROVEN[deterministic, committed kernel-journeys-focus.test.tsx JZ B05 and journey-committed-green.log, 12df48ff2787df4a596e2f75615b1d062f626ffa, 2026-11-07]

The separate real-browser and Host HTTP witness remains documented in [the Family context report](../../takeover/FIX-PEA-FAMILY-CONTEXT-REPORT.md). The committed journey is the merge witness; the earlier disposable instrument is supplemental evidence.
