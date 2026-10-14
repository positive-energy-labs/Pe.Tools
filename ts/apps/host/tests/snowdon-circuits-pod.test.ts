import { expect, test } from "vite-plus/test";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { readPackage, capturePackage } from "../src/packages.ts";
import { exportPod, importPod } from "../src/pod-transfer.ts";

const root = join(import.meta.dirname, "../../../../examples/pods/snowdon-circuits");
const text = (path: string) => readFile(join(root, path), "utf8");
async function files(dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else out.push(relative(root, p).replaceAll("\\", "/"));
  }
  return out.sort();
}

test("Snowdon circuits ships authored sources, never a model, reading, state or binding", async () => {
  const all = await files();
  expect(all).toEqual(
    expect.arrayContaining([
      "pod.json",
      "README.md",
      "AGENTS.md",
      "PeScripts.csproj",
      "src/Census.cs",
      "src/InspectRun.cs",
      "src/Probe.cs",
      "pages/tour/index.html",
      "skills/circuit-drop/SKILL.md",
    ]),
  );
  expect(
    all.filter((p) =>
      /(^|\/)(\.state|bin|obj|output|\.git)(\/|$)|binding\.json|\.(rvt|rfa|rte|zip|png|jpe?g)$/i.test(
        p,
      ),
    ),
  ).toEqual([]);
  const pod = JSON.parse(await text("pod.json"));
  expect(pod.id).toBe("snowdon-circuits");
  expect(pod.schemaVersion).toBe(2);
  for (const entry of pod.entrypoints)
    expect((await text(entry.sourcePath)).match(/:\s*PeScriptContainer/g)).toHaveLength(1);
});

test("numeric readings use native units, the binding chooses the document, and copy checks precede writes", async () => {
  const probe = await text("src/Probe.cs");
  for (const member of [
    "ElectricalSystem",
    "UnitTypeId.Volts",
    "UnitTypeId.Amperes",
    "UnitTypeId.Feet",
    "WireMaterial",
    "RBS_ELEC_CIRCUIT_WIRE_SIZE_PARAM",
  ])
    expect(probe).toContain(member);
  const page = await text("pages/tour/page.js");
  expect(page).toContain("pe.target()");
  expect(page).not.toMatch(/pe\.target\([^)]*["']|x-pe-origin|x-pe-session|x-pe-document/);
  expect(page).toContain("script:@snowdon-circuits/src/Census.cs");
  expect(page).toContain("script:@snowdon-circuits/src/InspectRun.cs");
  expect(page).toContain("Approve and apply wire change");
  const start = page.indexOf("const approve");
  expect(page.slice(start, page.indexOf("const inspect", start))).toMatch(
    /await assertCopy\(\)[\s\S]*pe\.do\(proposal\.key/,
  );
});

test("the skill has valid frontmatter and no seed fingerprints or recorded results ship", async () => {
  const skill = await text("skills/circuit-drop/SKILL.md");
  expect(skill).toMatch(/^---\r?\nname: circuit-drop\r?\n/);
  expect(/^description: (.*)$/m.exec(skill)?.[1]).not.toContain(': "');
  for (const path of await files()) {
    if (path.endsWith("index.html")) continue;
    expect(await text(path), path).not.toMatch(
      /chadds|kaitpw|pdrop|proven\[|\b20\d\d-\d\d-\d\d\b/i,
    );
  }
});

test("production capture and export/import preserve authored bytes and canonical keys", async () => {
  const from = await mkdtemp(join(tmpdir(), "circuit-from-"));
  const to = await mkdtemp(join(tmpdir(), "circuit-to-"));
  try {
    await cp(root, join(from, "Renamed"), { recursive: true });
    const pod = await readPackage("snowdon-circuits", from);
    expect(pod.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(pod.members.map((m) => m.path).sort()).toEqual(await files());
    expect(pod.contributions.map((c) => c.key)).toEqual(
      expect.arrayContaining([
        "page:@snowdon-circuits/pages/tour",
        "script:@snowdon-circuits/src/Census.cs",
        "script:@snowdon-circuits/src/InspectRun.cs",
        "skill:@snowdon-circuits/skills/circuit-drop",
      ]),
    );
    expect((await capturePackage(pod)).memberBundle.files.map((f) => f.path).sort()).toEqual(
      await files(),
    );
    const archivePath = join(from, "circuits.zip");
    const exported = await exportPod({ pod: "snowdon-circuits", archivePath }, { podsRoot: from });
    expect(exported.transforms).toEqual([]);
    expect(exported.captures).toEqual([]);
    for (const member of exported.members)
      expect(member.sha256).toBe(
        createHash("sha256")
          .update(await readFile(join(root, member.path)))
          .digest("hex"),
      );
    await importPod({ archivePath, folder: "Elsewhere" }, { podsRoot: to });
    const imported = await readPackage("snowdon-circuits", to);
    expect(imported.contributions.map((c) => c.key).sort()).toEqual(
      pod.contributions.map((c) => c.key).sort(),
    );
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
}, 15_000);
