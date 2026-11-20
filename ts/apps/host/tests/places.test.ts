import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vite-plus/test";
import { stateTree } from "@pe/host-contracts/service-identity";
import { notices, rested } from "@pe/host-contracts/kinds";
import { placesKind, readPlaces, writePlaces, subscribePlaces } from "../src/places.ts";

const roots: string[] = [];
const machine = () => {
  const root = mkdtempSync(join(tmpdir(), "places-"));
  roots.push(root);
  return stateTree(root);
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const list = {
  places: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      route: "pumps",
      link: "/pumps",
      at: "2026-11-13T00:00:00Z",
    },
  ],
};

test("write then read returns the list", () => {
  const root = machine();
  writePlaces(list, root);
  expect(readPlaces(root)).toEqual(list);
});
test("second client receives invalidation and reads the same list", () => {
  const root = machine();
  let observed;
  const stop = subscribePlaces(() => {
    observed = readPlaces(root);
  }, root);
  try {
    writePlaces(list, root);
    expect(observed).toEqual(list);
  } finally {
    stop();
  }
});
test("a restarted owner reads the persisted list", () => {
  const root = machine();
  writePlaces(list, root);
  expect(JSON.parse(readFileSync(placesKind.in(root).path, "utf8"))).toEqual(list);
  expect(readPlaces(stateTree(join(root.state, "..")))).toEqual(list);
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "jiti/register",
      "--input-type=module",
      "-e",
      `import { createJiti } from 'jiti'; const jiti = createJiti(import.meta.url); const { readPlaces } = await jiti.import('./src/places.ts'); const { stateTree } = await jiti.import('@pe/host-contracts/service-identity'); console.log(JSON.stringify(readPlaces(stateTree(process.env.PLACES_TEST_ROOT))));`,
    ],
    {
      cwd: import.meta.dirname + "/..",
      env: { ...process.env, PLACES_TEST_ROOT: join(root.state, "..") },
      encoding: "utf8",
    },
  );
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual(list);
});
test("undecodable file is set aside with its bytes kept and one notice and reads empty", () => {
  const root = machine();
  writePlaces(list, root);
  const file = placesKind.in(root).path,
    bytes = Buffer.from('{"places":"broken"}');
  writeFileSync(file, bytes);
  expect(readPlaces(root)).toEqual({ places: [] });
  expect(existsSync(file)).toBe(false);
  expect(readPlaces(root)).toEqual({ places: [] });
  const rows = notices(root);
  expect(rows).toHaveLength(1);
  expect(rested(root, rows[0]!.sha256!)).toEqual({ kind: "ok", bytes });
});
