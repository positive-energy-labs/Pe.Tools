# Release-Ready Spike: SDK beta.17 + Pe.Tools 0.6.9

2026-07-08. One spike, two repos. Goal: every confirmed defect from the design review fixed; both
trees release-ready. No publish date — betas increment, owner releases when confident. Defect
inventory and statuses live in [SDK-LEDGER.md](SDK-LEDGER.md). Prior-spike history lives in git.

## Decisions locked (do not relitigate)

- **D1 Lane is explicit, never inferred product-wide.** `EnsureRunning` takes a lane; the loader pins
  `installed` on the `InstalledProduct` it hands payloads; `InstalledProduct.Lane`'s `*.dev.txt`
  shim-marker scan dies. Markers stay per-shim exec-time routing data only.
- **D2 `install verify` is destination-only.** Reads the installed manifest copy + receipt, checks
  disk; never resolves build sources. Plain `verify` must pass on a user machine with no checkout.
- **D3 Same-version re-apply is a no-op** (`already-current`); `--force` overrides. Never a
  locked-file failure.
- **D4 Mastra init failure = degrade + observable.** Host stays up, `/pe/*` 503s, the init error is
  persisted to state and surfaced on `/host/status`. Never fail-fast, never invisible.
- **D5 pea resolves to the install on user machines.** Owner: "For pea on users computers, this
  should resolve to the install!!!!!" Clarified 2026-07-08: the prior spike's "TUI deletable" was
  misrecorded — "that decision was that a *custom tui* was deletable" (the OpenTUI/beta-tui effort;
  "web supersedes; if we have to make something custom for better lay-user UX, then web is better").
  "Bare pea should always launch the MastraTUI." So installed `pea` = the real pea CLI (MastraTUI by
  default). peco stays dev-only; owner: "*peco is not a user installed product* so the path shim here
  is not much of a shim, I'd just like a condoned way to add things to my PATH *safely*."
- **D6 The SDK owns safe PATH registration.** One idempotent User-scope PATH entry for the shims dir
  (`pe-revit path ensure|remove|status`; REG_EXPAND_SZ-preserving, no clobber, WM_SETTINGCHANGE).
  Consumers never hand-edit PATH; Pe.Tools' link-dev PATH prepend is deleted.
- **D7 Dev linking is an explicit verb** (`pe-revit dev link|unlink|status`), not an `install apply`
  side effect. Release installs skip targetless dev-only shims (`skipped-dev-only`, never silent).
- **D8 Drizzle fix = `neverBundle` drizzle-orm + JS sidecar staging** (deterministic), not a
  version-bump gamble. TS packaging baseline: commit `996687f`.
- **D9 Services bind loopback only** — stated in the SDK service contract; spawned-service stdio is
  captured to `state/service/<name>.log` by both EnsureRunning implementations.
- **D10 Full `PeServiceHost` helper + host-lifecycle adoption deferred** (ledger S-DEF-1). Working
  host code doesn't churn this spike; the TS client gains contract docs + minimal serve-side helpers.
- **D11 Pe.App drops its legacy 8s EnsureRunning timeout** for the SDK default 15s (host boots Mastra).

## Delegation

- **Fable (orchestrator):** plan, cross-repo contracts, the lane API centerpiece, adversarial review
  of verify/apply, seams, commits, ledger, the final E2E-HANDOFF rewrite.
- **Opus subagents (bounded briefs):** InstallCommand verb work, doctor checks, drizzle +
  observability, pea revival. Every brief: goal, fence, constraints, grounding, report-back.
- **Codex (convergence executor; computer use):** the final installed-lane E2E against real Revit
  (E2E-HANDOFF.md is its brief), and any bundling compile-smash that resists two Opus rounds —
  always a stated objective + pattern, never an open design question.

## Grounding (every brief points here)

- SDK contract: `Pe.Revit.Sdk/SPEC.md`. Defects: `SDK-LEDGER.md`. Effect/Mastra patterns:
  `EFFECT-V4-PATTERNS.md`, `MASTRA-DELTA.md`, `SQUASH-DESIGN.md` (all this dir).
- Install grammar: read side `Pe.Revit.Loader/InstalledProduct.cs`, write side
  `Pe.Revit.Cli/InstallCommand.cs`, service primitive `InstalledService.cs` + `clients/ts/pe-service.ts`.
- Manifest ground truth (verified 2026-07-08): 5 payloads — Pe.App VersionedAddin, host VersionedApp
  (service block, port hint 5180), pe-revit Cli, pea + peco targetless dev-only PathShims.
- Mastra 503 root cause is FACT: drizzle-orm `TypedQueryBuilder` ReferenceError from SEA bundle
  module ordering; natives are fine. Repro: run the installed exe with
  `PE_TOOLS_HOST_BASE_URL=http://127.0.0.1:<altport>` + captured stdio. CAVEAT: a second instance
  clobbers `state/service/host.json` — restore it afterward.
- Existing tooling first: `pe-revit doctor|pack|install|live|dev-sign|guide`, `scripts/smoke.ps1`
  (SDK), `dotnet run --project build` (Pe.Tools). Never reinvent a verb.
- Testing: one vertical check per real seam (smoke check / Loader.Tests / the alt-port host repro).
  No unit sprawl.

## Phases

- **P0 Stabilize.** Commit stray SDK template bump; fix doc drift (SPEC version authority, NEXT
  facts, new-addin kinds, PeExplain text); rewrite PLAN + LEDGER fresh. **Exit:** both trees clean,
  docs match code, plan+ledger committed. ✅
- **P1 SDK core → beta.17.** Lane plumbing (D1) · dest-only verify (D2) · idempotent apply (D3) ·
  dev verbs + skip dev-only shims (D7) · `path ensure` (D6) · doctor companion-pin + vendored-client
  drift checks · service stdio capture + loopback contract (D9) · `Resolve` uniqueness ·
  loader inert-on-corrupt-shim (R5) · residual pe-version wording. **Exit:** smoke green incl. new
  checks (no-source verify, already-current, dev link, path ensure); beta.17 packed to the folder feed.
- **P2 Pe.Tools consume + product → 0.6.9.** Drizzle sidecar + Mastra observability (D4/D8) ·
  consume beta.17 (pins incl. Versioning beta.9→17, delete the `PE_LANE` guard, D11 timeout, adopt
  dev link / delete `PeaLinkDevCommand`'s PATH edit) · pea installed revival (D5) · web copy fix
  ("swap live" → staged-until-restart truth) · BUILD.md stale sections. **Exit:** `install apply`
  from checkout → plain `verify` green → alt-port repro shows `/pe/*` 200 and `/host/status` reports
  the agent runtime · `pea` from PATH resolves installed with no dev marker present.
- **P3 Release-ready + handoff.** Pack 0.6.9; `release --plan` green (no publish); rewrite
  E2E-HANDOFF.md as Codex's brief (restart Revit, web-update 0.6.8→0.6.9, no firewall prompt, `pea`
  from PATH, `/pe/*` live, plain verify green). **Exit:** handoff written; every ledger line fixed,
  deferred-with-reason, or explicitly handed to Codex.

## Rules

- An agent that finds an issue adds a ledger line — it does not fix out of scope.
- Phase exits require a ledger review; deferrals get a line with the reason.
- Commit at wave boundaries; messages are the changelog.
