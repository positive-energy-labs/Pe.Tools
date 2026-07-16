import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";
import type { SessionLane } from "#/host/target";
import { ageLabel, LaneBadge, laneVar } from "#/host/target-ui";
import { useTarget } from "#/host/use-target";

export const Route = createFileRoute("/docs/runtime")({ component: DocsRuntime });

/* ------------------------------------------------------------------------------------------------
 * docs/runtime — the layer below docs/target: how a lane physically comes to exist. The loader,
 * the selector, installed payloads, sandboxes, hot reload — where the files live, who writes
 * them, when they persist, when they're reused, when they die.
 *
 * Every assertion here is grounded in Pe.Revit.Sdk source; citations name file:line as of
 * beta.96 (commit 02ad1bb). The scripted scenario reenacts a real incident: a source-built
 * sandbox refused at the 2025 Addins door by a receipt-owned selector from installed 0.6.14.
 * ---------------------------------------------------------------------------------------------- */

// ── the disk model ──────────────────────────────────────────────────────────────────────────────
// Four zones, one file registry, presence derived from step indices. The atlas below renders the
// full state at each step; the inspector explains any file's lifecycle with its code citation.

type ZoneKey = "checkout" | "addins" | "product" | "sdk";

const ZONES: { key: ZoneKey; title: string; root: string; blurb: string }[] = [
  {
    key: "checkout",
    title: "your checkout",
    root: "C:\\…\\Pe.Tools (source tree)",
    blurb:
      "Exists only on dev machines. What it builds — including the loader's bytes, and therefore its hash — moves with every commit.",
  },
  {
    key: "addins",
    title: "revit's door",
    root: "%APPDATA%\\Autodesk\\Revit\\Addins\\<year>",
    blurb:
      "The only place Revit looks. Shared by every lane — which is why writes here are guarded by ownership checks, not just file locks.",
  },
  {
    key: "product",
    title: "installed product",
    root: "%LOCALAPPDATA%\\Positive Energy\\Pe.Tools",
    blurb:
      "What users have. One canonical version; current.txt is the commit point and is always written last (ADR-0001).",
  },
  {
    key: "sdk",
    title: "sdk state",
    root: "%LOCALAPPDATA%\\Pe.Revit.Sdk",
    blurb:
      "Sandbox registry, immutable generations, bridge journals, locks. Dev-machine bookkeeping — never read by Revit itself, only by the CLI and the bridge.",
  },
];

interface FileSpec {
  id: string;
  zone: ZoneKey;
  indent: number;
  label: (step: number) => string;
  addAt: number;
  updateAt?: number[];
  removeAt?: number;
  writer: string;
  lifecycle: string;
  cite: string;
}

const FILES: FileSpec[] = [
  // checkout
  {
    id: "c-src",
    zone: "checkout",
    indent: 0,
    label: (s) =>
      s >= 5 ? "source tree — builds loader DDB756…" : "source tree — builds loader 1A21DA…",
    addAt: 0,
    updateAt: [5],
    writer: "you (git)",
    lifecycle:
      "The loader dll's filename embeds a SHA-256 of its own bytes, so every loader-code change mints a new hash. Nothing on disk moves until something deploys — drift is latent until a deploy meets an occupied slot.",
    cite: "InstallCommand.cs:2205 (LoaderShimFileName)",
  },
  {
    id: "c-out",
    zone: "checkout",
    indent: 1,
    label: () => "bin\\…\\Pe.App.dll + Pe.App.runtime.json (lane: dev)",
    addAt: 3,
    writer: "build (PeWriteRuntimeDescriptor)",
    lifecycle:
      "The runtime descriptor is an immutable launch receipt written by the build, never post-edited. The RRD payload loads from here via Assembly.LoadFrom in the default context — the one context Hot Reload can patch.",
    cite: "Pe.Revit.Publish.targets:250-289 · PayloadHost.cs:19-25",
  },
  {
    id: "c-hotep",
    zone: "checkout",
    indent: 1,
    label: (s) => `Pe.App.hotreload.json — port · token · generation ${s >= 4 ? "2" : "1"}`,
    addAt: 3,
    updateAt: [4],
    writer: "loader (HotReloadEndpoint)",
    lifecycle:
      "Endpoint contract file: descriptor path with .runtime.json → .hotreload.json. Written when the in-process endpoint starts, rewritten with each applied EnC generation, deleted on endpoint Dispose.",
    cite: "HotReloadEndpoint.cs:16-17,76,254",
  },
  // addins 2025
  {
    id: "a25-sel",
    zone: "addins",
    indent: 0,
    label: (s) => `2025\\00-Pe.App.addin → Pe.Revit.Loader.${s >= 9 ? "DDB756" : "1A21DA"}….dll`,
    addAt: 1,
    updateAt: [9],
    writer: "install apply · sandbox deploy · rrd deploy",
    lifecycle:
      "THE selector: the one manifest Revit reads for this product+year (00- sorts first, so its loader wins the process-wide bind). Bound to exactly one loader hash. Install writes it receipt-owned; a sandbox may reuse it if byte/routing-identical, deploy into an empty slot, or is refused if it differs.",
    cite: "SandboxCommand.cs:1082-1091 (priority) · 1044-1071 (reuse) · 1061-1067 (refuse)",
  },
  {
    id: "a25-shim1",
    zone: "addins",
    indent: 1,
    label: () => "2025\\Pe.App\\Pe.Revit.Loader.1A21DA….dll",
    addAt: 1,
    removeAt: 9,
    writer: "install apply (StageLoaderShim)",
    lifecycle:
      "Content-addressed loader shim. Never rewritten in place: a new loader lands beside it under its own hash, so a running Revit keeps loading the old file until restart. Superseded hashes are pruned only after the manifest flips, lock-tolerantly.",
    cite: "InstallCommand.cs:2149-2181 · 2189-2203 (prune)",
  },
  {
    id: "a25-shim2",
    zone: "addins",
    indent: 1,
    label: () => "2025\\Pe.App\\Pe.Revit.Loader.DDB756….dll",
    addAt: 9,
    writer: "install apply (release 0.7.0)",
    lifecycle:
      "The new hash coexisting with the old during the flip. Hash-named files never contend — the contention is only ever over the single 00- selector that names one of them.",
    cite: "InstallCommand.cs:2149-2155",
  },
  {
    id: "a25-contract",
    zone: "addins",
    indent: 1,
    label: () => "2025\\Pe.App\\Pe.Revit.Loader.dll (contract, fixed name)",
    addAt: 1,
    writer: "install apply (copied only if absent)",
    lifecycle:
      "The two-assembly shim design: the hashed dll is a tiny renamed bootstrap that forwards OnStartup/OnShutdown to this fixed-name contract assembly, so every product shares one contract ABI. Left in place if locked.",
    cite: "Loader.Bootstrap/LoaderApplication.cs:11-17 · InstallCommand.cs:2163-2170",
  },
  {
    id: "a25-json",
    zone: "addins",
    indent: 1,
    label: () => "2025\\Pe.App\\loader.json — payloadRoot · assembly · entryType",
    addAt: 1,
    updateAt: [9],
    writer: "install apply · build (atomic)",
    lifecycle:
      "Three flat fields telling the loader where the installed payload root is. Read with a regex, not a JSON library — net48 Revit has no BCL JSON. Rewritten atomically.",
    cite: "LoaderApplication.cs:47-55 · InstallCommand.cs:2172-2179",
  },
  // addins 2024
  {
    id: "a24-sel",
    zone: "addins",
    indent: 0,
    label: () => "2024\\00-Pe.App.addin → Pe.Revit.Loader.DDB756….dll",
    addAt: 6,
    writer: "sandbox deploy (EnsureSelector)",
    lifecycle:
      "Deployed by the sandbox CLI into an empty year slot, under a per-year file lock. It persists after the sandbox stops — deliberately: one selector serves every future descriptor-launched process, and a descriptor-less Revit just falls through it to current.txt (or no-ops).",
    cite: "SandboxCommand.cs:1010-1104 · locks :1019-1030",
  },
  {
    id: "a24-shim",
    zone: "addins",
    indent: 1,
    label: () => "2024\\Pe.App\\ — loader DDB756… + contract + loader.json",
    addAt: 6,
    writer: "sandbox deploy",
    lifecycle:
      "The build stages these inside the generation (PeStageSandboxSelector); only the CLI publishes them to shared Addins. An interrupted deploy that left the loader + manifest but no loader.json is self-healed by copying just the missing file — never replacing a receipt-owned byte.",
    cite: "Publish.targets:202-245 · SandboxCommand.cs:1046-1060",
  },
  // product
  {
    id: "p-manifest",
    zone: "product",
    indent: 0,
    label: () => "product.payloads.json (copied manifest)",
    addAt: 1,
    updateAt: [9],
    writer: "install apply (byte-faithful copy)",
    lifecycle: "Copied before the receipt, before the pointer. Names the product's payload set.",
    cite: "InstallCommand.cs:1014",
  },
  {
    id: "p-receipt",
    zone: "product",
    indent: 0,
    label: () => "install.receipt.json — every file, root + path + sha256",
    addAt: 1,
    updateAt: [9],
    writer: "install apply (schema 2)",
    lifecycle:
      "The exact-file inventory of what the install owns — this is what makes a selector 'receipt-owned' and what verify/remove read (destination-driven, checkout-free). Skipped on touchless re-apply when everything is already current.",
    cite: "InstallCommand.cs:1016-1028 · 995-1000",
  },
  {
    id: "p-v614",
    zone: "product",
    indent: 0,
    label: () => "addin\\versions\\0.6.14\\2025\\ — the installed payload",
    addAt: 1,
    removeAt: 9,
    writer: "install apply (mirror + StagedMarker)",
    lifecycle:
      "Version dirs are transaction staging, not retained fallback: a new version is staged alongside, the pointer flips, and noncanonical versions are pruned. A running Revit stays pinned to whatever it loaded until restart.",
    cite: "InstallCommand.cs:859-862 · 2240-2252 (PruneVersions) · 795-796",
  },
  {
    id: "p-v070",
    zone: "product",
    indent: 0,
    label: () => "addin\\versions\\0.7.0\\2025\\ — staged, then canonical",
    addAt: 9,
    writer: "install apply (release 0.7.0)",
    lifecycle:
      "Fully staged before any pointer moves. Activation is the current.txt flip, nothing else.",
    cite: "InstallCommand.cs:993-1032",
  },
  {
    id: "p-current",
    zone: "product",
    indent: 0,
    label: (s) => `current.txt → ${s >= 9 ? "0.7.0" : "0.6.14"}`,
    addAt: 1,
    updateAt: [9],
    writer: "install apply — “sole canonical commit, always last”",
    lifecycle:
      "The single pointer that makes a version real. Written after payloads, manifest, receipt, and selector — so a crash mid-install leaves the old version live (ADR-0001). Read exactly once at Revit startup; there is no live swap. The value must be one safe path segment — a hostile pointer can't traverse.",
    cite: "InstallCommand.cs:1031 · InstalledProduct.cs:205-221 · LoaderApplication.cs:9-14",
  },
  // sdk
  {
    id: "s-state",
    zone: "sdk",
    indent: 0,
    label: (s) =>
      `sandboxes\\fam-lab\\state.json — pid · startUtc · exe · generation${s >= 8 ? " · stoppedAtUtc" : ""}`,
    addAt: 6,
    updateAt: [8],
    writer: "sandbox start/stop (atomic tmp+rename)",
    lifecycle:
      "The logical registry entry for sandbox:fam-lab. Identity is the tuple (pid, processStartUtcTicks, exe) — stop verifies it before touching anything, so an OS-reused pid is refused, never killed. Persists across stop; a corrupt one is replaced by the next start.",
    cite: "SandboxCommand.cs:1423-1471 · 1516-1526 (identity) · 653-704 (StopCore)",
  },
  {
    id: "s-gen1",
    zone: "sdk",
    indent: 1,
    label: () => "generations\\20260716T101503…\\ — payload + descriptor + staged selector",
    addAt: 6,
    writer: "sandbox start (MaterializeSource)",
    lifecycle:
      "One immutable folder per materialization — every start/restart gets a fresh generation even at the same build stamp (buildStamp is provenance, never identity). Never mutated, never cleaned by stop. Restart materializes the NEW generation completely before stopping the old process, so failure preserves the old session.",
    cite: "SandboxCommand.cs:997-1008 · 719-775 · SPEC.md:149-151",
  },
  {
    id: "s-gen2",
    zone: "sdk",
    indent: 1,
    label: () => "generations\\20260716T102217…\\ — built for 2025, refused at the door",
    addAt: 7,
    writer: "sandbox start (2025 attempt)",
    lifecycle:
      "Materialization succeeded — the refusal happens later, at EnsureSelector, when the staged selector meets a receipt-owned one that differs. The generation stays on disk like any other; no Addins byte was written.",
    cite: "SandboxCommand.cs:1061-1067 (SelectorUnavailable)",
  },
  {
    id: "s-sess",
    zone: "sdk",
    indent: 0,
    label: () => "sessions\\<pid>.json + <pid>.events.jsonl — bridge port file + journal",
    addAt: 6,
    writer: "bridge (in-process, at runtime)",
    lifecycle:
      "Written by the running session's bridge. 'SDK-ready' is proven here: sandbox wait polls until the pid's port file exists and /status answers as OUR pid with OUR descriptor. Pid-named; dead pids are sweepable.",
    cite: "SandboxCommand.cs:1216-1222 (SdkReady) · SPEC.md:94-95",
  },
];

// ── the processes ───────────────────────────────────────────────────────────────────────────────

interface Proc {
  id: string;
  lane: SessionLane;
  pid: number;
  year: string;
  from: number;
  to?: number; // present for steps in [from, to)
  env: string[];
  boot: string[];
  payload: (step: number) => string;
  note: (step: number) => string;
}

const PROCS: Proc[] = [
  {
    id: "installed",
    lane: "installed",
    pid: 4128,
    year: "2025",
    from: 2,
    env: ["(no PE_ variables — a normal double-click)"],
    boot: [
      "selector → Pe.Revit.Loader.1A21DA….dll",
      "no descriptor env var → read current.txt once → “0.6.14”",
      "load versions\\0.6.14\\2025 in ALC “pe-payload:2025”",
    ],
    payload: () => "installed 0.6.14 · lane pinned “installed”",
    note: (s) =>
      s >= 9
        ? "Still serving 0.6.14 — current.txt is read once at boot, so the 0.7.0 flip lands at this process's next restart. No live swap, ever."
        : "The user's Revit. The lane is pinned “installed” by the code path itself, never inferred from markers.",
  },
  {
    id: "rrd",
    lane: "rrd",
    pid: 7444,
    year: "2025",
    from: 3,
    env: [
      "PE_REVIT_SESSION_DESCRIPTOR=…\\bin\\…\\Pe.App.runtime.json",
      "PE_HOT_RELOAD=1 · DOTNET_MODIFIABLE_ASSEMBLIES=debug",
    ],
    boot: [
      "same selector, same loader dll as the installed process",
      "descriptor found → lane dev, payloadSource source",
      "Assembly.LoadFrom(checkout bin) — default context, EnC-eligible",
      "PE_HOT_RELOAD=1 → start loopback /apply endpoint",
    ],
    payload: (s) => `src build · EnC generation ${s >= 4 ? "2" : "1"}`,
    note: (s) =>
      s >= 4
        ? "The emitter saw your save (100 ms mtime poll), compiled an EnC delta, POSTed it to /apply; MetadataUpdater.ApplyUpdate mutated the loaded module in place. No reload, no new files — method-body edits only."
        : "Rider round-trip debugging: debugger + Hot Reload against a source payload. Minutes to restart, often holding a real model — which is why the SDK never controls this process.",
  },
  {
    id: "sbx",
    lane: "sandbox",
    pid: 9204,
    year: "2024",
    from: 6,
    to: 8,
    env: [
      "PE_REVIT_SESSION_DESCRIPTOR=…\\generations\\20260716T101503…\\payload\\Pe.App.runtime.json",
    ],
    boot: [
      "2024 selector (just deployed) → loader DDB756…",
      "descriptor found → lane sandbox, sandboxId fam-lab",
      "load the generation's payload — frozen at materialization",
    ],
    payload: () => "generation 20260716T101503 · sandbox:fam-lab",
    note: () =>
      "SDK-spawned, agent-owned, disposable. Launched via ShellExecute with the descriptor env var — no journal-file trickery. Born with a ready selector (sandbox:fam-lab) for the targeting layer above.",
  },
];

// ── the scripted machine ────────────────────────────────────────────────────────────────────────

interface Step {
  key: string;
  title: string;
  actor: string;
  cmd?: string;
  caption: string;
  refusal?: string;
}

const STEPS: Step[] = [
  {
    key: "clean",
    title: "clean machine",
    actor: "—",
    caption:
      "Nothing anywhere. Revit would scan Addins\\<year>, find no Pe manifest, and boot without us. Everything below is written by exactly three actors: the installer, the build, and the sandbox CLI — Revit itself only ever reads.",
  },
  {
    key: "install",
    title: "install 0.6.14",
    actor: "installer",
    cmd: "pe install apply",
    caption:
      "Order is the whole design: payload mirrored into versions\\0.6.14\\2025 → loader shim staged under its content hash (1A21DA…) → selector manifest flipped atomically → manifest copy → receipt → current.txt LAST. A crash at any earlier line leaves the old world live. The receipt records every file it owns, by sha256 — that ownership is enforced later.",
  },
  {
    key: "open",
    title: "revit opens (normal)",
    actor: "the user",
    cmd: "double-click Revit 2025",
    caption:
      "Zero writes. Revit reads the selector, loads the hashed loader; the bootstrap forwards to the contract dll; loader.json points at the payload root; no PE_REVIT_SESSION_DESCRIPTOR in the environment → read current.txt once → load 0.6.14 in an isolated, non-collectible AssemblyLoadContext. If anything throws, the loader journals LoaderStartupFailed and returns Succeeded — fail-inert, never a startup dialog.",
  },
  {
    key: "rrd",
    title: "rrd session starts",
    actor: "you + rider",
    cmd: "F5 (debug from checkout)",
    caption:
      "The build writes the payload + runtime descriptor into your checkout's bin and deploys the worktree selector — which finds the installed selector byte-identical (same loader era) and reuses it untouched. Revit launches with the descriptor env var: same loader dll, different verdict. Two lanes now share one selector file.",
  },
  {
    key: "hot",
    title: "you save a .cs file",
    actor: "emitter",
    cmd: "(automatic — 100 ms poll)",
    caption:
      "Hot reload touches no shared zone. The out-of-process emitter owns the Roslyn EmitBaseline chain, computes an EnC delta from your edit, and POSTs {metadata, il, pdb} to the loader's token-authed loopback endpoint; MetadataUpdater.ApplyUpdate patches the already-loaded module. Same MVID, same assembly, new method bodies. Structural edits are rude edits — those need a restart.",
  },
  {
    key: "drift",
    title: "sdk moves to beta.96",
    actor: "you (git pull)",
    cmd: "git pull … loader source changed",
    caption:
      "Your checkout now builds loader DDB756… instead of 1A21DA…. Read the atlas: NOTHING else changed. Drift is not an event on disk — it's a latent disagreement between what your source builds and what the receipt owns, invisible until a deploy meets an occupied slot.",
  },
  {
    key: "sbx24",
    title: "sandbox → 2024",
    actor: "sdk cli",
    cmd: "pe sandbox start --project Pe.App --year 2024 --id fam-lab",
    caption:
      "Materialize: a fresh immutable generation (payload + descriptor + staged selector) under sandboxes\\fam-lab. Deploy: the 2024 Addins slot is empty — no receipt owns it — so the CLI publishes the DDB756… selector under a per-year lock. Launch: ShellExecute with PE_REVIT_SESSION_DESCRIPTOR pointing into the generation. `sandbox wait` then proves SDK-ready via the pid's bridge port file.",
  },
  {
    key: "sbx25",
    title: "sandbox → 2025: REFUSED",
    actor: "sdk cli",
    cmd: "pe sandbox start --project Pe.App --year 2025",
    refusal:
      "SelectorUnavailable — receipt-owned priority selector 2025\\00-Pe.App.addin (→ 1A21DA…) differs from this source candidate (→ DDB756…); refused to overwrite it.",
    caption:
      "The generation materialized fine. The refusal is at the Addins door: EnsureSelector compares the staged selector against the deployed one — manifest identity fields, loader byte SHA, loader.json routing — and they differ, and the deployed one belongs to the install receipt. Overwriting would repoint the USER's Revit at an unreceipted loader. Killing open Revits changes nothing: this is ownership + content, not a file lock.",
  },
  {
    key: "stop",
    title: "sandbox stop",
    actor: "sdk cli",
    cmd: "pe sandbox stop --id fam-lab",
    caption:
      "Stop verifies the identity tuple (pid + startUtc + exe) so it can never kill a stranger, arms no-save through the bridge (dirty scratch docs are discarded; workshared/cloud models are neither synced nor relinquished), closes gracefully, then updates state.json with stoppedAtUtc. What persists: state.json, every generation, the 2024 selector. Stop never un-deploys — the next sandbox reuses the selector for free.",
  },
  {
    key: "release",
    title: "release 0.7.0 ships",
    actor: "installer",
    cmd: "pe release --build … && pe install apply",
    caption:
      "The close. New payload staged; loader DDB756… lands BESIDE 1A21DA… (hash-named files never fight); selector flips to DDB756…; current.txt flips last; superseded loader and version pruned. Installed product and source checkout now agree on the loader hash — a 2025 source sandbox would hit reuse-if-identical. The still-running installed Revit keeps serving 0.6.14 until its next restart: pointers are read once, at boot.",
  },
];

const fileState = (f: FileSpec, step: number) => {
  if (step < f.addAt) return "absent" as const;
  if (f.removeAt !== undefined && step > f.removeAt) return "absent" as const;
  if (f.removeAt === step) return "pruned" as const;
  if (f.addAt === step || f.updateAt?.includes(step)) return "hot" as const;
  return "present" as const;
};

// ── disk atlas ──────────────────────────────────────────────────────────────────────────────────

function DiskAtlas({
  step,
  selected,
  onSelect,
}: {
  step: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {ZONES.map((zone) => {
        const rows = FILES.filter((f) => f.zone === zone.key);
        const visible = rows.filter((f) => fileState(f, step) !== "absent");
        return (
          <div
            key={zone.key}
            style={{
              border: "0.5px solid var(--line)",
              background: "var(--card)",
              borderRadius: 2,
            }}
          >
            <div className="px-2.5 py-1.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
              <div className="text-[11px] font-semibold" style={{ color: "var(--foreground)" }}>
                {zone.title}
              </div>
              <div
                className="truncate font-[var(--font-pe-mono)]"
                style={{ fontSize: 8.5, color: "var(--muted-foreground)" }}
              >
                {zone.root}
              </div>
            </div>
            <div className="px-1.5 py-1.5" style={{ minHeight: 96 }}>
              {visible.length === 0 ? (
                <div
                  className="px-1 py-2 font-[var(--font-pe-mono)]"
                  style={{ fontSize: 9, color: "var(--muted-foreground)" }}
                >
                  (empty)
                </div>
              ) : (
                visible.map((f) => {
                  const state = fileState(f, step);
                  const isSel = selected === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => onSelect(isSel ? null : f.id)}
                      className="block w-full text-left font-[var(--font-pe-mono)]"
                      style={{
                        fontSize: 9.5,
                        lineHeight: "1.5",
                        paddingLeft: 4 + f.indent * 10,
                        paddingRight: 4,
                        paddingTop: 1,
                        paddingBottom: 1,
                        borderRadius: 1,
                        cursor: "pointer",
                        color:
                          state === "pruned"
                            ? "var(--cat-clay)"
                            : state === "hot"
                              ? "var(--pe-blue)"
                              : "var(--foreground)",
                        textDecoration: state === "pruned" ? "line-through" : "none",
                        background: isSel
                          ? "color-mix(in srgb, var(--pe-blue) 8%, transparent)"
                          : state === "hot"
                            ? "color-mix(in srgb, var(--pe-blue) 4%, transparent)"
                            : "transparent",
                        border: isSel ? "1px solid var(--pe-blue)" : "1px solid transparent",
                      }}
                      title="inspect lifecycle"
                    >
                      {f.label(step)}
                      {state === "hot" ? " ●" : state === "pruned" ? " ✕ pruned" : ""}
                    </button>
                  );
                })
              )}
            </div>
            <p
              className="m-0 px-2.5 pb-2 text-[10px] leading-snug"
              style={{ color: "var(--muted-foreground)" }}
            >
              {zone.blurb}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function FileInspector({ id, step }: { id: string; step: number }) {
  const f = FILES.find((x) => x.id === id);
  if (!f) return null;
  return (
    <div
      className="mt-2 px-3 py-2"
      style={{
        border: "0.5px solid var(--pe-blue)",
        background: "color-mix(in srgb, var(--pe-blue) 3%, var(--card))",
        borderRadius: 2,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 10.5, color: "var(--pe-blue)" }}
        >
          {f.label(step)}
        </span>
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 9, color: "var(--muted-foreground)" }}
        >
          written by: {f.writer}
        </span>
      </div>
      <p
        className="m-0 mt-1 max-w-[100ch] text-[11.5px] leading-snug"
        style={{ color: "var(--foreground)" }}
      >
        {f.lifecycle}
      </p>
      <div
        className="mt-1 font-[var(--font-pe-mono)]"
        style={{ fontSize: 8.5, color: "var(--muted-foreground)" }}
      >
        {f.cite}
      </div>
    </div>
  );
}

// ── process rail ────────────────────────────────────────────────────────────────────────────────

function ProcessRail({ step }: { step: number }) {
  const live = PROCS.filter((p) => step >= p.from && (p.to === undefined || step < p.to));
  const justDied = PROCS.filter((p) => p.to === step);
  if (live.length === 0 && justDied.length === 0) {
    return (
      <div
        className="px-3 py-3 font-[var(--font-pe-mono)]"
        style={{
          fontSize: 10,
          color: "var(--muted-foreground)",
          border: "0.5px solid var(--line)",
          background: "var(--paper-3)",
          borderRadius: 2,
        }}
      >
        NO REVIT PROCESSES
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {live.map((p) => (
        <div
          key={p.id}
          style={{ border: "0.5px solid var(--line)", background: "var(--card)", borderRadius: 2 }}
        >
          <div
            className="flex items-center justify-between px-2 py-1.5"
            style={{ borderBottom: "0.5px solid var(--line-soft)" }}
          >
            <LaneBadge lane={p.lane} />
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, color: "var(--muted-foreground)" }}
            >
              revit {p.year} · pid {p.pid}
            </span>
          </div>
          <div className="px-2 py-1.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
            {p.env.map((e) => (
              <div
                key={e}
                className="break-all font-[var(--font-pe-mono)]"
                style={{ fontSize: 8.5, color: "var(--cat-kiln)" }}
              >
                {e}
              </div>
            ))}
          </div>
          <div className="px-2 py-1.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
            {p.boot.map((b, i) => (
              <div key={i} className="flex gap-1.5 py-px">
                <span
                  className="font-[var(--font-pe-mono)]"
                  style={{ fontSize: 8.5, color: "var(--line-2)" }}
                >
                  {i + 1}
                </span>
                <span
                  className="font-[var(--font-pe-mono)]"
                  style={{ fontSize: 8.5, color: "var(--muted-foreground)" }}
                >
                  {b}
                </span>
              </div>
            ))}
            <div
              className="mt-1 font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, color: laneVar(p.lane) }}
            >
              ▸ {p.payload(step)}
            </div>
          </div>
          <p
            className="m-0 px-2 py-1.5 text-[10.5px] leading-snug"
            style={{ color: "var(--muted-foreground)" }}
          >
            {p.note(step)}
          </p>
        </div>
      ))}
      {justDied.map((p) => (
        <div
          key={p.id}
          className="px-2 py-2"
          style={{
            border: "0.5px dashed var(--line)",
            background: "var(--paper-3)",
            borderRadius: 2,
            opacity: 0.7,
          }}
        >
          <div className="flex items-center justify-between">
            <LaneBadge lane={p.lane} />
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, color: "var(--cat-clay)" }}
            >
              pid {p.pid} · stopped
            </span>
          </div>
          <p
            className="m-0 mt-1 text-[10.5px] leading-snug"
            style={{ color: "var(--muted-foreground)" }}
          >
            Process gone; its generation, state.json, and deployed selector all remain. The process
            was the only ephemeral thing.
          </p>
        </div>
      ))}
    </div>
  );
}

// ── the whole machine, one picture ──────────────────────────────────────────────────────────────
// Every process, one selector, one loader, three payload homes. Click a process (or a lane chip)
// to trace its wire top to bottom; everything else on the page is a zoom into one region of this.

const BP_W = 880;
const BP_H = 560;
const BP_LANES: { lane: SessionLane; col: number }[] = [
  { lane: "installed", col: 0 },
  { lane: "rrd", col: 1 },
  { lane: "sandbox", col: 2 },
];
const bpColX = (col: number) => 25 + col * 295; // box x (w=240)
const bpColC = (col: number) => bpColX(col) + 120; // box center

interface BpProcBox {
  lane: SessionLane;
  title: string;
  env: string;
}
const BP_PROCS: BpProcBox[] = [
  { lane: "installed", title: "revit.exe — the user's", env: "(no PE_ env vars)" },
  {
    lane: "rrd",
    title: "revit.exe — rrd debug",
    env: "PE_REVIT_SESSION_DESCRIPTOR + PE_HOT_RELOAD",
  },
  { lane: "sandbox", title: "revit.exe — sandbox:fam-lab", env: "PE_REVIT_SESSION_DESCRIPTOR" },
];

interface BpPayloadBox {
  lane: SessionLane;
  title: string;
  lines: string[];
  writer: string;
}
const BP_PAYLOADS: BpPayloadBox[] = [
  {
    lane: "installed",
    title: "installed product",
    lines: ["%LOCALAPPDATA%\\Positive Energy\\Pe.Tools", "current.txt → versions\\<v>\\<year>"],
    writer: "written by: pe install apply",
  },
  {
    lane: "rrd",
    title: "your checkout",
    lines: ["bin\\…\\Pe.App.dll + Pe.App.runtime.json", "hot-reload deltas patch it in memory"],
    writer: "written by: the build (F5)",
  },
  {
    lane: "sandbox",
    title: "sandbox generation",
    lines: [
      "%LOCALAPPDATA%\\Pe.Revit.Sdk\\",
      "sandboxes\\fam-lab\\generations\\<ts>\\ — immutable",
    ],
    writer: "written by: pe sandbox start",
  },
];

const BP_FORKS: Partial<Record<SessionLane, string>> = {
  installed: "no descriptor → read current.txt (once)",
  rrd: "descriptor: lane dev → LoadFrom (EnC-eligible)",
  sandbox: "descriptor: lane sandbox → frozen payload",
};

function BigPicture() {
  const [lane, setLane] = useState<SessionLane | null>(null);
  const on = (l: SessionLane) => lane === null || lane === l;
  const wireOpacity = (l: SessionLane) => (lane === null ? 0.55 : lane === l ? 1 : 0.15);
  const boxOpacity = (l: SessionLane) => (lane === null ? 1 : lane === l ? 1 : 0.35);
  const wireColor = (l: SessionLane) => (lane === l ? laneVar(l) : "var(--line-2)");
  const pick = (l: SessionLane) => setLane((cur) => (cur === l ? null : l));

  // shared nodes
  const selY = 128;
  const selX = BP_W / 2 - 190;
  const selW = 380;
  const loaderY = 226;
  const loaderX = BP_W / 2 - 165;
  const loaderW = 330;
  const payloadY = 386;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={BP_W}
        height={BP_H}
        style={{ display: "block", fontFamily: "var(--font-pe-mono)" }}
        role="img"
        aria-label="Every Revit process reads the one selector, loads the one loader, and forks to its lane's payload"
      >
        {/* wires: proc → selector */}
        {BP_LANES.map(({ lane: l, col }) => (
          <path
            key={`w1-${l}`}
            d={`M ${bpColC(col)} 76 C ${bpColC(col)} 100, ${selX + selW / 2 + (col - 1) * 90} ${selY - 24}, ${selX + selW / 2 + (col - 1) * 90} ${selY}`}
            fill="none"
            stroke={wireColor(l)}
            strokeWidth={lane === l ? 1.8 : 1.1}
            opacity={wireOpacity(l)}
          />
        ))}
        {/* selector → loader (one wire — everyone takes it) */}
        <line
          x1={BP_W / 2}
          y1={selY + 52}
          x2={BP_W / 2}
          y2={loaderY}
          stroke={lane ? laneVar(lane) : "var(--line-2)"}
          strokeWidth={lane ? 1.8 : 1.1}
          opacity={lane ? 1 : 0.55}
        />
        {/* loader fork → payloads */}
        {BP_LANES.map(({ lane: l, col }) => (
          <g key={`w2-${l}`} opacity={wireOpacity(l)}>
            <path
              d={`M ${BP_W / 2 + (col - 1) * 100} ${loaderY + 58} C ${BP_W / 2 + (col - 1) * 100} ${loaderY + 100}, ${bpColC(col)} ${payloadY - 46}, ${bpColC(col)} ${payloadY}`}
              fill="none"
              stroke={wireColor(l)}
              strokeWidth={lane === l ? 1.8 : 1.1}
              strokeDasharray={l === "installed" ? undefined : "5 3"}
            />
            <text
              x={bpColC(col)}
              y={payloadY - 14}
              textAnchor="middle"
              fontSize={8.5}
              fill={on(l) ? (lane === l ? laneVar(l) : "var(--muted-foreground)") : "var(--line-2)"}
            >
              {BP_FORKS[l]}
            </text>
          </g>
        ))}
        {/* env-var annotation on the descriptor side */}
        <text
          x={BP_W / 2 + 172}
          y={loaderY + 32}
          fontSize={8.5}
          fill={lane === null || lane !== "installed" ? "var(--cat-kiln)" : "var(--line-2)"}
          opacity={lane === "installed" ? 0.3 : 1}
        >
          dashed = descriptor-launched
        </text>

        {/* process boxes */}
        {BP_PROCS.map((p, col) => (
          <g
            key={p.lane}
            opacity={boxOpacity(p.lane)}
            onClick={() => pick(p.lane)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={bpColX(col)}
              y={8}
              width={240}
              height={68}
              rx={2}
              fill="var(--card)"
              stroke={lane === p.lane ? laneVar(p.lane) : "var(--line)"}
              strokeWidth={lane === p.lane ? 1.2 : 0.6}
            />
            <circle cx={bpColX(col) + 14} cy={26} r={3} fill={laneVar(p.lane)} />
            <text
              x={bpColX(col) + 24}
              y={29}
              fontSize={10}
              fontWeight={600}
              fill="var(--foreground)"
            >
              {p.title}
            </text>
            <text x={bpColX(col) + 12} y={47} fontSize={8} fill="var(--cat-kiln)">
              {p.env}
            </text>
            <text x={bpColX(col) + 12} y={63} fontSize={8} fill="var(--muted-foreground)">
              lane: {p.lane} · click to trace
            </text>
          </g>
        ))}

        {/* selector node */}
        <g>
          <rect
            x={selX}
            y={selY}
            width={selW}
            height={52}
            rx={2}
            fill="var(--paper-3)"
            stroke={lane ? laneVar(lane) : "var(--line)"}
            strokeWidth={lane ? 1.2 : 0.8}
          />
          <text
            x={BP_W / 2}
            y={selY + 20}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill="var(--foreground)"
          >
            Addins\&lt;year&gt;\00-Pe.App.addin → Pe.Revit.Loader.&lt;hash&gt;.dll
          </text>
          <text
            x={BP_W / 2}
            y={selY + 38}
            textAnchor="middle"
            fontSize={8.5}
            fill="var(--muted-foreground)"
          >
            THE SELECTOR — one per product+year, shared by every lane; the only contended file
          </text>
        </g>

        {/* loader node */}
        <g>
          <rect
            x={loaderX}
            y={loaderY}
            width={loaderW}
            height={58}
            rx={2}
            fill="var(--card)"
            stroke={lane ? laneVar(lane) : "var(--line)"}
            strokeWidth={lane ? 1.2 : 0.8}
          />
          <text
            x={BP_W / 2}
            y={loaderY + 20}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill="var(--foreground)"
          >
            THE LOADER — one question:
          </text>
          <text
            x={BP_W / 2}
            y={loaderY + 38}
            textAnchor="middle"
            fontSize={9.5}
            fill="var(--pe-blue)"
          >
            is PE_REVIT_SESSION_DESCRIPTOR set?
          </text>
        </g>

        {/* payload boxes */}
        {BP_PAYLOADS.map((p, col) => (
          <g
            key={p.lane}
            opacity={boxOpacity(p.lane)}
            onClick={() => pick(p.lane)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={bpColX(col)}
              y={payloadY}
              width={240}
              height={92}
              rx={2}
              fill="var(--card)"
              stroke={lane === p.lane ? laneVar(p.lane) : "var(--line)"}
              strokeWidth={lane === p.lane ? 1.2 : 0.6}
            />
            <rect x={bpColX(col)} y={payloadY} width={3} height={92} fill={laneVar(p.lane)} />
            <text
              x={bpColX(col) + 12}
              y={payloadY + 18}
              fontSize={10}
              fontWeight={600}
              fill="var(--foreground)"
            >
              {p.title}
            </text>
            {p.lines.map((line, i) => (
              <text
                key={i}
                x={bpColX(col) + 12}
                y={payloadY + 36 + i * 15}
                fontSize={8}
                fill="var(--muted-foreground)"
              >
                {line}
              </text>
            ))}
            <text x={bpColX(col) + 12} y={payloadY + 80} fontSize={8} fill={laneVar(p.lane)}>
              {p.writer}
            </text>
          </g>
        ))}

        {/* the three writers strip */}
        <text x={25} y={BP_H - 32} fontSize={8.5} fill="var(--muted-foreground)">
          Revit only ever READS. Three actors write: the installer (product + selector,
          receipt-owned) · the build (checkout
        </text>
        <text x={25} y={BP_H - 18} fontSize={8.5} fill="var(--muted-foreground)">
          payload + descriptor) · the sandbox CLI (generations + descriptors, and selectors into
          free year slots).
        </text>
      </svg>
    </div>
  );
}

// ── boot decision ───────────────────────────────────────────────────────────────────────────────
// The loader's OnStartup, as a traceable path. Modes highlight the branch each lane takes.

type BootMode = "installed" | "rrd" | "sandbox-source" | "sandbox-installed";

const BOOT_MODES: { key: BootMode; label: string; lane: SessionLane }[] = [
  { key: "installed", label: "normal (no descriptor)", lane: "installed" },
  { key: "rrd", label: "rrd (dev descriptor)", lane: "rrd" },
  { key: "sandbox-source", label: "sandbox · source", lane: "sandbox" },
  { key: "sandbox-installed", label: "sandbox · installed payload", lane: "sandbox" },
];

interface BootNode {
  text: string;
  cite?: string;
  modes: BootMode[]; // which modes pass through this node
}

const ALL: BootMode[] = ["installed", "rrd", "sandbox-source", "sandbox-installed"];

const BOOT_NODES: BootNode[] = [
  {
    text: "Revit scans Addins\\<year>, reads 00-Pe.App.addin, loads Pe.Revit.Loader.<hash>.dll",
    cite: "SandboxCommand.cs:1082-1091",
    modes: ALL,
  },
  {
    text: "bootstrap shim forwards to fixed-name contract Pe.Revit.Loader.dll (shared ABI across products)",
    cite: "Loader.Bootstrap/LoaderApplication.cs:11-17",
    modes: ALL,
  },
  {
    text: "read loader.json beside the dll: payloadRoot · assembly · entryType (regex — net48 has no JSON)",
    cite: "LoaderApplication.cs:47-55",
    modes: ALL,
  },
  {
    text: "is PE_REVIT_SESSION_DESCRIPTOR set? — the entire lane decision is this one env var naming a file",
    cite: "LoaderApplication.cs:17,57-68",
    modes: ALL,
  },
  {
    text: "YES → read + validate the *.runtime.json: lane ∈ {dev, sandbox} only (installed is definitionally descriptor-LESS); sandbox requires sandboxId; a descriptor naming a DIFFERENT product's assembly is ignored and that product falls through to its own current.txt",
    cite: "SessionDescriptor.cs:54-99",
    modes: ["rrd", "sandbox-source", "sandbox-installed"],
  },
  {
    text: "payloadSource=source → Assembly.LoadFrom the descriptor's payload in the DEFAULT context — the only context Hot Reload can patch",
    cite: "PayloadHost.cs:19-25",
    modes: ["rrd", "sandbox-source"],
  },
  {
    text: "payloadSource=installed → resolve the installed version dir via the receipt, isolated ALC (fresh process, shipped bytes)",
    cite: "LoaderApplication.cs:84-96",
    modes: ["sandbox-installed"],
  },
  {
    text: "PE_HOT_RELOAD=1 and net8 (2025+)? → start token-authed loopback /apply endpoint, write .hotreload.json beside the descriptor",
    cite: "HotReloadEndpoint.cs:14-18,44-51",
    modes: ["rrd", "sandbox-source"],
  },
  {
    text: "NO descriptor → read current.txt ONCE → versions\\<v>\\<year> → non-collectible ALC “pe-payload:<dir>” (net48: one AppDomain.AssemblyResolve hook routes per requesting payload) · lane pinned “installed”",
    cite: "LoaderApplication.cs:114-146 · PayloadHost.cs:116-142, 27-65",
    modes: ["installed"],
  },
  {
    text: "anything throws, anywhere → journal LoaderStartupFailed, return Result.Succeeded. Fail-inert: never a Revit startup dialog; worst case is “old version until restart”",
    cite: "LoaderApplication.cs:150-157",
    modes: ALL,
  },
];

function BootDecision() {
  const [mode, setMode] = useState<BootMode>("installed");
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {BOOT_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className="tele px-2 py-0.5"
            style={{
              fontSize: 10.5,
              borderRadius: 2,
              border: mode === m.key ? `1px solid ${laneVar(m.lane)}` : "1px solid var(--line)",
              color: mode === m.key ? laneVar(m.lane) : "var(--muted-foreground)",
              background:
                mode === m.key
                  ? `color-mix(in srgb, ${laneVar(m.lane)} 7%, transparent)`
                  : "transparent",
              cursor: "pointer",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div
        style={{ border: "0.5px solid var(--line)", background: "var(--card)", borderRadius: 2 }}
      >
        {BOOT_NODES.map((n, i) => {
          const active = n.modes.includes(mode);
          return (
            <div
              key={i}
              className="flex items-baseline gap-3 px-3 py-1.5"
              style={{
                borderBottom: i === BOOT_NODES.length - 1 ? "none" : "0.5px solid var(--line-soft)",
                opacity: active ? 1 : 0.35,
                borderLeft: active ? "2px solid var(--pe-blue)" : "2px solid transparent",
                transition: "opacity .12s ease",
              }}
            >
              <span
                className="font-[var(--font-pe-mono)]"
                style={{
                  fontSize: 9,
                  width: 16,
                  flexShrink: 0,
                  color: active ? "var(--pe-blue)" : "var(--line-2)",
                }}
              >
                {i + 1}
              </span>
              <div>
                <span className="text-[11.5px] leading-snug" style={{ color: "var(--foreground)" }}>
                  {n.text}
                </span>
                {n.cite ? (
                  <span
                    className="ml-2 font-[var(--font-pe-mono)]"
                    style={{ fontSize: 8.5, color: "var(--muted-foreground)" }}
                  >
                    {n.cite}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── hot reload anatomy ──────────────────────────────────────────────────────────────────────────

function HotReloadAnatomy() {
  const cols: { title: string; lines: string[]; cite: string }[] = [
    {
      title: "1 · emitter (out of process)",
      lines: [
        "one long-lived Pe.Revit.HotReload per session — it owns the Roslyn EmitBaseline chain",
        "polls every source doc's LastWriteTimeUtc every 100 ms",
        "on change: EmitDifference → an EnC delta {metadata, il, pdb}",
        "method-body edits only (methods, ctors, accessors, operators); structural edits = rude edit, restart",
      ],
      cite: "Pe.Revit.HotReload/Program.cs:1-11, 88-100, 127-160, 181-221",
    },
    {
      title: "2 · the wire",
      lines: [
        "POST /apply on a token-authed loopback HttpListener inside the loader",
        "double opt-in: PE_HOT_RELOAD=1 AND a valid descriptor; dev/sandbox lanes only",
        "requires DOTNET_MODIFIABLE_ASSEMBLIES=debug at launch; net8 only → Revit 2025+",
        "endpoint address+token live in <descriptor>.hotreload.json — the file the VS Code extension reads",
      ],
      cite: "HotReloadEndpoint.cs:14-18, 44-53, 76",
    },
    {
      title: "3 · apply (in place)",
      lines: [
        "MetadataUpdater.ApplyUpdate(assembly, metadata, il, pdb)",
        "the ALREADY-LOADED module is mutated: same assembly, same MVID, new method bodies",
        "no reload, no new ALC, no file writes to any shared zone",
        "strict ordering: generation must be exactly previous+1, MVID must match — a stale emitter is refused",
      ],
      cite: "HotReloadEndpoint.cs:176-199",
    },
  ];
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        {cols.map((c) => (
          <div
            key={c.title}
            style={{
              border: "0.5px solid var(--line)",
              background: "var(--card)",
              borderRadius: 2,
            }}
          >
            <div
              className="px-2.5 py-1.5 text-[11px] font-semibold"
              style={{ borderBottom: "0.5px solid var(--line-soft)", color: "var(--foreground)" }}
            >
              {c.title}
            </div>
            <ul className="m-0 list-none px-2.5 py-1.5">
              {c.lines.map((l, i) => (
                <li
                  key={i}
                  className="py-0.5 text-[11px] leading-snug"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {l}
                </li>
              ))}
            </ul>
            <div
              className="px-2.5 pb-2 font-[var(--font-pe-mono)]"
              style={{ fontSize: 8.5, color: "var(--muted-foreground)" }}
            >
              {c.cite}
            </div>
          </div>
        ))}
      </div>
      <div
        className="mt-3 px-3 py-2"
        style={{
          border: "0.5px solid var(--cat-kiln)",
          background: "color-mix(in srgb, var(--cat-kiln) 4%, var(--card))",
          borderRadius: 2,
        }}
      >
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 9, letterSpacing: "0.06em", color: "var(--cat-kiln)" }}
        >
          ONE WORD, TWO MEANINGS
        </span>
        <p
          className="m-0 mt-1 max-w-[100ch] text-[11.5px] leading-snug"
          style={{ color: "var(--foreground)" }}
        >
          A <strong>sandbox generation</strong> is an immutable folder on disk — one per
          materialization, never mutated, survives stop. A <strong>hot-reload generation</strong> is
          an in-memory EnC delta counter on the same loaded module — it resets when the process dies
          and never touches disk beyond the endpoint file. Unrelated mechanisms sharing a word; when
          someone says "generation", ask which.
        </p>
      </div>
    </div>
  );
}

// ── lifecycle reference ─────────────────────────────────────────────────────────────────────────

const LIFECYCLE_ROWS: { artifact: string; written: string; updated: string; dies: string }[] = [
  {
    artifact: "loader dll (hashed)",
    written: "install apply / dev·sandbox deploy — content-addressed, never rewritten in place",
    updated: "never — a new hash lands beside it",
    dies: "pruned after the selector flips away from it (lock-tolerant)",
  },
  {
    artifact: "selector (00-….addin)",
    written: "install apply (receipt-owned) · sandbox/rrd deploy into a free slot",
    updated:
      "atomic replace on version flip; refused if a differing receipt-owned one occupies the slot",
    dies: "install remove — never on sandbox stop",
  },
  {
    artifact: "payload versions\\<v>\\<year>",
    written: "install apply (mirror + StagedMarker)",
    updated: "never — new version staged alongside; current.txt flip activates",
    dies: "PruneVersions after the flip; running Revits keep the loaded one until restart",
  },
  {
    artifact: "current.txt",
    written: "install apply — always the last write (the commit point)",
    updated: "rewritten atomically per release",
    dies: "install remove",
  },
  {
    artifact: "runtime descriptor (*.runtime.json)",
    written: "build (dev/sandbox source) or CLI (installed sandbox) — immutable launch receipt",
    updated: "never post-edited; each launch/restart gets its own",
    dies: "dev clean; sandbox ones live inside their generation, retained",
  },
  {
    artifact: "sandbox generation folder",
    written: "sandbox start/restart — one immutable folder per materialization",
    updated: "never",
    dies: "not cleaned by stop; manual/GC only",
  },
  {
    artifact: "state.json (per sandbox)",
    written: "sandbox start (atomic tmp+rename)",
    updated: "every start/restart/stop (stoppedAtUtc)",
    dies: "not auto-deleted; corrupt one replaced by next start",
  },
  {
    artifact: "bridge session files (<pid>.json/.events.jsonl)",
    written: "the running session's bridge",
    updated: "appended live",
    dies: "sweepable once the pid is dead",
  },
  {
    artifact: "hotreload.json endpoint file",
    written: "loader's HotReloadEndpoint on start",
    updated: "rewritten per applied EnC generation",
    dies: "deleted on endpoint Dispose (payload stop)",
  },
];

// ── glossary ────────────────────────────────────────────────────────────────────────────────────

const GLOSSARY: [string, string][] = [
  [
    "lane",
    "the runtime mode of one Revit session: installed · dev/rrd · sandbox. Decided at boot by the loader, pinned, never inferred afterward.",
  ],
  ["payload", "the real Pe.App assembly the loader loads and delegates IExternalApplication to."],
  [
    "loader",
    "the tiny shim Revit actually loads. Hash-named bootstrap + fixed-name contract. Decides the lane; the Revit analogue of PathShim.",
  ],
  [
    "selector",
    "Addins\\<year>\\00-Pe.App.addin + its loader dir — the single routing artifact Revit reads. One per product+year; the only contended file in the system.",
  ],
  [
    "descriptor",
    "a *.runtime.json launch receipt named by PE_REVIT_SESSION_DESCRIPTOR. Immutable; its presence IS the difference between lanes.",
  ],
  [
    "receipt",
    "install.receipt.json — the exact-file (sha256) inventory of what the install owns. “Receipt-owned” is what makes overwrite a refusal instead of a race.",
  ],
  ["generation (sandbox)", "one immutable build-output folder per sandbox materialization."],
  ["generation (EnC)", "the hot-reload delta counter on a loaded module. Unrelated to the above."],
  [
    "slot",
    "a fixed indirection class (Slots.SlotNN) ribbon buttons target — commands route through slots so payload types never leak into Revit's UI registry.",
  ],
  [
    "rrd",
    "Rider round-trip debugging — the interactive dev lane: debugger + hot reload against a source payload, user-owned, never controlled by the SDK.",
  ],
];

// ── your machine right now ──────────────────────────────────────────────────────────────────────

const LANE_STORY: Record<string, string> = {
  installed:
    "took the descriptor-less path: current.txt → installed payload (step 2 of the scenario)",
  rrd: "descriptor-launched from a checkout, hot-reload endpoint live (step 3)",
  sandbox: "descriptor-launched from an immutable generation (step 6)",
  unknown:
    "registered without a lane — a pre-identity payload; unreachable via user vocabulary, by design",
};

function LiveWorld() {
  const { resolution, sessions, isLoading } = useTarget("");
  const nowMs = Date.now();
  return (
    <div style={{ border: "0.5px solid var(--line)", background: "var(--card)", borderRadius: 2 }}>
      {isLoading ? (
        <div
          className="px-3 py-2 font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, color: "var(--muted-foreground)" }}
        >
          asking the broker…
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="px-3 py-2 font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, color: "var(--muted-foreground)" }}
        >
          NO SESSIONS — no Revit is attached to the broker right now. Open one (or start a sandbox)
          and this strip fills in live.
        </div>
      ) : (
        sessions.map((s, i) => (
          <div
            key={s.sessionId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5"
            style={{
              borderBottom: i === sessions.length - 1 ? "none" : "0.5px solid var(--line-soft)",
            }}
          >
            <LaneBadge lane={s.lane} />
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 10, color: "var(--foreground)" }}
            >
              pid {s.processId} · {s.activeDocumentTitle ?? "(no doc)"} · {s.openDocumentCount} open
              · {ageLabel(s.observedAtUnixMs, nowMs)}
              {s.sandboxId ? ` · sandbox:${s.sandboxId}` : ""}
            </span>
            <span className="text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
              {LANE_STORY[s.lane] ?? ""}
            </span>
          </div>
        ))
      )}
      {!isLoading && sessions.length > 1 && resolution.kind === "ambiguous" ? (
        <div
          className="px-3 py-1.5 font-[var(--font-pe-mono)]"
          style={{
            fontSize: 9,
            color: "var(--cat-kiln)",
            borderTop: "0.5px solid var(--line-soft)",
          }}
        >
          {sessions.length} sessions — an untargeted call would 409 here. That's the targeting
          layer's problem; see docs/target.
        </div>
      ) : null}
    </div>
  );
}

// ── the ledger — what would make this page better ───────────────────────────────────────────────

const LEDGER: { state: "truth" | "next" | "open"; text: string }[] = [
  {
    state: "truth",
    text: "This page's scenario is scripted, but every rule it demonstrates is cited to SDK source at beta.96. If the SDK moves, the citations are the tripwire.",
  },
  {
    state: "next",
    text: "A host op that reads the REAL disk: selector hashes per year, current.txt, receipt version, sandbox registry. Then the atlas renders your actual machine instead of a script — the same page becomes a diagnostic (“why was my 2025 sandbox refused” answers itself).",
  },
  {
    state: "next",
    text: "bridge.sessions.list carries buildStamp + loader hash per session, so the live strip can show payload provenance (installed 0.6.14 vs src@8455251) instead of just lane.",
  },
  {
    state: "open",
    text: "Selector co-ownership: side-by-side loader hashes with per-descriptor routing would dissolve the refuse-if-differing case entirely. Today's answer is “release after loader changes”; once the loader stops churning, the whole drift class goes quiet on its own.",
  },
  {
    state: "open",
    text: "User-facing cut: hide the checkout zone and rrd lane behind a “dev machine” toggle — installed + sandbox is the whole story a Pe.Tools user needs.",
  },
];

const LEDGER_TONE: Record<(typeof LEDGER)[number]["state"], string> = {
  truth: "var(--cat-green)",
  next: "var(--pe-blue)",
  open: "var(--cat-kiln)",
};

// ── page ────────────────────────────────────────────────────────────────────────────────────────

function DocsRuntime() {
  const [step, setStep] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3200);
    return () => clearInterval(id);
  }, [playing]);

  const world = STEPS[step]!;
  const writes = useMemo(
    () =>
      FILES.filter((f) => fileState(f, step) === "hot" || fileState(f, step) === "pruned").length,
    [step],
  );

  const goto = (i: number) => {
    setStep(i);
    setPlaying(false);
    setSelectedFile(null);
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="page-wrap py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--muted-foreground)" }}
            >
              DOCS / RUNTIME
            </div>
            <h1
              className="m-0 text-[22px] font-semibold"
              style={{ fontFamily: "var(--font-pe-display)", color: "var(--pe-blue)" }}
            >
              Loader, lanes &amp; the disk
            </h1>
            <p
              className="mt-1 max-w-[74ch] text-[13px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              The layer below{" "}
              <a href="/docs/target" style={{ color: "var(--pe-blue)" }}>
                docs/target
              </a>
              : that page explains which session a call reaches; this one explains how a session
              with a given lane comes to exist at all. One loader, one selector per year, one
              pointer file — and three actors (installer, build, sandbox CLI) writing to four places
              on disk. Revit itself only ever <em>reads</em>. Every claim is cited to Pe.Revit.Sdk
              source (beta.96, 02ad1bb).
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* ── the invariant ─────────────────────────────────────────────────────────────────── */}
        <section className="mb-8">
          <SectionLabel label="the one-sentence model" />
          <div
            className="px-3 py-2.5"
            style={{
              border: "0.5px solid var(--line)",
              background: "var(--card)",
              borderRadius: 2,
            }}
          >
            <p
              className="m-0 max-w-[100ch] text-[13px] leading-relaxed"
              style={{ color: "var(--foreground)" }}
            >
              Revit loads exactly one thing — a hash-named <strong>loader</strong> shim, named by
              the <strong>selector</strong> manifest in the shared Addins folder. At boot, the
              loader asks one question: <em>is PE_REVIT_SESSION_DESCRIPTOR set?</em> If yes, the
              named <strong>descriptor</strong> file dictates lane and payload (rrd or sandbox). If
              no, it reads <strong>current.txt</strong> once and loads the{" "}
              <strong>installed</strong> payload. That single indirection is how one Addins folder
              serves your everyday Revit, your debug session, and any number of sandboxes at the
              same time.
            </p>
          </div>
        </section>

        {/* ── the whole machine ─────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="the whole machine, one picture" />
          <p className="mb-2 max-w-[76ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            The shape everything below zooms into: any number of Revit processes funnel through{" "}
            <em>one</em> selector and <em>one</em> loader, then fan out to three payload homes based
            on a single env var. Click a process or payload to trace its lane end to end — solid
            means the descriptor-less default, dashed means descriptor-launched.
          </p>
          <BigPicture />
        </section>

        {/* ── boot decision ─────────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="boot — the loader's decision, traceable" />
          <p className="mb-2 max-w-[74ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            The same dll takes all four paths; only the environment differs. Click a lane and follow
            its branch. Note what is <em>absent</em>: no registry, no polling, no IPC at boot — one
            env var, three files.
          </p>
          <BootDecision />
        </section>

        {/* ── the machine in motion ─────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="the machine in motion" />
          <p className="mb-3 max-w-[78ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            A scripted machine, reenacting a real week: install 0.6.14, run normally, debug with hot
            reload, pull an SDK that changed the loader, watch a 2024 sandbox deploy freely and a
            2025 one get <em>refused</em>, stop the sandbox, and close the drift with a release.
            Scrub the steps; the atlas pulses what was written (●) and struck what was pruned (✕).
            Click any file for its full lifecycle and citation.
          </p>

          <div className="mb-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="px-3 py-1 text-[12px]"
              style={{
                borderRadius: 2,
                border: "1px solid var(--line-2)",
                background: playing ? "var(--pe-blue)" : "transparent",
                color: playing ? "var(--primary-foreground)" : "var(--foreground)",
              }}
            >
              {playing ? "Pause" : "Play the week"}
            </button>
            <div className="flex flex-wrap items-center">
              {STEPS.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => goto(i)}
                  className="tele px-2 py-1"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.03em",
                    color: s.refusal
                      ? i === step
                        ? "var(--cat-clay)"
                        : "color-mix(in srgb, var(--cat-clay) 65%, transparent)"
                      : i === step
                        ? "var(--pe-blue)"
                        : "var(--muted-foreground)",
                    borderBottom:
                      i === step
                        ? `2px solid ${s.refusal ? "var(--cat-clay)" : "var(--pe-blue)"}`
                        : "2px solid var(--line-soft)",
                    cursor: "pointer",
                  }}
                >
                  {i}·{s.title}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, letterSpacing: "0.06em", color: "var(--muted-foreground)" }}
            >
              ACTOR: {world.actor}
            </span>
            {world.cmd ? (
              <span
                className="font-[var(--font-pe-mono)]"
                style={{ fontSize: 10, color: "var(--pe-blue)" }}
              >
                $ {world.cmd}
              </span>
            ) : null}
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, color: "var(--muted-foreground)" }}
            >
              {writes} file{writes === 1 ? "" : "s"} touched this step
            </span>
          </div>

          {world.refusal ? (
            <div
              className="mb-3 px-3 py-2"
              style={{
                border: "1px solid var(--cat-clay)",
                background: "color-mix(in srgb, var(--cat-clay) 5%, var(--card))",
                borderRadius: 2,
              }}
            >
              <span
                className="font-[var(--font-pe-mono)]"
                style={{ fontSize: 9, letterSpacing: "0.06em", color: "var(--cat-clay)" }}
              >
                DIAGNOSTIC
              </span>
              <div
                className="mt-0.5 break-all font-[var(--font-pe-mono)]"
                style={{ fontSize: 10.5, color: "var(--foreground)" }}
              >
                {world.refusal}
              </div>
            </div>
          ) : null}

          <p
            className="mb-3 max-w-[100ch] text-[12px] leading-relaxed"
            style={{ color: "var(--foreground)" }}
          >
            {world.caption}
          </p>

          <DiskAtlas step={step} selected={selectedFile} onSelect={setSelectedFile} />
          {selectedFile ? <FileInspector id={selectedFile} step={step} /> : null}

          <div className="mt-4">
            <SectionLabel label="processes — what each running revit believes" />
            <ProcessRail step={step} />
          </div>
        </section>

        {/* ── hot reload ────────────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="hot reload — code moves, no file does" />
          <p className="mb-3 max-w-[76ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            The only mechanism in the whole system that changes running code without a restart — and
            it does it by mutating the loaded module in memory, not by loading anything new. Three
            parts:
          </p>
          <HotReloadAnatomy />
        </section>

        {/* ── lifecycle table ───────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="lifecycle reference — every artifact, birth to death" />
          <div style={{ overflowX: "auto" }}>
            <table
              className="w-full border-collapse"
              style={{ border: "0.5px solid var(--line)", minWidth: 720 }}
            >
              <thead>
                <tr style={{ borderBottom: "0.5px solid var(--line)" }}>
                  {["artifact", "written by", "updated", "dies"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-1.5 text-left font-[var(--font-pe-mono)]"
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.06em",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {h.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIFECYCLE_ROWS.map((r) => (
                  <tr key={r.artifact} style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                    <td
                      className="px-3 py-1.5 font-[var(--font-pe-mono)]"
                      style={{ fontSize: 10.5, color: "var(--pe-blue)", whiteSpace: "nowrap" }}
                    >
                      {r.artifact}
                    </td>
                    <td className="px-3 py-1.5 text-[11px]" style={{ color: "var(--foreground)" }}>
                      {r.written}
                    </td>
                    <td
                      className="px-3 py-1.5 text-[11px]"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {r.updated}
                    </td>
                    <td
                      className="px-3 py-1.5 text-[11px]"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {r.dies}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── glossary + live ───────────────────────────────────────────────────────────────── */}
        <section className="mb-10 grid gap-6 lg:grid-cols-2">
          <div>
            <SectionLabel label="vocabulary" />
            <table className="w-full border-collapse" style={{ border: "0.5px solid var(--line)" }}>
              <tbody>
                {GLOSSARY.map(([term, def]) => (
                  <tr key={term} style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                    <td
                      className="px-3 py-1.5 align-top font-[var(--font-pe-mono)]"
                      style={{ fontSize: 10.5, color: "var(--pe-blue)", whiteSpace: "nowrap" }}
                    >
                      {term}
                    </td>
                    <td
                      className="px-3 py-1.5 text-[11px] leading-snug"
                      style={{ color: "var(--foreground)" }}
                    >
                      {def}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <SectionLabel label="your machine, right now" />
            <p
              className="mb-2 max-w-[56ch] text-[12px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Live from the broker (the same <code>useTarget</code> the product uses; updates ride
              the /events stream). Each attached session is one instance of the story above.
            </p>
            <LiveWorld />
          </div>
        </section>

        {/* ── ledger ────────────────────────────────────────────────────────────────────────── */}
        <section>
          <SectionLabel label="the ledger — where this page should go" />
          <div
            style={{
              border: "0.5px solid var(--line)",
              background: "var(--card)",
              borderRadius: 2,
            }}
          >
            {LEDGER.map((row, i) => (
              <div
                key={i}
                className="flex items-baseline gap-3 px-3 py-2"
                style={{
                  borderBottom: i === LEDGER.length - 1 ? "none" : "0.5px solid var(--line-soft)",
                }}
              >
                <span
                  className="font-[var(--font-pe-mono)]"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.06em",
                    width: 44,
                    flexShrink: 0,
                    color: LEDGER_TONE[row.state],
                  }}
                >
                  {row.state.toUpperCase()}
                </span>
                <span className="text-[12px] leading-snug" style={{ color: "var(--foreground)" }}>
                  {row.text}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div
      className="mb-1.5 font-[var(--font-pe-mono)]"
      style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--foreground)" }}
    >
      {label.toUpperCase()}
    </div>
  );
}
