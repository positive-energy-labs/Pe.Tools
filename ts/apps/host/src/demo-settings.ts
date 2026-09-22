import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Effect, FileSystem } from "effect";
import { NodeServices } from "@effect/platform-node";
import { makeDirectory } from "./files/index.ts";
import type {
  PodMember,
  PodMemberComposeRequest,
  PodMemberWriteRequest,
  PodRunsRequest,
} from "@pe/host-contracts/operation-types";
import {
  composeMember,
  listPods,
  listRuns,
  podFolder,
  readMember,
  writeMember,
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
  const podsRoot = resolve(storageRoot, "Pods");
  const ctx = { podsRoot };
  const memberPath = async (member: PodMember) =>
    assertDemoPath(storageRoot, resolve(await run(podFolder(member.pod, ctx)), member.path));
  return {
    podsRoot,
    runPods: run,
    memberPath,
    /** Demo pods are named by their id; production resolves ids by scanning manifests. */
    async ensurePod(id: string) {
      await run(makeDirectory(resolve(podsRoot, id), "demo.pod"));
      await run(
        Effect.flatMap(FileSystem.FileSystem, (fs) =>
          fs.writeFileString(resolve(podsRoot, id, "pod.json"), JSON.stringify({ id, name: id })),
        ),
      );
    },
    listPods: () => run(listPods(ctx)),
    listRuns: (request: PodRunsRequest) => run(listRuns(request, ctx)),
    async readMember(member: PodMember) {
      await memberPath(member);
      return run(readMember(member, ctx));
    },
    async composeMember(request: PodMemberComposeRequest) {
      // A draft composes its own bytes and names no pod, so there is no pod-relative path to
      // fence; only a request that names its pod reads one off disk.
      if (request.pod !== undefined) await memberPath({ pod: request.pod, path: request.path });
      return run(composeMember(request, ctx));
    },
    async writeMember(request: PodMemberWriteRequest) {
      await memberPath(request);
      return run(writeMember(request, ctx));
    },
    async nativePaths(input: { modelDirectory?: string }, _id: string, file: string) {
      return {
        modelDirectory: await assertDemoPath(storageRoot, input.modelDirectory ?? dirname(file)),
      };
    },
  };
}
