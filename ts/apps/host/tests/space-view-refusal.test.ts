import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { spaceViewSchema, emptySpaceCut } from "@pe/agent-contracts/space-view";
import { stateTree } from "@pe/host-contracts/service-identity";
import { notices, read, sha256Hex, stateKind } from "@pe/host-contracts/kinds";

const common = {
  scene: "a".repeat(64),
  camera: [0, 0, 10],
  target: [0, 0, 0],
  hidden: [],
  isolated: null,
  selected: null,
};
const v1 = {
  version: 1,
  ...common,
  polyline: [
    [0, 0],
    [1, 0],
  ],
  closed: false,
  offset: 0,
  keepInside: true,
};

test("Space saved-view decode accepts v2 and refuses v1 without converting it", () => {
  expect(spaceViewSchema.safeParse(v1).success).toBe(false);
  expect(
    spaceViewSchema.safeParse({
      version: 2,
      ...common,
      cuts: { top: emptySpaceCut, north: emptySpaceCut, east: emptySpaceCut },
    }).success,
  ).toBe(true);
});

test("store.read sets refused v1 state bytes aside, verifies their blob and posts one notice", () => {
  // No application consumes spaceViewSchema. This checks the real store boundary, not invented wiring.
  const root = mkdtempSync(join(tmpdir(), "pe-space-refusal-"));
  try {
    const machine = stateTree(root);
    const kind = stateKind({
      schema: spaceViewSchema,
      place: () => "Space saved view",
      segments: () => ["space-view.json"],
    });
    const file = kind.in(machine);
    const bytes = Buffer.from(JSON.stringify(v1, null, 2) + "\n");
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, bytes);
    expect(read(file).kind).toBe("set-aside");
    expect(existsSync(file.path)).toBe(false);
    expect(readFileSync(join(machine.blobs, "sha256", sha256Hex(bytes)))).toEqual(bytes);
    expect(notices(machine)).toHaveLength(1);
    expect(read(file).kind).toBe("missing");
    expect(notices(machine)).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
