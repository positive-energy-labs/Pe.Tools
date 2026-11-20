import { settle } from "./effect-test.ts";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { stateTree } from "@pe/host-contracts/service-identity";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PictureCaptures } from "../src/captures-route.ts";

const schemas = vi.hoisted(() => ({ raw: vi.fn(), output: vi.fn() }));
vi.mock("@pe/host-contracts/decoders", async (original) => {
  const real = await original<typeof import("@pe/host-contracts/decoders")>();
  const { z } = await import("zod");
  return {
    ...real,
    nativeResponseSchema: (key: string) => {
      schemas.raw(key);
      return z.unknown();
    },
  };
});
vi.mock("@pe/agent-contracts", async (original) => ({
  ...(await original<typeof import("@pe/agent-contracts")>()),
  nativeOutputSchema: (key: string) => {
    schemas.output(key);
    return { parse: (value: unknown) => value };
  },
}));
vi.mock("../../../packages/agent-contracts/src/call-policy.ts", () => ({
  callPolicies: { "capture.test": { capture: true } },
}));
import { projectNativeOutput } from "../src/native-output.ts";

afterEach(() => vi.clearAllMocks());
const caller = { kind: "human" as const, via: "local" as const };

test("a refused capture carries typed reasons and never reads or stores a PNG", async () => {
  const pictures = new PictureCaptures(
    stateTree(process.env.PE_TEST_HOME_ROOT!).directory("unused"),
    1024,
    () => 1,
  );
  const keep = vi.spyOn(pictures, "keep");
  const notDrawn = [{ elementId: 7, reasons: ["PhaseHidden"] }];
  const value = await settle(
    projectNativeOutput(
      pictures,
      "capture.test",
      { refused: true, notDrawn, filePath: null },
      {},
      {},
      caller,
    ),
  );
  expect(value).toEqual({ refused: true, notDrawn, capture: null, imageUrl: null });
  expect(keep).not.toHaveBeenCalled();
});

test("a capture policy row projects using that call's key for both schemas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-output-policy-"));
  try {
    const filePath = join(dir, "image.png");
    await writeFile(filePath, "image bytes");
    const pictures = new PictureCaptures(stateFixture(dir), 1024 * 1024, () => 1);
    const keep = vi.spyOn(pictures, "keep");
    const result = await settle(
      projectNativeOutput(
        pictures,
        "capture.test",
        {
          filePath,
          view: { elementId: 42, label: "Plan" },
          marks: [{ elementId: 7, left: 10, top: 20, width: 30, height: 40 }],
        },
        {},
        {},
        caller,
      ),
    );
    expect(schemas.raw).toHaveBeenCalledWith("capture.test");
    expect(schemas.output).toHaveBeenCalledWith("capture.test");
    expect(keep).toHaveBeenCalledTimes(1);
    const capture = await keep.mock.results[0]!.value;
    expect(capture.marks).toEqual([{ elementId: 7, left: 10, top: 20, width: 30, height: 40 }]);
    expect(result).toMatchObject({ capture, imageUrl: capture.url });
    expect(result).not.toHaveProperty("filePath");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an already projected capture uses its own output schema without reading a file", async () => {
  const value = {
    capture: {
      id: "capture",
      sha: "a".repeat(64),
      at: "2026-11-12T00:00:00.000Z",
      byteSize: 1,
      url: `/captures/${"a".repeat(64)}.png`,
      origin: "human",
      document: {},
      view: {},
      focus: null,
      registration: null,
      marks: [],
    },
  };
  expect(
    await settle(
      projectNativeOutput(
        new PictureCaptures(
          stateTree(process.env.PE_TEST_HOME_ROOT!).directory("unused"),
          1024,
          () => 1,
        ),
        "capture.test",
        value,
        {},
        {},
        caller,
      ),
    ),
  ).toBe(value);
  expect(schemas.output).toHaveBeenCalledWith("capture.test");
  expect(schemas.raw).not.toHaveBeenCalled();
});

test("a call without capture policy passes through unchanged", async () => {
  const value = { filePath: "not-a-capture" };
  expect(
    await settle(
      projectNativeOutput(
        new PictureCaptures(
          stateTree(process.env.PE_TEST_HOME_ROOT!).directory("unused"),
          1024,
          () => 1,
        ),
        "ordinary.read",
        value,
        {},
        {},
        caller,
      ),
    ),
  ).toBe(value);
  expect(schemas.raw).not.toHaveBeenCalled();
  expect(schemas.output).not.toHaveBeenCalled();
});
