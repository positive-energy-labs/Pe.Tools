import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Effect, FileSystem } from "effect";
import { NodeServices } from "@effect/platform-node";
import type {
  OpenSettingsDocumentRequest,
  SaveSettingsDocumentRequest,
  SettingsDocumentId,
  SettingsTreeRequest,
  ValidateSettingsDocumentRequest,
} from "@pe/host-contracts/operation-types";
import {
  discoverSettingsTree,
  openSettingsDocument,
  saveSettingsDocument,
  settingsDocumentAddress,
  validateSettingsDocument,
} from "./settings.ts";

/** Each existing path component must be owned; links are refused even when their target is local. */
export async function assertDemoPath(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const target = resolve(path);
  const child = relative(base, target);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw Error("Demo root escape refused");
  let cursor = base;
  for (const part of child.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw Error("Demo symbolic-link path refused");
      const resolved = await realpath(cursor);
      const within = relative(base, resolved);
      if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
        throw Error("Demo resolved root escape refused");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

/** Real Settings policy with mandatory root and a filesystem that cannot leave it. */
export async function createDemoSettings(root: string) {
  const storageRoot = await realpath(root);
  const fs = await Effect.runPromise(
    FileSystem.FileSystem.pipe(Effect.provide(NodeServices.layer)),
  );
  const pathMethods = new Set([
    "access",
    "exists",
    "stat",
    "readFile",
    "readFileString",
    "readDirectory",
    "open",
    "makeDirectory",
    "writeFile",
    "writeFileString",
    "rename",
    "remove",
  ]);
  const guarded = new Proxy(fs, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof key !== "string" || !pathMethods.has(key) || typeof value !== "function")
        return value;
      return (...args: unknown[]) =>
        Effect.tryPromise(async () => {
          await assertDemoPath(storageRoot, String(args[0]));
          if (key === "rename") await assertDemoPath(storageRoot, String(args[1]));
        }).pipe(
          Effect.flatMap(() => Reflect.apply(value, target, args) as Effect.Effect<unknown, Error>),
        );
    },
  });
  const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provideService(FileSystem.FileSystem, guarded)));
  const settingsAddress = async (id: SettingsDocumentId) => {
    const address = await run(settingsDocumentAddress(id, storageRoot));
    await assertDemoPath(storageRoot, address.path);
    if (id.stableId && resolve(id.stableId).toLowerCase() !== address.path.toLowerCase())
      throw Error("Original/production Settings address is evidence only");
    return address;
  };
  return {
    settingsAddress,
    async validateSettings(request: ValidateSettingsDocumentRequest) {
      await settingsAddress(request.documentId);
      return run(validateSettingsDocument(request, { storageRoot }));
    },
    async settingsTree(request: SettingsTreeRequest) {
      return run(discoverSettingsTree(request, { storageRoot }));
    },
    async openSettings(request: OpenSettingsDocumentRequest) {
      await settingsAddress(request.documentId);
      return run(openSettingsDocument(request, { storageRoot }));
    },
    async saveSettings(request: SaveSettingsDocumentRequest) {
      await settingsAddress(request.documentId);
      return run(saveSettingsDocument(request, { storageRoot }));
    },
    async nativePaths(
      input: { outputPath?: string; modelDirectory?: string },
      id: string,
      file: string,
    ) {
      return {
        outputPath: await assertDemoPath(
          storageRoot,
          input.outputPath ?? resolve(storageRoot, "outputs", `${id}.rfa`),
        ),
        modelDirectory: await assertDemoPath(storageRoot, input.modelDirectory ?? dirname(file)),
      };
    },
  };
}
