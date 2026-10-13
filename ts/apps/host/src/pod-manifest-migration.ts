import { packageIdSchema } from "@pe/agent-contracts";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { productPodsRootPath } from "./product-paths.ts";

type ManifestMigration = { id: string; manifestPath: string; backupPath: string; removed: number };

/** The only legacy conversion: startup awaits this before any membership reader runs. */
export async function migratePodManifests(
  podsRoot = productPodsRootPath(),
): Promise<ManifestMigration[]> {
  const changes: ManifestMigration[] = [];
  const folders = await readdir(podsRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
    const manifestPath = join(podsRoot, folder.name, "pod.json");
    const info = await lstat(manifestPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
      Effect.runSync(
        Effect.logWarning(`Pod manifest migration skipped unsafe input: ${manifestPath}`),
      );
      continue;
    }
    const handle = await open(manifestPath, "r");
    let original: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.ino !== info.ino || stat.size !== info.size)
        throw Error(`Pod manifest changed during migration: ${manifestPath}`);
      original = Buffer.alloc(info.size + 1);
      let count = 0;
      while (count < original.length) {
        const read = await handle.read(original, count, original.length - count, null);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count !== info.size)
        throw Error(`Pod manifest changed during migration: ${manifestPath}`);
      original = original.subarray(0, count);
    } finally {
      await handle.close();
    }
    let value;
    try {
      value = JSON.parse(original.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      // The reader reports invalid JSON; an unrelated bad Pod must not block host startup.
      continue;
    }
    if (!Array.isArray(value?.entrypoints)) continue;
    let removed = 0;
    for (const entry of value.entrypoints) {
      if (entry && typeof entry.sourcePath === "string" && Object.hasOwn(entry, "id")) {
        delete entry.id;
        removed++;
      }
    }
    if (!removed) continue;
    const identity = packageIdSchema.safeParse(value.id);
    if (!identity.success) continue;
    const id = identity.data;
    const backups = join(dirname(podsRoot), ".backups");
    const podBackups = join(backups, "pods");
    for (const directory of [backups, podBackups]) {
      await mkdir(directory, { recursive: true });
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error(`Pod backup directory cannot be a link: ${directory}`);
    }
    const backupDirectory = join(
      podBackups,
      `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    await mkdir(backupDirectory);
    const backupPath = join(backupDirectory, "pod.json");
    await writeFile(backupPath, original, { flag: "wx" });
    const partial = `${manifestPath}.${randomUUID()}.partial`;
    try {
      await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
      if (!(await readFile(manifestPath)).equals(original))
        throw Error(
          `Pod manifest changed during migration: ${manifestPath}; backup: ${backupPath}`,
        );
      await rename(partial, manifestPath);
    } finally {
      await rm(partial, { force: true });
    }
    changes.push({ id, manifestPath, backupPath, removed });
    Effect.runSync(
      Effect.logInfo(
        `Migrated ${manifestPath}: removed ${removed} entrypoint id field(s); backup: ${backupPath}`,
      ),
    );
  }
  return changes;
}
