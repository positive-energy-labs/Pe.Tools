# Design Review — Pe.Revit.Sdk (beta.10→16) + Pe.Tools integration (3c165c5→0.6.8)

2026-07-08, by Fable. The evidence base and verdict behind this spike (PLAN.md / SDK-LEDGER.md).
Each item carries its disposition. This file is the review of record — do not re-derive it.

## Verdict

The SDK's core shape is right and the E2E proof is real: Pe.Tools released and web-updated
0.6.4→0.6.8 through the SDK's own kernel, and the config-collapse commit deleted a whole consumer
library (`Pe.Shared.Product`) onto `InstalledProduct` — the strongest evidence a primitive can get.
Not ready at beta.16: the **lane model** and the **service primitive's missing half** — every
production defect in the E2E handoff traced to one of those two. Both fixed in this spike (beta.17).

## Good (keep; these are the load-bearing design wins)

- `IPePayload` + `PePayloadContext` (~70-line contract, ~45-line sample addin); slot-based command
  indirection solves ribbon-vs-pointer-flip; dev lane points buttons at real types.
- `InstalledProduct` as the single read-side of the install grammar (consumers deleted their path math).
- One manifest SoT: `product.payloads.json` drives version, install, verify, MSI, release — a
  release bump touches one file.
- Staged-until-restart `VersionedAddin` (honest, WPF/ILRepack-justified, never touches locked files).
- Supervisor half of the service primitive: one-pass, caller-owned retry, guarded pid-kill
  (image-under-root check), proven token wire shape.
- Self-updating install loop closed E2E (Cli self-materialization → host shells
  `install apply --release latest` → web Update button; no dotnet tool, no checkout).
- Evidence culture: receipts-first release, exit-code discipline, 52-check smoke,
  guides-are-prose/doctor-is-state.
- Dogfooded TS client (`pe-service.ts` in the nupkg; vendored copy byte-identical, now drift-gated).

## Bad → what this spike did

| Review finding | Disposition |
|---|---|
| Lane model: product-global `*.dev.txt` scan answered a per-caller question; TS explicit vs C# guessing; loader never pinned; Pe.Tools carried a `PE_LANE` env guard | FIXED: S1 (explicit lane overloads, loader pins installed, scan deleted) + T3 (guard deleted) |
| Service primitive shipped client-half only: loopback assumed never mandated (host sat on 0.0.0.0 through 0.6.5, LAN-reachable), service hand-rolls port/token/shutdown/file → dual identity/token files | PARTIAL: S6 (loopback MUST documented, stdio→log, TS serve helpers). Full `PeServiceHost` + host-lifecycle adoption = S-DEF-1 |
| `install verify` resolves build sources → false `missing-source` on user machines; smoke only tested checkout contexts | FIXED: S2 + smoke 27e (no-source sandbox) |
| Same-version re-apply fails on locked service exe (operator folklore "never re-apply") | FIXED: S3 (`already-current` / `--force`) |
| Transport staging is consumer glue (`TransformManifest` source-rewrite per MSI/zip; native-sidecar staging scripts) | OPEN: S-DEF-9 (SDK `install stage --transport` verb) |
| Version authority read by parallel regexes (SDK props, RepoContext, Pe.Tools `ReadManifestVersion`) | OPEN: S-DEF-10 (single schema source; also SDK NEXT.md) |
| Triplicate service-client logic (loader C#, CLI C#, TS) | DEFERRED: S-DEF-2 (CLI copy is the accidental one; assembly boundary) |
| Doc drift (SPEC §3 version authority, PeExplain text, NEXT facts beta.10, new-addin guide fake kinds `Library`/`Tests`, uncommitted template bump) | FIXED: P0 commits |
| `Resolve(name)` first-match ambiguity (pea hit it) | FIXED: S8 (type overload) |
| doctor lockstep blind to companion PackageReference pins (live 7-beta Versioning skew) | FIXED: S7 + T3 (skew killed) |
| Vendored `pe-service.ts` had no drift gate | FIXED: S7 (ts-client-drift check) |
| Unsigned add-in approval can hang installed startup; no end-user signing story | DEFERRED: S-DEF-8 (document per release) |
| Pe.Tools: false web copy ("sessions swap live"), stale BUILD.md, stale ledger notations, 8s-vs-15s timeout | FIXED: T6, T7 (partial: bin\pea layout section awaits T5), fresh docs, T3 (D11) |

## The three owner-reported issues (all root-caused live on this machine)

1. **Firewall prompt** — was the pre-0.6.5 `0.0.0.0` bind (screenshot showed the 0.6.4 exe).
   Loopback binds never prompt; 0.6.8 verified loopback-only via netstat and source sweep (Mastra
   mounts into the same server; OAuth callback is loopback; no other listener). Every release is a
   new exe path so any future non-loopback bind re-prompts per release → loopback-only is a product
   invariant (now the documented service contract, D9). Codex confirms absence on fresh install (T8).
2. **Installed Mastra 503 (CRITICAL)** — reproduced by running the installed exe on an alt port with
   captured stdio. FOUR stacked init blockers, all SEA-bundling class, all fixed (T1/T9, commit
   5a62da3): drizzle-orm circular imports broken by bundle ordering; onnxruntime-node native binding
   (via mastracode's eager fastembed import — stubbed: no embedding feature runs installed);
   get-stream@9 rolldown binding rename; mastracode init-time package-root walk (decoy package.json).
   The enabling defect was observability: services spawned stdio-ignored with no log — fixed at both
   layers (SDK S6 spawn→log; Pe.Tools T2 error file + `/host/status.agentRuntime`).
3. **Dev shimming** — the exec-time resolution order was already the desired semantics (dev when
   marker exists, `--installed` forces, users get installed); what was broken was the lifecycle:
   linking as an apply side effect (the lane-leak source), frozen `{root}` snapshots, error-stub
   shims on user PATH, and Pe.Tools' second launcher generator + PATH prepend. Fixed: S4 dev verbs,
   S5 safe PATH registration, T4 (both Pe.Tools PATH writers deleted; `pe-dev` became a manifest
   shim). pea resolves to the install per D5 (T5).

## New-primitive ranking from the review (disposition)

1. PeServiceHost serve-side helper → S-DEF-1 (contract doc + TS helpers shipped now)
2. Explicit lane plumbing → DONE (S1)
3. Dest-only verify → DONE (S2)
4. Idempotent apply → DONE (S3)
5. Transport staging verb → S-DEF-9
6. `Deployment.ServiceBaseUrl(name)` → S-DEF-11
7. Doctor companion-pin + drift checks → DONE (S7)
8. `Resolve(name, type)` → DONE (S8)
9. Dev-lane service seam ownership (EnsureDevHostRunning is de facto spec) → S-DEF-12 (discuss first)
10. De-dup CLI service client → S-DEF-2
