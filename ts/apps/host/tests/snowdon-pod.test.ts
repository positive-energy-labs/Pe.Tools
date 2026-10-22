// P3 (plan WAVE3-PLAN §6): the shipped snowdon-ducts example is clean authored content and a real Pod.
// Deterministic lane: no Revit, no server. It proves packaging shape and content hygiene, never any finding about
// the sample model. The export/import round trip runs the production pod-transfer.ts, not a fixture zip writer.

import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { capturePackage, readPackage } from "../src/packages.ts";
import { exportPod, importPod, readZip } from "../src/pod-transfer.ts";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { listPods } from "../src/settings.ts";
import { bannedNames } from "./banned-names.ts";

const root = join(import.meta.dirname, "..", "..", "..", "..", "examples", "pods", "snowdon-ducts");

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(relative(root, path).replaceAll("\\", "/"));
  }
  return out.sort();
}

const text = async (path: string) => readFile(join(root, path), "utf8");

test("the Pod ships authored content only: no state, binding, output, build debris or model files", async () => {
  const all = await files(root);
  expect(all).toEqual(
    expect.arrayContaining([
      "AGENTS.md",
      "PeScripts.csproj",
      "README.md",
      "pages/tour/index.html",
      "pod.json",
      "settings/checks.json",
      "skills/duct-loss/SKILL.md",
      "src/Census.cs",
      "src/CoefficientExperiment.cs",
      "src/InspectRun.cs",
    ]),
  );
  const forbidden = all.filter((p) =>
    /(^|\/)(\.state|output|bin|obj|\.git)(\/|$)|binding\.json|imported\.json|\.(rvt|rfa|rte|rft|zip|png|jpe?g)$/i.test(
      p,
    ),
  );
  expect(forbidden).toEqual([]);
});

test("the manifest id is the identity and every entrypoint names an existing declared source", async () => {
  const pod = JSON.parse(await text("pod.json"));
  expect(pod.id).toBe("snowdon-ducts");
  expect(pod.schemaVersion).toBe(2);
  expect(pod.entrypoints.map((e: { sourcePath: string }) => e.sourcePath).sort()).toEqual([
    "src/Census.cs",
    "src/CoefficientExperiment.cs",
    "src/InspectRun.cs",
  ]);
  for (const e of pod.entrypoints) {
    const source = await text(e.sourcePath);
    // Exactly one non-abstract PeScriptContainer per entrypoint file.
    expect(source.match(/:\s*PeScriptContainer/g)).toHaveLength(1);
  }
  expect(await text("src/Probe.cs")).not.toContain("PeScriptContainer");
});

test("content carries no seed fingerprints, fixed model ids, recorded dates or client names", async () => {
  const banned = [
    ...(bannedNames() ? [bannedNames()!] : []),
    /kaitpw/i,
    /ducts-ground/i,
    /pdrop/i,
    /broan|suntherm|aprilaire|wine guardian/i,
    /\b(4571|4707|1235|9447852|6751193|12721309)\b/,
    /proven\[/i,
    /\b20(2[0-9])-\d\d-\d\d\b/,
  ];
  const hits: string[] = [];
  for (const path of await files(root)) {
    const body = await text(path);
    for (const pattern of banned) if (pattern.test(body)) hits.push(`${path}: ${pattern}`);
    // No hard-coded element ids: a long bare integer literal in a Page or source is a fixed model id.
    if (/\.(html|cs)$/.test(path) && /(?<![\w.])\d{6,}(?![\w.])/.test(body))
      hits.push(`${path}: literal id-like number`);
  }
  expect(hits).toEqual([]);
});

test("the Page invokes only the three canonical script keys and existing host operations", async () => {
  const page = await text("pages/tour/index.html");
  expect(page).toContain('script(KEYS.experiment, { permissionMode: "NoTransaction" })');
  expect(page).toContain("script(KEYS.census, {})");
  const keys = [...page.matchAll(/script:@snowdon-ducts\/[^"'\s]+/g)].map((m) => m[0]);
  expect(new Set(keys)).toEqual(
    new Set([
      "script:@snowdon-ducts/src/Census.cs",
      "script:@snowdon-ducts/src/InspectRun.cs",
      "script:@snowdon-ducts/src/CoefficientExperiment.cs",
    ]),
  );
  const ops = [...page.matchAll(/pe\.(?:do|read)\("(revit\.[a-z.-]+)"/g)].map((m) => m[1]);
  expect(new Set(ops)).toEqual(
    new Set(["revit.context.lens", "revit.context.show-elements", "revit.context.journal"]),
  );
});

// Runs the Page's own inline script against a fake DOM and a fake `pe` whose `do` answers exactly what pe.js answers
// for a script key: row.result, the whole ScriptExecutionResult { status, data, ... } (pe.js `pe.do`).
function runPage(html: string, scriptResult: (key: string) => unknown) {
  const source = /<script>\n([\s\S]*?)<\/script>/.exec(html.slice(html.indexOf("</style>")))![1]!;
  const els = new Map<string, Record<string, unknown>>();
  const el = (id: string) => {
    if (!els.has(id))
      els.set(id, { id, textContent: "", innerHTML: "", disabled: false, dataset: {} });
    return els.get(id)!;
  };
  const calls: string[] = [];
  const pe = {
    doc: null,
    kernel: (
      reduce: (s: unknown, e: unknown) => unknown,
      base: unknown,
      draw: (s: unknown) => void,
    ) => {
      const k = {
        state: base,
        fire: (e: unknown) => {
          k.state = reduce(k.state, e);
          draw(k.state);
        },
      };
      return k;
    },
    describe: () => {},
    state: async () => {},
    target: async () => {},
    do: async (key: string) => {
      calls.push(key);
      return scriptResult(key);
    },
    reading: async (source: string, run: () => Promise<unknown>) => ({
      source,
      at: Date.now(),
      rows: await run(),
    }),
  };
  runInNewContext(source, {
    document: { getElementById: el },
    pe,
    setInterval: () => 0,
    Date,
    JSON,
    Number,
    String,
  });
  return { el, calls };
}

test("the Page draws a real-shaped successful census without throwing, and surfaces a failed one", async () => {
  const html = await text("pages/tour/index.html");
  const census = {
    status: "Succeeded",
    artifacts: [],
    diagnostics: [],
    data: {
      document: "Snowdon copy",
      revitVersion: "2025",
      systemCount: 1,
      listed: 1,
      systems: [
        {
          id: 7,
          name: "Supply 1",
          type: "Supply",
          elementCount: 4,
          fittingCount: 2,
          baseEquipment: null,
        },
      ],
      ductWarnings: [],
    },
  };
  const ok = runPage(html, () => census);
  await (ok.el("census").onclick as () => Promise<void>)();
  expect(ok.el("status").textContent).toBe("");
  expect(ok.el("doc").textContent).toContain("Snowdon copy (Revit 2025)");
  expect(ok.el("systems").innerHTML).toContain("Supply 1");
  expect(ok.el("experiment").disabled).toBe(false);

  const experiment = {
    status: "Succeeded",
    data: {
      parameter: "Comments",
      examined: 3,
      writable: 3,
      changed: 3,
      alreadyCurrent: 0,
      applied: true,
      sample: [],
    },
  };
  const exp = runPage(html, (key) => (key.endsWith("Census.cs") ? census : experiment));
  await (exp.el("census").onclick as () => Promise<void>)();
  const press = exp.el("experiment").onclick as () => Promise<void>;
  await press(); // arms
  await press(); // runs
  expect(exp.el("status").textContent).toContain('"changed":3');

  const failed = runPage(html, () => ({ status: "CompilationFailed", diagnostics: [] }));
  await (failed.el("census").onclick as () => Promise<void>)();
  expect(failed.el("status").textContent).toContain("CompilationFailed");
});

test("the skill loads: frontmatter has a name and a description free of the gray-matter trap", async () => {
  const skill = await text("skills/duct-loss/SKILL.md");
  const front = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? "";
  expect(front).toMatch(/^name: duct-loss$/m);
  const description = /^description: (.*)$/m.exec(front)?.[1] ?? "";
  expect(description.length).toBeGreaterThan(20);
  expect(description).not.toContain(': "');
  for (const key of ["Census.cs", "InspectRun.cs", "CoefficientExperiment.cs"])
    expect(skill).toContain(`script:@snowdon-ducts/src/${key}`);
});

test("the checks member is JSON naming a schema that ships beside it", async () => {
  const checks = JSON.parse(await text("settings/checks.json"));
  expect(checks.$schema).toBe("./checks.schema.json");
  const schema = JSON.parse(await text("settings/checks.schema.json"));
  for (const required of schema.required) expect(checks).toHaveProperty(required);
});

test("the existing production listing finds the Pod by manifest id after a rename", async () => {
  const podsRoot = await mkdtemp(join(tmpdir(), "snowdon-pod-"));
  try {
    await cp(root, join(podsRoot, "Renamed In Explorer"), { recursive: true });
    const listed = await Effect.runPromise(
      listPods({ podsRoot }).pipe(Effect.provide(NodeServices.layer)),
    );
    const pod = listed.pods.find((p) => p.id === "snowdon-ducts");
    expect(pod?.folder).toBe("Renamed In Explorer");
    const paths = (pod?.members ?? []).map((m: { path: string }) => m.path);
    expect(paths).toContain("settings/checks.json");
  } finally {
    await rm(podsRoot, { recursive: true, force: true });
  }
});

test("packages.ts admits every authored file, in a renamed folder, with the canonical keys", async () => {
  const podsRoot = await mkdtemp(join(tmpdir(), "snowdon-pkg-"));
  try {
    await cp(root, join(podsRoot, "Renamed In Explorer"), { recursive: true });
    const pod = await readPackage("snowdon-ducts", podsRoot);
    expect(pod.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(pod.members.map((m) => m.path).sort()).toEqual(await files(root));
    const keys = pod.contributions.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "script:@snowdon-ducts/src/Census.cs",
        "script:@snowdon-ducts/src/InspectRun.cs",
        "script:@snowdon-ducts/src/CoefficientExperiment.cs",
        "page:@snowdon-ducts/pages/tour",
        "skill:@snowdon-ducts/skills/duct-loss",
        "member:@snowdon-ducts/settings/checks.json",
      ]),
    );
    expect(keys.filter((k) => k.startsWith("script:"))).toHaveLength(3);
    const captured = await capturePackage(pod);
    expect(captured.memberBundle.files.map((f) => f.path).sort()).toEqual(await files(root));
  } finally {
    await rm(podsRoot, { recursive: true, force: true });
  }
});

test("production export then import: only authored bytes cross, and keys survive a renamed folder", async () => {
  const from = await mkdtemp(join(tmpdir(), "snowdon-from-"));
  const to = await mkdtemp(join(tmpdir(), "snowdon-to-"));
  try {
    await cp(root, join(from, "Mine"), { recursive: true });
    const archivePath = join(from, "snowdon-ducts.zip");
    const exported = await exportPod({ pod: "snowdon-ducts", archivePath }, { podsRoot: from });
    // P3: the archive is exactly the authored Pod; no transform touched a byte; nothing vendored or captured.
    expect(exported.members.map((m) => m.path).sort()).toEqual(await files(root));
    expect(exported.transforms).toEqual([]);
    expect(exported.vendored).toEqual([]);
    expect(exported.captures).toEqual([]);
    const entries = [...readZip(await readFile(archivePath)).keys()];
    expect(
      entries.filter((p) =>
        /(^|\/)\.state(\/|$)|binding|output\/|imported\.json|\.(rvt|png|zip)$/i.test(p),
      ),
    ).toEqual([]);
    for (const m of exported.members)
      expect(m.sha256).toBe(
        createHash("sha256")
          .update(await readFile(join(root, m.path)))
          .digest("hex"),
      );

    const imported = await importPod({ archivePath, folder: "Elsewhere" }, { podsRoot: to });
    expect(imported.folder).toBe("Elsewhere");
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
    expect(imported.members.filter((m) => m.path !== "imported.json").sort(byPath)).toEqual(
      [...exported.members].sort(byPath),
    );
    const before = (await readPackage("snowdon-ducts", from)).contributions
      .map((c) => c.key)
      .sort();
    const after = (await readPackage("snowdon-ducts", to)).contributions.map((c) => c.key).sort();
    expect(after).toEqual(before);
    expect(after).toContain("page:@snowdon-ducts/pages/tour");
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

// `member:` cannot execute: covered by pages.test.ts ("A member reads, never runs", member:@ducts/settings/checks.json)
// against the same production Page act door, so it is not duplicated here.
