import { createHash } from "node:crypto";
import path from "node:path";
import { captureDirectory } from "../../../apps/host/src/packages.ts";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  bundledPeaSkills,
  publishPeaSkills,
  resolvePeaSkillPaths,
  retiredPeaSkillNames,
} from "../src/pea/skills.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { peFind, peRead } from "../src/pea/capability-tools.ts";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("one admitted user revision reaches both harnesses, discovery and reads after its source changes", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  const home = await mkdtemp(join(tmpdir(), "pe-skill-cut-"));
  try {
    await mkdir(join(home, "Skills", "office"), { recursive: true });
    const content = "---\nname: office\ndescription: Office rules.\n---\n\nExact bytes.\r\n";
    await writeFile(join(home, "Skills", "office", "SKILL.md"), content);
    await writeFile(join(home, "Skills", "office", "support.txt"), "support\r\n");
    const snapshot = await publishPeaSkills({ productHomePath: home, captureDirectory });
    const skill = snapshot.skills.find((s) => s.key === "skill:@skills/skills/office")!;
    expect(skill.content).toBe(content);
    for (const root of resolvePeaSkillPaths({ productHomePath: home })) {
      expect(await readFile(join(root, "office", "SKILL.md"), "utf8")).toBe(content);
      expect(await readFile(join(root, "office", "support.txt"), "utf8")).toBe("support\r\n");
    }
    await writeFile(join(home, "Skills", "office", "SKILL.md"), "later revision");
    const requests: URL[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.pathname === "/pe/capabilities")
        return Response.json({
          at: "2026-11-04T00:00:00.000Z",
          machine: machineFixture(),
          sources: {},
          diagnostics: [],
          capabilities: buildCapabilities({
            ops: [],
            routes: [],
            packages: [],
            skills: snapshot.skills,
          }),
        });
      expect(url.pathname).toBe("/pe/contributions");
      expect(url.searchParams.get("key")).toBe("skill:@skills/skills/office");
      expect(url.searchParams.get("sha256")).toBe(skill.package.sha256);
      return Response.json({
        content: skill.content,
        bytesBase64: Buffer.from(skill.files.find((f) => f.path === "SKILL.md")!.bytes).toString(
          "base64",
        ),
        sha256: skill.package.sha256,
      });
    });
    const found = await peFind.execute({ query: "office", kind: "skill", limit: 8 }, undefined);
    expect(found).toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ key: "skill:@skills/skills/office", package: skill.package }),
      ]),
    });
    expect(
      await peRead.execute({ key: "skill:@skills/skills/office", timeoutSeconds: 30 }, undefined),
    ).toMatchObject({
      ok: true,
      result: content,
      bytesBase64: Buffer.from(content).toString("base64"),
      source: skill.package,
    });
    expect(requests.filter((url) => url.pathname === "/pe/contributions")).toHaveLength(1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("conflicting personal harness copies refuse publication without overwriting either", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-conflict-"));
  try {
    const roots = resolvePeaSkillPaths({ productHomePath: home });
    for (const [i, root] of roots.entries()) {
      await mkdir(join(root, "office"), { recursive: true });
      await writeFile(join(root, "office", "SKILL.md"), `copy ${i}`);
    }
    await expect(publishPeaSkills({ productHomePath: home, captureDirectory })).rejects.toThrow(
      /conflict/i,
    );
    expect(await readFile(join(roots[0]!, "office", "SKILL.md"), "utf8")).toBe("copy 0");
    expect(await readFile(join(roots[1]!, "office", "SKILL.md"), "utf8")).toBe("copy 1");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a corrupt projection receipt cannot turn skill retirement into a path escape", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-receipt-"));
  try {
    const root = resolvePeaSkillPaths({ productHomePath: home })[0]!;
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, ".pe-projection.json"),
      JSON.stringify({ "../../outside": "a".repeat(64) }),
    );
    await writeFile(join(home, "outside"), "keep");
    await expect(publishPeaSkills({ productHomePath: home, captureDirectory })).rejects.toThrow();
    expect(await readFile(join(home, "outside"), "utf8")).toBe("keep");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a same-named skill folder without a receipt is overwritten by the product's skill", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-shipped-"));
  try {
    const roots = resolvePeaSkillPaths({ productHomePath: home });
    for (const [i, root] of roots.entries()) {
      await mkdir(join(root, "build-pod"), { recursive: true });
      await writeFile(join(root, "build-pod", "SKILL.md"), `older projection ${i}`);
    }
    await mkdir(join(roots[0]!, "mine"), { recursive: true });
    await writeFile(join(roots[0]!, "mine", "SKILL.md"), "user skill");
    const publication = await publishPeaSkills({ productHomePath: home, captureDirectory });
    const shipped = publication.skills.find((s) => s.key === "skill:@product/skills/build-pod")!;
    for (const root of roots)
      expect(await readFile(join(root, "build-pod", "SKILL.md"), "utf8")).toBe(shipped.content);
    expect(await readFile(join(roots[0]!, "mine", "SKILL.md"), "utf8")).toBe("user skill");
    expect(publication.notices).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("materialization deletes a retired skill folder only when the product receipt proves its bytes", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-skill-retirement-"));
  const options = { productHomePath: home, captureDirectory };
  try {
    const [codexRoot, claudeRoot] = resolvePeaSkillPaths(options);
    const retiredName = retiredPeaSkillNames[0]!;
    const userOwned = path.join(codexRoot!, "my-office-standards", "SKILL.md");
    const receipted = path.join(codexRoot!, retiredName, "SKILL.md");
    const unreceipted = path.join(claudeRoot!, retiredName, "SKILL.md");
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const receiptHash = createHash("sha256")
      .update(`SKILL.md:${sha("old\n")}`)
      .digest("hex");
    for (const file of [userOwned, receipted, unreceipted])
      await mkdir(path.dirname(file), { recursive: true });
    await writeFile(userOwned, "mine\n", "utf-8");
    await writeFile(receipted, "old\n", "utf-8");
    await writeFile(
      path.join(codexRoot!, ".pe-projection.json"),
      JSON.stringify({ [retiredName]: receiptHash }),
    );
    await writeFile(unreceipted, "the user's own words\n", "utf-8");

    const materialized = await publishPeaSkills(options);

    expect(materialized.skills.map((skill) => skill.name)).toContain("my-office-standards");
    for (const root of resolvePeaSkillPaths(options))
      for (const skill of bundledPeaSkills)
        expect(await readFile(path.join(root, skill.name, "SKILL.md"), "utf8")).toBe(
          `${skill.content.trimEnd()}\n`,
        );
    await expect(access(path.dirname(receipted))).rejects.toThrow();
    expect(await readFile(unreceipted, "utf-8")).toBe("the user's own words\n");
    expect(materialized.notices.filter((n) => n.includes(path.dirname(unreceipted)))).toHaveLength(
      1,
    );
    expect(await readFile(userOwned, "utf-8")).toBe("mine\n");
    expect(retiredPeaSkillNames.some((name) => bundledPeaSkills.some((s) => s.name === name))).toBe(
      false,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
