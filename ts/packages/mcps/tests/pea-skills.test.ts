import { createHash } from "node:crypto";
import { captureDirectory } from "../../../apps/host/src/packages.ts";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { productPathNames } from "@pe/host-contracts/contracts";
import {
  bundledPeaSkills,
  publishPeaSkills,
  resolvePeaSkillPaths,
  retiredPeaSkillNames,
} from "../src/pea/skills.ts";

const homeVariable = productPathNames.productHomeVariable;

async function withTempProductHomeEnv() {
  const previousProductHome = process.env[homeVariable];
  const tempRoot = await mkdtemp(path.join(tmpdir(), "pe-tools-home-"));
  const productHome = path.join(tempRoot, "Pe.Tools");
  process.env[homeVariable] = productHome;

  return {
    productHome,
    dispose: async () => {
      if (previousProductHome == null) delete process.env[homeVariable];
      else process.env[homeVariable] = previousProductHome;

      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

test("materialization deletes a retired skill folder only when the product receipt proves its bytes", async () => {
  const profile = await withTempProductHomeEnv();
  try {
    const [codexRoot, claudeRoot] = resolvePeaSkillPaths();
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

    const materialized = await publishPeaSkills({ captureDirectory });

    expect(materialized.skills.map((skill) => skill.name)).toContain("my-office-standards");
    for (const root of resolvePeaSkillPaths())
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
    await profile.dispose();
  }
});
