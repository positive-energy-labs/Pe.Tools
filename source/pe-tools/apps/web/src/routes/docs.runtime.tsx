import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";
import type { SessionFacts, SessionLane } from "#/host/target";
import { ageLabel, LaneBadge, laneVar } from "#/host/target-ui";
import { useTarget, useWorldLog } from "#/host/use-target";

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
    blurb: "Dev machines only. Pins the SDK version — and whether loaders get dev-signed.",
  },
  {
    key: "addins",
    title: "revit's door",
    root: "%APPDATA%\\Autodesk\\Revit\\Addins\\<year>",
    blurb:
      "The only place Revit looks. One folder, every lane — so writes are guarded by ownership, not locks.",
  },
  {
    key: "product",
    title: "installed product",
    root: "%LOCALAPPDATA%\\Positive Energy\\Pe.Tools",
    blurb:
      "What users have. One canonical version; current.txt is the commit point, always written last.",
  },
  {
    key: "sdk",
    title: "sdk state",
    root: "%LOCALAPPDATA%\\Pe.Revit.Sdk",
    blurb:
      "Sandbox registry + generations + journals. Revit never reads this; only the CLI and bridge do. Doesn't exist on user machines.",
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
  content?: (step: number) => string[];
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
      "Your checkout has no loader source — the loader ships pre-built in the pinned SDK package. Each dev build re-stamps it (rename per product, dev-sign if dev-sign.props exists, hash). The filename hex is the SHA-256 of the final bytes, so a signature alone mints a “different” loader. Nothing moves on disk until a deploy meets an occupied slot.",
    cite: "Publish.targets:58-98 (PeBuildIsolatedLoader) · Commands.cs:975",
  },
  {
    id: "c-out",
    zone: "checkout",
    indent: 1,
    label: () => "bin\\…\\Pe.App.dll + Pe.App.runtime.json (lane: dev)",
    addAt: 3,
    writer: "build (PeWriteRuntimeDescriptor)",
    lifecycle:
      "Immutable launch receipt, written by the build, never edited. RRD loads from here via LoadFrom in the default context — the only context hot reload can patch.",
    cite: "Pe.Revit.Publish.targets:250-289 · PayloadHost.cs:19-25",
    content: () => [
      "Pe.App.runtime.json:",
      '  { "lane": "dev", "payloadSource": "source",',
      '    "path": "…\\\\bin\\\\Pe.App\\\\Debug.R25" }',
    ],
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
      "Endpoint contract: address + token + EnC generation. Rewritten per applied edit; deleted on shutdown.",
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
      "This .addin file IS the selector. Revit reads it first (00- sorts first); it names exactly one loader hash. Install writes it receipt-owned; a sandbox reuses it (identical), fills an empty slot, or is refused (differs).",
    cite: "SandboxCommand.cs:1082-1091 (priority) · 1044-1071 (reuse) · 1061-1067 (refuse)",
    content: (s) => [
      '<AddIn Type="Application">',
      `  <Assembly>Pe.App\\Pe.Revit.Loader.${s >= 9 ? "DDB756" : "1A21DA"}….dll</Assembly>`,
      "  <FullClassName>Pe.Revit.Loader.LoaderApplication</FullClassName>",
      "  <AddInId>43B12CEC-8FCF-4E33-…</AddInId>",
    ],
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
      "The hex name = SHA-256 of the whole file. A signature lives INSIDE the dll (Authenticode block) and is hashed too — sign it and it becomes a “different loader”. Never rewritten in place: new hashes land beside it; superseded ones are pruned after the manifest flips.",
    cite: "InstallCommand.cs:2149-2205 · 2189-2203 (prune)",
  },
  {
    id: "a25-shim2",
    zone: "addins",
    indent: 1,
    label: () => "2025\\Pe.App\\Pe.Revit.Loader.DDB756….dll",
    addAt: 9,
    writer: "install apply (release 0.7.0)",
    lifecycle:
      "New hash beside the old — hash-named files never fight. Only the one selector manifest is contested.",
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
      "The hashed dll is a tiny bootstrap that forwards to this fixed-name contract, so all products share one ABI. Copied only if absent.",
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
      "Three fields pointing at the installed payload root. Read with a regex — net48 Revit has no JSON library.",
    cite: "LoaderApplication.cs:47-55 · InstallCommand.cs:2172-2179",
    content: () => [
      '{ "schemaVersion": 2,',
      '  "payloadRoot": "…\\\\Positive Energy\\\\Pe.Tools\\\\addin",',
      '  "assembly": "Pe.App", "entryType": "Pe.App.AppCore" }',
    ],
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
      "Deployed by the sandbox CLI into an empty year. Persists after stop — the next sandbox reuses it, and a descriptor-less Revit falls through it to current.txt (or no-ops).",
    cite: "SandboxCommand.cs:1010-1104",
  },
  {
    id: "a24-shim",
    zone: "addins",
    indent: 1,
    label: () => "2024\\Pe.App\\ — loader DDB756… + contract + loader.json",
    addAt: 6,
    writer: "sandbox deploy",
    lifecycle:
      "Staged by the build inside the generation; only the CLI publishes to shared Addins. Interrupted deploys self-heal by copying just the missing file — never replacing a receipt-owned byte.",
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
      "sha256 inventory of every file the install owns. “Receipt-owned” is why overwrites become refusals instead of races.",
    cite: "InstallCommand.cs:1016-1028 · 995-1000",
    content: (s) => [
      `{ "releaseVersion": "${s >= 9 ? "0.7.0" : "0.6.14"}",`,
      '  "files": [',
      `    { "path": "…2025\\\\00-Pe.App.addin", "sha256": "…" },   ← owns the selector`,
      `    { "path": "…Pe.Revit.Loader.${s >= 9 ? "DDB756" : "1A21DA"}….dll", "sha256": "…" },`,
      "    …×5906 ] }",
    ],
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
      "Version dirs are staging, not fallback: new version lands alongside, pointer flips, old is pruned. A running Revit keeps what it loaded until restart.",
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
      "The pointer that makes a version real — always the last write, so a crash leaves the old version live. Read once per Revit start; no live swap.",
    cite: "InstallCommand.cs:1031 · InstalledProduct.cs:205-221 · LoaderApplication.cs:9-14",
    content: (s) => [s >= 9 ? "0.7.0" : "0.6.14"],
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
      "The registry entry for sandbox:fam-lab. Stop verifies (pid, startUtc, exe) before touching anything — an OS-reused pid is refused, never killed. Survives stop.",
    cite: "SandboxCommand.cs:1423-1471 · 1516-1526 (identity) · 653-704 (StopCore)",
    content: (s) => [
      '{ "pid": 9204, "processStartUtcTicks": 638…,',
      '  "revitExecutable": "…\\\\Revit 2024\\\\Revit.exe",',
      '  "generation": "20260716T101503…"' + (s >= 8 ? "," : " }"),
      ...(s >= 8 ? ['  "stoppedAtUtc": "2026-07-16T18:42:07Z" }'] : []),
    ],
  },
  {
    id: "s-gen1",
    zone: "sdk",
    indent: 1,
    label: () => "generations\\20260716T101503…\\ — payload + descriptor + staged selector",
    addAt: 6,
    writer: "sandbox start (MaterializeSource)",
    lifecycle:
      "One immutable folder per start/restart; never mutated, never cleaned by stop. Restart builds the new generation fully before stopping the old process, so failure preserves the old session.",
    cite: "SandboxCommand.cs:997-1008 · 719-775 · SPEC.md:149-151",
    content: () => [
      "payload\\Pe.App.runtime.json:",
      '  { "lane": "sandbox", "sandboxId": "fam-lab",',
      '    "payloadSource": "source", "path": "…\\\\payload" }',
      "selector\\00-Pe.App.addin  → loader DDB756… (staged)",
    ],
  },
  {
    id: "s-gen2",
    zone: "sdk",
    indent: 1,
    label: () => "generations\\20260716T102217…\\ — built for 2025, refused at the door",
    addAt: 7,
    writer: "sandbox start (2025 attempt)",
    lifecycle:
      "Built fine — the refusal happens later, at the Addins door. Nothing shared was written; the generation stays on disk like any other.",
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
      "Written by the running session's bridge. “SDK-ready” = this port file exists and /status answers as our pid + descriptor.",
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
        ? "Still serving 0.6.14 — current.txt is read once at boot. The flip lands at next restart."
        : "The user's Revit. Lane pinned by the code path, never inferred.",
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
        ? "The emitter saw your save, sent a delta, ApplyUpdate patched the loaded module. No reload, no new files."
        : "Debugger + hot reload on a source payload. User-owned; the SDK never controls this process.",
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
      "Agent-owned, disposable. Its isolation IS the env var + payload living in the generation — no separate Addins folder exists.",
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
      "Nothing anywhere. Three actors write everything below — installer, build, sandbox CLI. Revit only ever reads.",
  },
  {
    key: "install",
    title: "install 0.6.14",
    actor: "installer",
    cmd: "pe install apply",
    caption:
      "Order is the design: payload → loader (1A21DA…, unsigned) → selector → receipt → current.txt LAST. A crash anywhere earlier leaves the old world live. The receipt lists every owned file by sha256 — that ownership bites later.",
  },
  {
    key: "open",
    title: "revit opens (normal)",
    actor: "the user",
    cmd: "double-click Revit 2025",
    caption:
      "Zero writes. Selector → loader → no env var → current.txt (read once) → 0.6.14 in an isolated ALC. This is the ONLY path user machines ever take. Errors journal and go inert — never a startup dialog.",
  },
  {
    key: "rrd",
    title: "rrd session starts",
    actor: "you + rider",
    cmd: "F5 (debug from checkout)",
    caption:
      "The build re-stamps the SDK package's pre-built loader (it is NOT compiled from your checkout), finds the installed selector identical → reuses it untouched. Revit launches with the descriptor env var: same loader, different verdict.",
  },
  {
    key: "hot",
    title: "you save a .cs file",
    actor: "emitter",
    cmd: "(automatic — 100 ms poll)",
    caption:
      "No shared files touched. The emitter compiles your edit into a delta and POSTs it to the loader's loopback endpoint; ApplyUpdate patches the loaded module in place. Method-body edits only — structural edits need a restart.",
  },
  {
    key: "drift",
    title: "sdk moves to beta.96",
    actor: "you (git pull)",
    cmd: "git pull … loader source changed",
    caption:
      "Your builds now stamp loader DDB756… instead of 1A21DA… (new SDK pin here — a dev signature alone does the same). Read the atlas: NOTHING else changed. Drift is latent until a deploy meets an occupied slot.",
  },
  {
    key: "sbx24",
    title: "sandbox → 2024",
    actor: "sdk cli",
    cmd: "pe sandbox start --project Pe.App --year 2024 --id fam-lab",
    caption:
      "Materialize an immutable generation → 2024's slot is empty, so the CLI deploys the selector → launch Revit with the env var pointing into the generation. That env var IS the sandbox's isolation — there is no second Addins folder.",
  },
  {
    key: "sbx25",
    title: "sandbox → 2025: REFUSED",
    actor: "sdk cli",
    cmd: "pe sandbox start --project Pe.App --year 2025",
    refusal:
      "SelectorUnavailable — receipt-owned priority selector 2025\\00-Pe.App.addin (→ 1A21DA…) differs from this source candidate (→ DDB756…); refused to overwrite it.",
    caption:
      "The generation built fine — the refusal is at the Addins door: staged selector ≠ deployed selector, and the deployed one is receipt-owned. Overwriting would repoint the USER's Revit. Not a lock — killing Revits changes nothing. The real trap: if the difference is a dev signature (as diagnosed here 2026-07-16 — code was identical), releasing can NEVER fix it: dists ship unsigned, dev builds sign.",
  },
  {
    key: "stop",
    title: "sandbox stop",
    actor: "sdk cli",
    cmd: "pe sandbox stop --id fam-lab",
    caption:
      "Verify identity tuple → arm no-save (dirty docs discarded) → close gracefully. What persists: state.json, every generation, the 2024 selector. The process was the only ephemeral thing — stop never un-deploys.",
  },
  {
    key: "release",
    title: "release 0.7.0 ships",
    actor: "installer",
    cmd: "pe release --build … && pe install apply",
    caption:
      "New loader lands BESIDE the old; selector flips; current.txt flips last; old pruned. Install and checkout now agree — a 2025 sandbox would hit reuse. The running Revit keeps 0.6.14 until restart: pointers are read once, at boot.",
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
      {f.content ? (
        <div
          className="mt-1.5 px-2 py-1.5"
          style={{ background: "var(--paper-3)", borderRadius: 1, overflowX: "auto" }}
        >
          {f.content(step).map((line, i) => (
            <div
              key={i}
              className="font-[var(--font-pe-mono)]"
              style={{
                fontSize: 9.5,
                lineHeight: "1.6",
                whiteSpace: "pre",
                color: "var(--foreground)",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}
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

// ── the world composer ──────────────────────────────────────────────────────────────────────────
// The intuition machine: assemble any machine state (a user Revit, several rrds, several
// sandboxes, two years, drift, a release) and the picture re-derives selectors, loader eras,
// and refusals from the same rules the SDK enforces. Presets load states; the live tab feeds
// the identical picture from useTarget/useWorldLog.

const ERA = {
  old: { hash: "1A21DA…", color: "var(--cat-kiln)" },
  new: { hash: "DDB756…", color: "var(--pe-blue)" },
} as const;
type EraKey = keyof typeof ERA;

interface WorldState {
  user: boolean; // the user's installed Revit 2025
  rrd24: boolean;
  rrd25: boolean;
  sb24: number; // source sandboxes per year
  sb25: number;
  sbInst: number; // installed-payload sandboxes (2025)
  drift: boolean; // checkout builds a NEWER loader than the install owns
  released: boolean; // install apply ran with the new loader — receipt realigned
}

interface WorldProc {
  id: string;
  lane: SessionLane;
  year: "2024" | "2025";
  title: string;
  payloadHome: "product" | "checkout" | "generation";
  era: EraKey;
  refused: boolean;
  live?: SessionFacts;
}

/** The whole teaching model in one derivation. Rules mirror the SDK:
 *  - the install receipt owns the 2025 selector; its era is the installed loader's;
 *  - 2024 has no receipt owner — the first descriptor deploy fills it from the checkout;
 *  - a SOURCE deploy is refused when its staged selector differs from an occupied slot;
 *  - installed-payload sandboxes stage the receipt's own selector — identical, always reused.
 *  ponytail: declarative eras (no deploy ordering) — enough for every scripted incident. */
function deriveWorld(w: WorldState): {
  procs: WorldProc[];
  selectors: { year: "2024" | "2025"; era: EraKey | null; owner: string }[];
  refusals: string[];
} {
  const installedEra: EraKey = w.released ? "new" : "old";
  const checkoutEra: EraKey = w.drift || w.released ? "new" : "old";
  const sel25 = { year: "2025" as const, era: installedEra, owner: "install receipt 0.6.x" };
  const any24 = w.rrd24 || w.sb24 > 0;
  const sel24 = {
    year: "2024" as const,
    era: any24 ? checkoutEra : null,
    owner: any24 ? "sandbox/rrd deploy (free slot)" : "(empty slot)",
  };
  const selEra = (year: "2024" | "2025") => (year === "2024" ? sel24.era : sel25.era);

  const procs: WorldProc[] = [];
  if (w.user)
    procs.push({
      id: "user",
      lane: "installed",
      year: "2025",
      title: "user's revit",
      payloadHome: "product",
      era: installedEra,
      refused: false,
    });
  for (const year of ["2024", "2025"] as const) {
    if (year === "2024" ? w.rrd24 : w.rrd25)
      procs.push({
        id: `rrd${year}`,
        lane: "rrd",
        year,
        title: `rrd debug ${year}`,
        payloadHome: "checkout",
        era: checkoutEra,
        refused: selEra(year) !== null && selEra(year) !== checkoutEra,
      });
    const n = year === "2024" ? w.sb24 : w.sb25;
    for (let i = 0; i < n; i += 1)
      procs.push({
        id: `sb${year}-${i}`,
        lane: "sandbox",
        year,
        title: `sandbox:${year === "2024" ? "fam" : "lab"}-${i + 1}`,
        payloadHome: "generation",
        era: checkoutEra,
        refused: selEra(year) !== null && selEra(year) !== checkoutEra,
      });
  }
  for (let i = 0; i < w.sbInst; i += 1)
    procs.push({
      id: `sbi-${i}`,
      lane: "sandbox",
      year: "2025",
      title: `sandbox:inst-${i + 1} (installed payload)`,
      payloadHome: "product",
      era: installedEra,
      refused: false, // stages the receipt's own selector — byte-identical, reused
    });

  const refusals = procs
    .filter((p) => p.refused)
    .map(
      (p) =>
        `${p.title}: staged selector (→ ${ERA[p.era].hash}) differs from the ${p.year} slot (→ ${
          ERA[selEra(p.year) as EraKey].hash
        }, ${p.year === "2025" ? "receipt-owned" : "deployed"}) — refused to overwrite.`,
    );
  return { procs, selectors: [sel24, sel25], refusals };
}

const WORLD_PRESETS: { key: string; label: string; caption: string; state: WorldState }[] = [
  {
    key: "fresh",
    label: "fresh install",
    caption: "One user Revit. Selector, loader, current.txt — everything agrees.",
    state: {
      user: true,
      rrd24: false,
      rrd25: false,
      sb24: 0,
      sb25: 0,
      sbInst: 0,
      drift: false,
      released: false,
    },
  },
  {
    key: "dev",
    label: "dev day",
    caption: "User Revit + an rrd from the checkout. Two lanes, one selector, zero contention.",
    state: {
      user: true,
      rrd24: false,
      rrd25: true,
      sb24: 0,
      sb25: 0,
      sbInst: 0,
      drift: false,
      released: false,
    },
  },
  {
    key: "drift",
    label: "loader drift",
    caption: "git pull changed the loader source. Nothing on disk moved — the drift is latent.",
    state: {
      user: true,
      rrd24: false,
      rrd25: true,
      sb24: 0,
      sb25: 0,
      sbInst: 0,
      drift: true,
      released: false,
    },
  },
  {
    key: "refusal",
    label: "the refusal",
    caption:
      "Drift meets an occupied slot: the 2025 sandbox is refused at the door; 2024 (free slot) deploys fine.",
    state: {
      user: true,
      rrd24: false,
      rrd25: false,
      sb24: 1,
      sb25: 1,
      sbInst: 0,
      drift: true,
      released: false,
    },
  },
  {
    key: "workaround",
    label: "the workaround",
    caption:
      "An installed-payload sandbox stages the receipt's OWN selector — identical, reused, immune to drift.",
    state: {
      user: true,
      rrd24: false,
      rrd25: false,
      sb24: 0,
      sb25: 1,
      sbInst: 1,
      drift: true,
      released: false,
    },
  },
  {
    key: "release",
    label: "release closes it",
    caption:
      "install apply realigns the receipt with the checkout. Same sandbox, same command — now reuse-if-identical.",
    state: {
      user: true,
      rrd24: false,
      rrd25: false,
      sb24: 0,
      sb25: 1,
      sbInst: 0,
      drift: true,
      released: true,
    },
  },
  {
    key: "busy",
    label: "the busy machine",
    caption:
      "Everything at once: a user Revit, two rrds, three sandboxes, two years, mid-drift. Trace any wire.",
    state: {
      user: true,
      rrd24: true,
      rrd25: true,
      sb24: 2,
      sb25: 1,
      sbInst: 0,
      drift: true,
      released: false,
    },
  },
];

const HOME_META = {
  product: { title: "installed product", sub: "current.txt → versions\\<v>\\<year>" },
  checkout: { title: "your checkout", sub: "bin\\… + runtime.json (EnC-patchable)" },
  generation: { title: "sandbox generations", sub: "sdk\\sandboxes\\<id>\\generations\\<ts>" },
} as const;

/** BigPicture generalized: N processes, per-year selectors, one loader node per era in use. */
function WorldPicture({
  procs,
  selectors,
  onPick,
  picked,
}: {
  procs: WorldProc[];
  selectors: { year: "2024" | "2025"; era: EraKey | null; owner: string }[];
  onPick: (id: string | null) => void;
  picked: string | null;
}) {
  const COL_W = 148;
  const W = Math.max(760, procs.length * COL_W + 40);
  const H = 470;
  const px = (i: number) => 20 + i * COL_W;
  const pc = (i: number) => px(i) + (COL_W - 8) / 2;

  const activeSelectors = selectors.filter(
    (s) => s.era !== null || procs.some((p) => p.year === s.year),
  );
  const selX = (year: string) => {
    if (activeSelectors.length > 1) {
      // Two years in play: pin the selector nodes apart so they never stack.
      const idx = activeSelectors.findIndex((s) => s.year === year);
      return W / 2 - 280 + idx * 300;
    }
    const cols = procs.map((p, i) => (p.year === year ? pc(i) : null)).filter((v) => v != null);
    const mid = cols.length ? cols.reduce((a, b) => a + b, 0) / cols.length : W / 2;
    return Math.min(Math.max(mid - 130, 12), W - 272);
  };
  const erasInUse = [...new Set(procs.filter((p) => !p.refused).map((p) => p.era))] as EraKey[];
  const loaderX = (era: EraKey) =>
    erasInUse.length === 1 ? W / 2 - 130 : W / 2 - 280 + erasInUse.indexOf(era) * 300;
  const homes = Object.keys(HOME_META) as (keyof typeof HOME_META)[];
  const homeX = (h: string) => W / 2 - 390 + homes.indexOf(h as keyof typeof HOME_META) * 270;

  const dim = (id: string) => (picked !== null && picked !== id ? 0.22 : 1);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{ display: "block", fontFamily: "var(--font-pe-mono)" }}>
        {/* wires */}
        {procs.map((p, i) => {
          const sx = selX(p.year) + 130;
          const color = p.refused ? "var(--cat-clay)" : laneVar(p.lane);
          return (
            <g key={`w-${p.id}`} opacity={dim(p.id)}>
              <path
                d={`M ${pc(i)} 66 C ${pc(i)} 100, ${sx} 110, ${sx} ${p.refused ? 120 : 136}`}
                fill="none"
                stroke={picked === p.id ? color : p.refused ? "var(--cat-clay)" : "var(--line-2)"}
                strokeWidth={picked === p.id ? 1.8 : 1.1}
                strokeDasharray={p.lane === "installed" ? undefined : "5 3"}
              />
              {p.refused && (
                <text x={sx} y={132} textAnchor="middle" fontSize={11} fill="var(--cat-clay)">
                  ✕
                </text>
              )}
              {!p.refused && (
                <path
                  d={`M ${loaderX(p.era) + 130} 258 C ${loaderX(p.era) + 130} 300, ${
                    homeX(p.payloadHome) + 125
                  } 320, ${homeX(p.payloadHome) + 125} 344`}
                  fill="none"
                  stroke={picked === p.id ? color : "var(--line-2)"}
                  strokeWidth={picked === p.id ? 1.8 : 0.9}
                  strokeDasharray={p.lane === "installed" ? undefined : "5 3"}
                />
              )}
            </g>
          );
        })}
        {/* selector → loader wires */}
        {activeSelectors.map(
          (s) =>
            s.era && (
              <line
                key={`sl-${s.year}`}
                x1={selX(s.year) + 130}
                y1={182}
                x2={loaderX(s.era) + 130}
                y2={214}
                stroke={ERA[s.era].color}
                strokeWidth={1.1}
                opacity={0.6}
              />
            ),
        )}

        {/* process boxes */}
        {procs.map((p, i) => (
          <g
            key={p.id}
            opacity={dim(p.id)}
            style={{ cursor: "pointer" }}
            onClick={() => onPick(picked === p.id ? null : p.id)}
          >
            <rect
              x={px(i)}
              y={8}
              width={COL_W - 8}
              height={58}
              rx={2}
              fill="var(--card)"
              stroke={
                p.refused ? "var(--cat-clay)" : picked === p.id ? laneVar(p.lane) : "var(--line)"
              }
              strokeWidth={picked === p.id || p.refused ? 1.2 : 0.6}
              strokeDasharray={p.refused ? "4 3" : undefined}
            />
            <circle cx={px(i) + 11} cy={22} r={3} fill={laneVar(p.lane)} />
            <text x={px(i) + 19} y={25} fontSize={9} fontWeight={600} fill="var(--foreground)">
              {p.title}
            </text>
            <text x={px(i) + 10} y={41} fontSize={8} fill="var(--muted-foreground)">
              revit {p.year}
              {p.live ? ` · pid ${p.live.processId}` : ""}
            </text>
            <text
              x={px(i) + 10}
              y={56}
              fontSize={8}
              fill={p.refused ? "var(--cat-clay)" : ERA[p.era].color}
            >
              {p.refused ? "REFUSED at the door" : `wants loader ${ERA[p.era].hash}`}
            </text>
          </g>
        ))}

        {/* selector nodes (one per year in play) */}
        {activeSelectors.map((s) => (
          <g key={s.year}>
            <rect
              x={selX(s.year)}
              y={136}
              width={260}
              height={46}
              rx={2}
              fill="var(--paper-3)"
              stroke={s.era ? ERA[s.era].color : "var(--line)"}
              strokeWidth={0.8}
            />
            <text
              x={selX(s.year) + 130}
              y={153}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill="var(--foreground)"
            >
              Addins\{s.year}\00-Pe.App.addin {s.era ? `→ ${ERA[s.era].hash}` : "(empty)"}
            </text>
            <text
              x={selX(s.year) + 130}
              y={170}
              textAnchor="middle"
              fontSize={8}
              fill="var(--muted-foreground)"
            >
              {s.owner}
            </text>
          </g>
        ))}

        {/* loader nodes — one per era in use */}
        {erasInUse.map((era) => (
          <g key={era}>
            <rect
              x={loaderX(era)}
              y={214}
              width={260}
              height={44}
              rx={2}
              fill="var(--card)"
              stroke={ERA[era].color}
              strokeWidth={0.8}
            />
            <text
              x={loaderX(era) + 130}
              y={231}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill={ERA[era].color}
            >
              Pe.Revit.Loader.{ERA[era].hash}.dll
            </text>
            <text
              x={loaderX(era) + 130}
              y={247}
              textAnchor="middle"
              fontSize={8}
              fill="var(--muted-foreground)"
            >
              one question: is PE_REVIT_SESSION_DESCRIPTOR set?
            </text>
          </g>
        ))}

        {/* payload homes */}
        {homes.map((h) => {
          const used = procs.some((p) => !p.refused && p.payloadHome === h);
          return (
            <g key={h} opacity={used ? 1 : 0.3}>
              <rect
                x={homeX(h)}
                y={344}
                width={250}
                height={52}
                rx={2}
                fill="var(--card)"
                stroke="var(--line)"
                strokeWidth={0.6}
              />
              <text
                x={homeX(h) + 12}
                y={363}
                fontSize={9}
                fontWeight={600}
                fill="var(--foreground)"
              >
                {HOME_META[h].title}
              </text>
              <text x={homeX(h) + 12} y={380} fontSize={8} fill="var(--muted-foreground)">
                {HOME_META[h].sub}
              </text>
            </g>
          );
        })}

        <text x={20} y={H - 40} fontSize={8.5} fill="var(--muted-foreground)">
          dashed = descriptor-launched · solid = the descriptor-less default · clay ✕ =
          SelectorUnavailable
        </text>
        <text x={20} y={H - 26} fontSize={8.5} fill="var(--muted-foreground)">
          hash-named loaders never fight — the only contended byte is each year's one 00- selector.
        </text>
      </svg>
    </div>
  );
}

function Chip({
  on,
  color,
  label,
  onClick,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="tele px-2 py-0.5"
      style={{
        fontSize: 10.5,
        borderRadius: 2,
        border: on ? `1px solid ${color}` : "1px solid var(--line)",
        color: on ? color : "var(--muted-foreground)",
        background: on ? `color-mix(in srgb, ${color} 7%, transparent)` : "transparent",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Counter({
  value,
  color,
  label,
  onChange,
}: {
  value: number;
  color: string;
  label: string;
  onChange: (n: number) => void;
}) {
  return (
    <span
      className="tele inline-flex items-center gap-1 px-1.5 py-0.5"
      style={{
        fontSize: 10.5,
        borderRadius: 2,
        border: value > 0 ? `1px solid ${color}` : "1px solid var(--line)",
        color: value > 0 ? color : "var(--muted-foreground)",
        background: value > 0 ? `color-mix(in srgb, ${color} 7%, transparent)` : "transparent",
      }}
    >
      <button onClick={() => onChange(Math.max(0, value - 1))} style={{ cursor: "pointer" }}>
        −
      </button>
      {label} ×{value}
      <button onClick={() => onChange(Math.min(3, value + 1))} style={{ cursor: "pointer" }}>
        +
      </button>
    </span>
  );
}

const LIVE_HOME: Record<string, WorldProc["payloadHome"]> = {
  installed: "product",
  rrd: "checkout",
  sandbox: "generation",
  unknown: "product",
};

function WorldComposer() {
  const [tab, setTab] = useState<"compose" | "live">("compose");
  const [state, setState] = useState<WorldState>(WORLD_PRESETS[3].state);
  const [preset, setPreset] = useState<string | null>("refusal");
  const [picked, setPicked] = useState<string | null>(null);
  const { sessions } = useTarget("");
  const worldLog = useWorldLog(sessions);

  const composed = useMemo(() => deriveWorld(state), [state]);
  const live = useMemo(
    () => ({
      procs: sessions.map((s, i) => ({
        id: s.sessionId,
        lane: s.lane,
        // The broker doesn't report the Revit year yet (see ledger) — drawn as 2025, honestly labeled.
        year: "2025" as const,
        title: s.sandboxId
          ? `sandbox:${s.sandboxId}`
          : (s.activeDocumentTitle ?? `session ${i + 1}`),
        payloadHome: LIVE_HOME[s.lane] ?? ("product" as const),
        era: "new" as const,
        refused: false,
        live: s,
      })),
      selectors: [{ year: "2025" as const, era: "new" as const, owner: "your real Addins folder" }],
      refusals: [] as string[],
    }),
    [sessions],
  );

  const world = tab === "live" ? live : composed;
  const set = (patch: Partial<WorldState>) => {
    setState((s) => ({ ...s, ...patch }));
    setPreset(null);
  };
  const activePreset = WORLD_PRESETS.find((p) => p.key === preset);

  return (
    <div>
      {/* tabs + presets */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["compose", "live"] as const).map((t) => (
          <Chip
            key={t}
            on={tab === t}
            color="var(--pe-blue)"
            label={
              t === "compose" ? "compose a machine" : `live — this machine (${sessions.length})`
            }
            onClick={() => setTab(t)}
          />
        ))}
        <span className="mx-1 h-4 w-px" style={{ background: "var(--line-2)" }} />
        {tab === "compose" &&
          WORLD_PRESETS.map((p) => (
            <Chip
              key={p.key}
              on={preset === p.key}
              color={p.key === "refusal" ? "var(--cat-clay)" : "var(--cat-green)"}
              label={p.label}
              onClick={() => {
                setState(p.state);
                setPreset(p.key);
                setPicked(null);
              }}
            />
          ))}
      </div>

      {/* composer controls */}
      {tab === "compose" && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Chip
            on={state.user}
            color={laneVar("installed")}
            label="user revit 2025"
            onClick={() => set({ user: !state.user })}
          />
          <Chip
            on={state.rrd24}
            color={laneVar("rrd")}
            label="rrd 2024"
            onClick={() => set({ rrd24: !state.rrd24 })}
          />
          <Chip
            on={state.rrd25}
            color={laneVar("rrd")}
            label="rrd 2025"
            onClick={() => set({ rrd25: !state.rrd25 })}
          />
          <Counter
            value={state.sb24}
            color={laneVar("sandbox")}
            label="sandbox 2024"
            onChange={(n) => set({ sb24: n })}
          />
          <Counter
            value={state.sb25}
            color={laneVar("sandbox")}
            label="sandbox 2025"
            onChange={(n) => set({ sb25: n })}
          />
          <Counter
            value={state.sbInst}
            color={laneVar("sandbox")}
            label="sandbox (installed payload)"
            onChange={(n) => set({ sbInst: n })}
          />
          <span className="mx-1 h-4 w-px" style={{ background: "var(--line-2)" }} />
          <Chip
            on={state.drift}
            color="var(--cat-kiln)"
            label="loader drift (checkout ahead)"
            onClick={() => set({ drift: !state.drift })}
          />
          <Chip
            on={state.released}
            color="var(--cat-green)"
            label="release + install apply"
            onClick={() => set({ released: !state.released })}
          />
        </div>
      )}

      {/* caption / refusals */}
      {tab === "compose" && activePreset && (
        <p className="mb-1 max-w-[90ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          {activePreset.caption}
        </p>
      )}
      {world.refusals.map((r) => (
        <div
          key={r}
          className="mb-1 px-3 py-1.5 font-[var(--font-pe-mono)]"
          style={{
            fontSize: 10,
            color: "var(--foreground)",
            border: "1px solid var(--cat-clay)",
            background: "color-mix(in srgb, var(--cat-clay) 5%, var(--card))",
            borderRadius: 2,
          }}
        >
          <span style={{ color: "var(--cat-clay)" }}>SelectorUnavailable · </span>
          {r}
        </div>
      ))}
      {tab === "live" && sessions.length === 0 && (
        <div
          className="mb-1 px-3 py-2 font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, color: "var(--muted-foreground)" }}
        >
          NO SESSIONS — attach a Revit (or start a sandbox) and this picture fills in live.
        </div>
      )}

      <WorldPicture
        procs={world.procs}
        selectors={world.selectors}
        picked={picked}
        onPick={setPicked}
      />

      {/* live extras: the session strip + world-event ticks */}
      {tab === "live" && (
        <div className="mt-2">
          <LiveWorld />
          {worldLog.length > 0 && (
            <div
              className="mt-1 px-3 py-1.5"
              style={{
                border: "0.5px solid var(--line)",
                background: "var(--card)",
                borderRadius: 2,
              }}
            >
              {worldLog.slice(-6).map((e) => (
                <div
                  key={`${e.atMs}-${e.sessionId}-${e.kind}`}
                  className="font-[var(--font-pe-mono)]"
                  style={{ fontSize: 9, color: "var(--muted-foreground)", lineHeight: "1.7" }}
                >
                  {ageLabel(e.atMs, Date.now())} · {e.kind} · {e.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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

// ── the nouns — every abstract term is a real file ──────────────────────────────────────────────
// Paths and contents below are transcribed from a real machine (2026-07-16), abridged. Click a
// noun to light up what it points at; the whole page is these files changing.

interface Noun {
  id: string;
  term: string;
  path: string;
  content: string[];
  blurb: string;
  relates: { to: string; how: string }[];
}

const NOUNS: Noun[] = [
  {
    id: "selector",
    term: "selector",
    path: "%APPDATA%\\Autodesk\\Revit\\Addins\\2025\\00-Pe.App.addin",
    content: [
      '<AddIn Type="Application">',
      "  <Assembly>Pe.App\\Pe.Revit.Loader.1A21DA30….dll</Assembly>",
      "  <FullClassName>Pe.Revit.Loader.LoaderApplication</FullClassName>",
      "  <AddInId>43B12CEC-8FCF-4E33-…</AddInId>",
    ],
    blurb:
      "The one file Revit reads for a product+year (00- sorts first). Its whole job is one line: name one loader by hash.",
    relates: [
      { to: "loader", how: "names exactly one loader dll, by content hash" },
      {
        to: "receipt",
        how: "when the installer wrote it, the receipt owns it — sandboxes then refuse to overwrite",
      },
    ],
  },
  {
    id: "loader",
    term: "loader (bootstrap)",
    path: "…\\Addins\\2025\\Pe.App\\Pe.Revit.Loader.<sha256>.dll",
    content: [
      "MZ… (6-8 KB of IL: forward OnStartup → contract)",
      "± Authenticode block: CN=Pe.Revit.Sdk Dev Code Signing",
      "filename hex = SHA-256 of ALL bytes above (sig included)",
    ],
    blurb:
      "The tiny dll Revit actually loads. Ships pre-built in the SDK package; every build re-stamps it (rename · maybe sign · hash).",
    relates: [
      { to: "contract", how: "forwards straight to the fixed-name contract" },
      { to: "selector", how: "reachable only if a selector names its hash" },
    ],
  },
  {
    id: "contract",
    term: "loader (contract)",
    path: "…\\Addins\\2025\\Pe.App\\Pe.Revit.Loader.dll",
    content: [
      "the real logic, fixed name, shared ABI:",
      "  env PE_REVIT_SESSION_DESCRIPTOR set? → read descriptor",
      "  else → read current.txt once → load installed payload",
    ],
    blurb: "Where the lane decision actually happens. Byte-identical across lanes.",
    relates: [
      { to: "descriptor", how: "reads + validates it when the env var is set" },
      { to: "current", how: "falls through to it when the env var is absent" },
      { to: "loaderjson", how: "reads it to find the installed payload root" },
    ],
  },
  {
    id: "loaderjson",
    term: "loader.json",
    path: "…\\Addins\\2025\\Pe.App\\loader.json",
    content: [
      '{ "schemaVersion": 2,',
      '  "payloadRoot": "…\\\\Positive Energy\\\\Pe.Tools\\\\addin",',
      '  "assembly": "Pe.App", "entryType": "Pe.App.AppCore" }',
    ],
    blurb: "Three fields: where the installed payload lives and what to instantiate.",
    relates: [{ to: "payload", how: "points at the versions root the payload lives under" }],
  },
  {
    id: "current",
    term: "current.txt",
    path: "%LOCALAPPDATA%\\Positive Energy\\Pe.Tools\\current.txt",
    content: ["0.6.15"],
    blurb:
      "One line. The install's commit point — written last, read once per Revit start. Flip it and the next boot is the new version.",
    relates: [
      { to: "payload", how: "selects versions\\0.6.15\\<year> as the live payload" },
      { to: "receipt", how: "written only after the receipt — crash-safety ordering" },
    ],
  },
  {
    id: "payload",
    term: "payload",
    path: "…\\Pe.Tools\\addin\\versions\\0.6.15\\2025\\Pe.App.dll (+ deps)",
    content: ["the actual product — ribbon, commands, bridge"],
    blurb:
      "What you think of as Pe.App. Everything else on this page exists to pick which copy of this loads.",
    relates: [{ to: "descriptor", how: "dev/sandbox payloads carry their descriptor beside them" }],
  },
  {
    id: "receipt",
    term: "receipt",
    path: "…\\Pe.Tools\\install.receipt.json",
    content: [
      '{ "releaseVersion": "0.6.15",',
      '  "files": [ { "path": "…00-Pe.App.addin", "sha256": "…" }, ×5906 ] }',
    ],
    blurb:
      "sha256 inventory of every file the install owns. “Receipt-owned” = sandboxes must not touch.",
    relates: [{ to: "selector", how: "listing the selector is what arms the refusal" }],
  },
  {
    id: "descriptor",
    term: "descriptor",
    path: "<payload dir>\\Pe.App.runtime.json  (named by PE_REVIT_SESSION_DESCRIPTOR)",
    content: [
      '{ "lane": "sandbox", "sandboxId": "pe.app-25",',
      '  "payloadSource": "source", "path": "…generations\\\\<ts>\\\\payload" }',
    ],
    blurb:
      "An immutable launch receipt. Its presence (via one env var) is the entire difference between lanes.",
    relates: [
      { to: "generation", how: "sandbox descriptors live inside, and point at, a generation" },
      { to: "contract", how: "read once at boot; never re-read, never edited" },
    ],
  },
  {
    id: "generation",
    term: "generation",
    path: "%LOCALAPPDATA%\\Pe.Revit.Sdk\\sandboxes\\pe.app-25\\generations\\20260716212558641\\",
    content: [
      "payload\\   (frozen build + descriptor)",
      "selector\\  (staged, byte-compared at deploy)",
      "bin\\ obj\\  (build scratch)",
    ],
    blurb:
      "One immutable folder per sandbox start, built from a checkout. Never mutated; survives stop.",
    relates: [
      { to: "descriptor", how: "contains the descriptor the process is launched with" },
      {
        to: "selector",
        how: "its staged selector must byte-match the deployed one, or deploy into an empty year",
      },
    ],
  },
  {
    id: "state",
    term: "state.json",
    path: "…\\Pe.Revit.Sdk\\sandboxes\\pe.app-25\\state.json",
    content: [
      '{ "pid": 9204, "processStartUtcTicks": …,',
      '  "revitExecutable": "…Revit.exe", "generation": "20260716…" }',
    ],
    blurb:
      "The sandbox registry entry. Stop verifies this identity tuple before touching anything.",
    relates: [{ to: "generation", how: "records which generation the live process runs" }],
  },
  {
    id: "devsign",
    term: "dev-sign.props",
    path: "%LOCALAPPDATA%\\Pe.Revit.Sdk\\dev-sign.props",
    content: [
      "<PeDevSignSubject>CN=Pe.Revit.Sdk Dev Code Signing</…>",
      "<PeCodeSignThumbprint>DBE820C8…</…>",
    ],
    blurb:
      "Exists only on dev machines (pe-revit dev-sign init). Silently signs every dev-built loader — which changes its hash.",
    relates: [
      {
        to: "loader",
        how: "adds the Authenticode block → a different sha256 → a “different” loader",
      },
      {
        to: "selector",
        how: "the root cause of refuse-if-differing against an unsigned installed selector",
      },
    ],
  },
];

function Nouns() {
  const [sel, setSel] = useState<string | null>(null);
  const selected = NOUNS.find((n) => n.id === sel);
  const relatedIds = new Set(selected?.relates.map((r) => r.to) ?? []);
  return (
    <div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {NOUNS.map((n) => {
          const isSel = sel === n.id;
          const isRel = relatedIds.has(n.id);
          return (
            <button
              key={n.id}
              onClick={() => setSel(isSel ? null : n.id)}
              className="text-left"
              style={{
                border: isSel
                  ? "1px solid var(--pe-blue)"
                  : isRel
                    ? "1px solid color-mix(in srgb, var(--pe-blue) 45%, transparent)"
                    : "0.5px solid var(--line)",
                background: "var(--card)",
                borderRadius: 2,
                cursor: "pointer",
                opacity: sel !== null && !isSel && !isRel ? 0.45 : 1,
                transition: "opacity .12s ease, border-color .12s ease",
              }}
            >
              <div
                className="flex items-baseline justify-between gap-2 px-2 py-1"
                style={{ borderBottom: "0.5px solid var(--line-soft)" }}
              >
                <span className="text-[11.5px] font-semibold" style={{ color: "var(--pe-blue)" }}>
                  {n.term}
                </span>
              </div>
              <div
                className="truncate px-2 pt-1 font-[var(--font-pe-mono)]"
                style={{ fontSize: 8, color: "var(--muted-foreground)" }}
                title={n.path}
              >
                {n.path}
              </div>
              <div
                className="mx-2 my-1 px-1.5 py-1"
                style={{ background: "var(--paper-3)", borderRadius: 1, overflowX: "hidden" }}
              >
                {n.content.map((line, i) => (
                  <div
                    key={i}
                    className="truncate font-[var(--font-pe-mono)]"
                    style={{ fontSize: 8.5, lineHeight: "1.5", color: "var(--foreground)" }}
                  >
                    {line}
                  </div>
                ))}
              </div>
              <p
                className="m-0 px-2 pb-1.5 text-[10.5px] leading-snug"
                style={{ color: "var(--muted-foreground)" }}
              >
                {n.blurb}
              </p>
            </button>
          );
        })}
      </div>
      <div
        className="mt-1.5 px-3 py-1.5"
        style={{
          border: "0.5px solid var(--line)",
          background: "var(--paper-3)",
          borderRadius: 2,
          minHeight: 30,
        }}
      >
        {selected ? (
          selected.relates.map((r) => (
            <div key={r.to} className="py-0.5 text-[11px]" style={{ color: "var(--foreground)" }}>
              <span className="font-[var(--font-pe-mono)]" style={{ color: "var(--pe-blue)" }}>
                {selected.term} → {NOUNS.find((n) => n.id === r.to)?.term}
              </span>{" "}
              — {r.how}
            </div>
          ))
        ) : (
          <span className="text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
            click a noun — contents above are transcribed from this machine, abridged
          </span>
        )}
      </div>
    </div>
  );
}

// ── two worlds, one door — lanes, checkouts, and signing ────────────────────────────────────────
// The dev/user split drawn whole. Grounded: RRD is primary-checkout-only (SPEC.md:125); worktrees
// get concurrency via sandboxes (RUNTIME_ACCEPTANCE.md:99); release forces PeDevSignDisabled=true
// (Commands.cs:975); dev-sign.props sets PeCodeSignThumbprint so dev builds sign
// (Publish.targets:84-87); the sandbox lane WANTS signing to skip Revit's unsigned-addin dialog
// (SandboxCommand.cs:1171).

const SIGNING_ROWS: { who: string; stamp: string; hash: string; why: string }[] = [
  {
    who: "release / pack",
    stamp:
      "unsigned — PeDevSignDisabled=true is forced (real Authenticode cert only if PeCodeSignPfx/Thumbprint is configured)",
    hash: "1A21DA…",
    why: "ships clean to users; never inherits a machine-local cert",
  },
  {
    who: "dev build + dev-sign.props",
    stamp: "signed: CN=Pe.Revit.Sdk Dev Code Signing (dev-sign.props sets PeCodeSignThumbprint)",
    hash: "DDB756…",
    why: "sandboxes want a signed loader so Revit never shows the unsigned-addin dialog mid-automation",
  },
  {
    who: "dev build, no dev-sign.props",
    stamp: "unsigned — byte-identical to the release loader at the same SDK pin",
    hash: "1A21DA…",
    why: "the PeDevSignDisabled=true escape hatch (honored since beta.97) — rarely needed now that install apply dev-signs on dev machines",
  },
];

function TwoWorlds() {
  const mono = (size: number, color = "var(--muted-foreground)") =>
    ({ fontSize: size, color }) as const;
  const box = (accent?: string) =>
    ({
      border: accent ? `1px solid ${accent}` : "0.5px solid var(--line)",
      background: "var(--card)",
      borderRadius: 2,
    }) as const;
  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        {/* dev machine */}
        <div style={box()}>
          <div className="px-2.5 py-1.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
            <span className="text-[11.5px] font-semibold" style={{ color: "var(--foreground)" }}>
              your machine — many builders, one install
            </span>
          </div>
          <div className="grid gap-2 p-2.5">
            <div className="px-2 py-1.5" style={{ borderLeft: "2px solid var(--cat-green)" }}>
              <div className="font-[var(--font-pe-mono)]" style={mono(9.5, "var(--foreground)")}>
                primary checkout → RRD
              </div>
              <p className="m-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                The one checkout allowed to debug interactively (hot reload, debugger). RRD is
                primary-checkout-only, by rule.
              </p>
            </div>
            <div className="px-2 py-1.5" style={{ borderLeft: "2px solid var(--cat-green)" }}>
              <div className="font-[var(--font-pe-mono)]" style={mono(9.5, "var(--foreground)")}>
                worktree checkouts → sandboxes
              </div>
              <p className="m-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                This is the SDK's headline trick: every git worktree can build + launch its own
                sandboxed Revit, concurrently — each gets an immutable generation, its own pid, its
                own descriptor. Agents develop in parallel without touching your RRD.
              </p>
            </div>
            <div className="px-2 py-1.5" style={{ borderLeft: "2px solid var(--cat-slate)" }}>
              <div className="font-[var(--font-pe-mono)]" style={mono(9.5, "var(--foreground)")}>
                installed product (also here!)
              </div>
              <p className="m-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                You install releases too — so your machine is the only place where dist artifacts
                and source builds meet. Every collision on this page lives here.
              </p>
            </div>
            <div className="px-2 py-1.5" style={{ borderLeft: "2px solid var(--cat-kiln)" }}>
              <div className="font-[var(--font-pe-mono)]" style={mono(9.5, "var(--cat-kiln)")}>
                dev-sign.props — the invisible variable
              </div>
              <p className="m-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                Present → every loader you build is dev-signed (different bytes, different hash).
                Absent → your builds match dist exactly. Nothing else on the machine tells you which
                world you're in.
              </p>
            </div>
          </div>
        </div>

        {/* the door */}
        <div
          className="flex flex-col items-center justify-center gap-1 px-3 py-4"
          style={{ ...box("var(--pe-blue)"), minWidth: 150 }}
        >
          <span className="font-[var(--font-pe-mono)]" style={mono(9, "var(--pe-blue)")}>
            THE ONE DOOR
          </span>
          <span
            className="text-center font-[var(--font-pe-mono)]"
            style={mono(8.5, "var(--foreground)")}
          >
            Addins\&lt;year&gt;\
            <br />
            00-Pe.App.addin
          </span>
          <span className="text-center text-[9.5px]" style={{ color: "var(--muted-foreground)" }}>
            every lane passes through it; it checks loaders byte-for-byte — a signature is a
            different passport
          </span>
        </div>

        {/* user machine */}
        <div style={box()}>
          <div className="px-2.5 py-1.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
            <span className="text-[11.5px] font-semibold" style={{ color: "var(--foreground)" }}>
              a user's machine — one writer, one path
            </span>
          </div>
          <div className="grid gap-2 p-2.5">
            <div className="px-2 py-1.5" style={{ borderLeft: "2px solid var(--cat-slate)" }}>
              <div className="font-[var(--font-pe-mono)]" style={mono(9.5, "var(--foreground)")}>
                installer only
              </div>
              <p className="m-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                No checkouts, no builds, no SDK state dir, no dev-sign.props, no descriptor env var
                — those things don't exist here. The installer copies one pre-made loader + payload;
                done.
              </p>
            </div>
            <div className="px-2 py-1.5" style={{ borderLeft: "2px solid var(--cat-slate)" }}>
              <div className="font-[var(--font-pe-mono)]" style={mono(9.5, "var(--foreground)")}>
                every boot = the same path
              </div>
              <p className="m-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                selector → loader → no env var → current.txt → installed payload. The refusal
                machinery exists to protect THIS Revit from dev-lane writes; users never see it
                fire.
              </p>
            </div>
            <div className="px-2 py-1.5" style={{ borderLeft: "2px solid var(--cat-slate)" }}>
              <div className="font-[var(--font-pe-mono)]" style={mono(9.5, "var(--foreground)")}>
                signing, from here
              </div>
              <p className="m-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                The shipped loader is unsigned today (a real Authenticode cert slots in via
                PeCodeSignPfx/Thumbprint at release). Dev signatures never reach users.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* signing matrix */}
      <div className="mt-3" style={{ overflowX: "auto" }}>
        <table
          className="w-full border-collapse"
          style={{ border: "0.5px solid var(--line)", minWidth: 680 }}
        >
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--line)" }}>
              {["who builds the loader", "stamp inside the dll", "hash", "why"].map((h) => (
                <th
                  key={h}
                  className="px-3 py-1.5 text-left font-[var(--font-pe-mono)]"
                  style={{ fontSize: 9, letterSpacing: "0.06em", color: "var(--muted-foreground)" }}
                >
                  {h.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIGNING_ROWS.map((r) => (
              <tr key={r.who} style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                <td
                  className="px-3 py-1.5 font-[var(--font-pe-mono)]"
                  style={{ fontSize: 10, color: "var(--foreground)", whiteSpace: "nowrap" }}
                >
                  {r.who}
                </td>
                <td className="px-3 py-1.5 text-[10.5px]" style={{ color: "var(--foreground)" }}>
                  {r.stamp}
                </td>
                <td
                  className="px-3 py-1.5 font-[var(--font-pe-mono)]"
                  style={{ fontSize: 10, color: "var(--pe-blue)" }}
                >
                  {r.hash}
                </td>
                <td
                  className="px-3 py-1.5 text-[10.5px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {r.why}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 mt-1 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
          Same commit, three stamps, two hashes — and the door compares hashes. That table is the
          entire 2025 refusal. Cites: Commands.cs:975 · Publish.targets:58-98 ·
          SandboxCommand.cs:1171.
        </p>
      </div>
    </div>
  );
}

// ── misreadings — wrong models this page exists to replace ─────────────────────────────────────

const MISREADINGS: [string, string][] = [
  [
    "“the selector is some registry / config thing”",
    "it's a file: Addins\\<year>\\00-Pe.App.addin. That .addin manifest IS the selector.",
  ],
  [
    "“the loader is compiled from my checkout”",
    "it ships pre-built inside the pinned SDK package. Dev builds only re-stamp it: rename per product, dev-sign if dev-sign.props exists, hash.",
  ],
  [
    "“the hex in the filename encodes a signature”",
    "the signature lives INSIDE the dll (Authenticode block); the hex is the SHA-256 of the whole file, signature included — which is exactly why signing mints a “new” loader.",
  ],
  [
    "“a sandbox gets its own Addins folder”",
    "there is only one Addins. Isolation = the PE_REVIT_SESSION_DESCRIPTOR env var + the payload living in the generation folder. Per-process environment, not per-folder.",
  ],
  [
    "“user machines do some of this too”",
    "users never build, never sign, never see a descriptor. Installer copies one pre-made loader; every boot takes the current.txt path. The whole sandbox/signing story is dev-machine-only.",
  ],
  [
    "“closing Revit will release the refusal”",
    "the refusal is ownership + content (receipt vs bytes), not a file lock. Nothing running matters.",
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
    state: "truth",
    text: "The real 2025 refusal (2026-07-16) was dev-signing, not code drift — RESOLVED in SDK beta.97: install apply now dev-signs the deployed loader on machines with dev-sign.props (sign-at-install), refusals name their cause (identity / signature / bytes / routing, state selector-refused), and verify no longer loops on legacy-overlaps-payload. Residual pin-skew refusals are honest and fixed by rebuilding the dist + apply.",
  },
  {
    state: "open",
    text: "Selector identity should ignore signatures (hash the pre-signature image). Until then, every dev machine with an installed product + dev-sign.props re-hits this refusal, and releasing can't close it.",
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
              : that page is <em>which session gets the call</em>; this one is{" "}
              <em>how each kind of session comes to exist</em>. Three writers (installer, build,
              sandbox CLI), four places on disk, and Revit only ever reads. Claims cite Pe.Revit.Sdk
              source (beta.96).
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
              Revit loads one thing: a hash-named <strong>loader</strong> dll, named by the{" "}
              <strong>selector</strong> (the <code>00-Pe.App.addin</code> file). The loader asks one
              question — <em>is PE_REVIT_SESSION_DESCRIPTOR set?</em> Yes → that{" "}
              <strong>descriptor</strong> file picks the payload (rrd or sandbox). No →{" "}
              <strong>current.txt</strong>, once → installed. One env var is the entire difference
              between your Revit, your debug session, and every sandbox.
            </p>
          </div>
        </section>

        {/* ── the nouns ─────────────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="the nouns — every term is a real file" />
          <p className="mb-2 max-w-[80ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Nothing here is abstract. Each concept is one file (or folder) with a path and contents
            you can open right now. Click a noun to see what it points at — everything on this page
            is just these files changing.
          </p>
          <Nouns />
        </section>

        {/* ── misreadings ───────────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="not this — the wrong models, corrected" />
          <table className="w-full border-collapse" style={{ border: "0.5px solid var(--line)" }}>
            <tbody>
              {MISREADINGS.map(([wrong, right]) => (
                <tr key={wrong} style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                  <td
                    className="px-3 py-1.5 align-top text-[11px]"
                    style={{ color: "var(--cat-clay)", width: "34%" }}
                  >
                    {wrong}
                  </td>
                  <td
                    className="px-3 py-1.5 text-[11.5px] leading-snug"
                    style={{ color: "var(--foreground)" }}
                  >
                    {right}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── the shape ─────────────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="the shape — one of each lane" />
          <p className="mb-2 max-w-[76ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Every process funnels through <em>one</em> selector and <em>one</em> loader, then fans
            out on a single env var. Click anything to trace its lane.
          </p>
          <BigPicture />
        </section>

        {/* ── two worlds ────────────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="two worlds, one door — lanes, checkouts, signing" />
          <p className="mb-2 max-w-[80ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            The dev/user split, drawn whole. A user's machine has one writer and one boot path. Your
            machine has many builders — a primary checkout (RRD), any number of worktree checkouts
            (each spawning its own sandbox, concurrently), AND an installed release — all sharing
            one Addins door. Signing is the invisible variable that decides whether they agree.
          </p>
          <TwoWorlds />
        </section>

        {/* ── the world composer ────────────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionLabel label="the world composer — build a machine, watch the rules" />
          <p className="mb-2 max-w-[86ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Same picture, any number of processes, two years. Add rrds and sandboxes, toggle
            <em> drift</em> and <em>release</em>, and the selectors, loader eras, and refusals
            re-derive from the SDK's own rules. The <em>live</em> tab renders this machine's real
            sessions through the identical picture (the same <code>useTarget</code> the product
            uses).
          </p>
          <WorldComposer />
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
            The composer's <em>refusal</em> preset, as a real week on disk. Scrub the steps; ● was
            written this step, ✕ was pruned. Click any file for its lifecycle and citation.
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
          <details>
            <summary
              className="mb-1.5 cursor-pointer font-[var(--font-pe-mono)]"
              style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--foreground)" }}
            >
              LIFECYCLE REFERENCE — EVERY ARTIFACT, BIRTH TO DEATH
            </summary>
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
                      <td
                        className="px-3 py-1.5 text-[11px]"
                        style={{ color: "var(--foreground)" }}
                      >
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
          </details>
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
