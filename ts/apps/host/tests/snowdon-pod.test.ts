// P3 (plan WAVE3-PLAN §6): the shipped snowdon-ducts example is clean authored content and a real Pod.
// Deterministic lane: no Revit, no server. It proves packaging shape and content hygiene, never any finding about
// the sample model. Packaged-membership and import/export round trips are `test.todo` until slices B and C land on
// the tip; they must then use the production implementation, not a fixture zip writer.
import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { capturePackage, readPackage } from "../src/packages.ts";
import { listPods } from "../src/settings.ts";

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
    /chadds/i,
    /kaitpw/i,
    /yoram/i,
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
    expect(captured.sourceBundle.files.map((f) => f.path).sort()).toEqual(await files(root));
  } finally {
    await rm(podsRoot, { recursive: true, force: true });
  }
});

// Owed until C (pod-transfer.ts) is on the tip; it must run the production export/import, not a fixture zip writer.
test.todo(
  "pod.export of the imported Pod with no native bridge round-trips to the same admitted bytes",
);
test.todo("member: refuses execution under the Page principal (E)");
