import { mkdtempSync as makeTempSync, mkdirSync, rmSync } from "node:fs";
import { mkdtemp as makeTemp, mkdir } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { afterAll } from "vite-plus/test";
import { stateTree } from "../../packages/host-contracts/src/service-identity.ts";
import type { StateDirectory } from "../../packages/host-contracts/src/kinds.ts";

const temporaryRoots = new Set<string>();
afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

/** Fixtures live beneath a real state root, so the public brands need no test-only casts. */
export function mkdtempSync(prefix: string): string {
  const root = makeTempSync(prefix);
  temporaryRoots.add(root);
  const directory = stateTree(root).directory();
  mkdirSync(directory.path, { recursive: true });
  return directory.path;
}
export async function mkdtemp(prefix: string): Promise<string> {
  const root = await makeTemp(prefix);
  temporaryRoots.add(root);
  const directory = stateTree(root).directory();
  await mkdir(directory.path, { recursive: true });
  return directory.path;
}
export async function mkdtempWork(prefix: string): Promise<string> {
  const root = await mkdtemp(prefix);
  const directory = stateFixture(root);
  const work = stateTree(dirname(directory.machine.state)).directory("Work");
  await mkdir(work.path, { recursive: true });
  return work.path;
}
export function stateFixture(path: string): StateDirectory {
  const target = resolve(path);
  for (let ancestor = target; ; ancestor = dirname(ancestor)) {
    if (basename(ancestor).toLowerCase() === "state") {
      const machine = stateTree(dirname(ancestor));
      return machine.directory(...relative(machine.state, target).split(/[\\/]/).filter(Boolean));
    }
    if (dirname(ancestor) === ancestor) throw Error(`Fixture has no state root: ${path}`);
  }
}
export const stateMachine = (path: string) => stateFixture(path).machine;
