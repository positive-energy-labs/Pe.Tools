import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "@pe/host-contracts/store";
import { contributionKey, type ContributionSource } from "@pe/agent-contracts";
import { z } from "zod";
import {
  bundledPeaSkills,
  retiredPeaSkillNames,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  type PeaProductHomeOptions,
} from "./skills.ts";

export type SkillFile = { path: string; bytes: Uint8Array; sha256: string };
export type SkillSnapshot = {
  key: string;
  name: string;
  content: string;
  files: SkillFile[];
  package: ContributionSource;
};
type SkillDirectoryCapture = (
  directory: string,
) => Promise<{ members: SkillFile[]; diagnostics: { severity: string; message: string }[] }>;
export type SkillPublicationOptions = PeaProductHomeOptions & {
  /** The agent's working directory: the projections land under it, never in a home. */
  agentPath: string;
  captureDirectory: SkillDirectoryCapture;
};
export type SkillPublication = { skills: SkillSnapshot[]; notices: string[] };
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const receiptName = ".pe-projection.json";
const projectionReceipt = z.record(
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/),
  z.string().regex(/^[a-f0-9]{64}$/),
);

export function skillSnapshot(packageId: string, name: string, files: SkillFile[]): SkillSnapshot {
  const entry = files.find((f) => f.path === "SKILL.md");
  if (!entry) throw Error(`Skill ${name} has no SKILL.md`);
  return {
    key: contributionKey({ kind: "skill", packageId, path: `skills/${name}` }),
    name,
    content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.bytes),
    files,
    package: { id: packageId, path: `skills/${name}/SKILL.md`, sha256: entry.sha256 },
  };
}

export function builtinPeaSkillSnapshots(): SkillSnapshot[] {
  return bundledPeaSkills.map((s) => {
    const bytes = Buffer.from(`${s.content.trimEnd()}\n`);
    return skillSnapshot("product", s.name, [{ path: "SKILL.md", bytes, sha256: hash(bytes) }]);
  });
}

/**
 * `<home>/Skills` is the one personal source. The harness roots under the agent's working directory
 * are projections of it: written, never read back as a source, and nothing here writes into a home.
 */
export async function publishPeaSkills(
  options: SkillPublicationOptions,
  packaged: readonly SkillSnapshot[] = [],
  builtins: readonly SkillSnapshot[] = builtinPeaSkillSnapshots(),
): Promise<SkillPublication> {
  const capture = async (directory: string) => {
    const admitted = await options.captureDirectory(directory);
    const errors = admitted.diagnostics.filter((d) => d.severity === "error");
    if (errors.length) throw Error(errors.map((d) => d.message).join("; "));
    return admitted.members.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  };
  const home = resolvePeaProductHomePath(options);
  const roots = resolvePeaSkillPaths(options.agentPath);
  const bundled = builtins;
  const canonicalRoot = join(home, "Skills");
  const personal = new Map<string, SkillFile[]>();
  const notices: string[] = [];
  /** Folders per root whose bytes equal the product's receipt: the only ones the product may delete. */
  const proven = roots.map(() => new Set<string>());
  for (const name of await directories(canonicalRoot))
    personal.set(name, await capture(join(canonicalRoot, name)));
  const managed = await Promise.all(
    roots.map(async (root) => {
      try {
        return projectionReceipt.parse(JSON.parse(await readFile(join(root, receiptName), "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
      }
    }),
  );
  for (const [i, root] of roots.entries()) {
    for (const name of await directories(root)) {
      const receipt = managed[i]![name];
      if (receipt && receipt === signature(await capture(join(root, name)))) proven[i]!.add(name);
      else if (retiredPeaSkillNames.includes(name))
        notices.push(
          `Skill folder ${join(root, name)} carries a retired product name but no matching product receipt, so it was left untouched; delete it if it is not yours.`,
        );
      // ponytail: product skills overwrite same-named folders outright (kaitpw 2026-10-17); owed: user edits that survive product updates.
      else if (!receipt && !bundled.some((s) => s.name === name) && !personal.has(name))
        notices.push(
          `Skill folder ${join(root, name)} is not a source, so only that harness sees it; move it to ${join(canonicalRoot, name)} to publish it.`,
        );
    }
  }
  const skills = [
    ...bundled,
    ...[...personal].map(([name, files]) => skillSnapshot("skills", name, files)),
    ...packaged,
  ];
  const destinations = new Map<string, SkillSnapshot>();
  for (const skill of skills) {
    const name =
      skill.package.id === "product" || skill.package.id === "skills"
        ? skill.name
        : `${skill.package.id}--${skill.name}`;
    if (destinations.has(name.toLowerCase())) throw Error(`Conflicting skill projection: ${name}`);
    destinations.set(name.toLowerCase(), skill);
  }
  // Admission completes before any destination changes.
  for (const root of roots) {
    await mkdir(root, { recursive: true });
    const receipt: Record<string, string> = {};
    for (const [name, skill] of destinations) {
      await rm(join(root, name), { recursive: true, force: true });
      await writeFiles(join(root, name), skill.files);
      receipt[name] = signature(skill.files);
    }
    for (const name of proven[roots.indexOf(root)]!)
      if (!destinations.has(name)) await rm(join(root, name), { recursive: true, force: true });
    await writeFile(join(root, receiptName), JSON.stringify(receipt));
  }
  return { skills, notices };
}

const signature = (files: readonly SkillFile[]) =>
  hash(
    files
      .map((f) => `${f.path}:${f.sha256}`)
      .sort()
      .join("\n"),
  );
async function directories(root: string) {
  try {
    if ((await lstat(root)).isSymbolicLink()) throw Error("Skill roots cannot be links");
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.some((e) => e.isSymbolicLink())) throw Error("Skill directories cannot be links");
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function writeFiles(root: string, files: readonly SkillFile[]) {
  for (const file of files) {
    const path = join(root, file.path);
    writeAtomic(path, file.bytes);
  }
}
