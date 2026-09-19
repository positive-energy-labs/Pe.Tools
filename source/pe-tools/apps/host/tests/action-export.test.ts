/**
 * The journal exports sealed admission, preparation and each step input before that step's effect.
 * Filesystem failures here are real: a regular file sits where a directory must be created.
 */
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { BridgeError } from "../src/bridge.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pe-export-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const admission = (id: string) => ({
  id,
  kind: "operation" as const,
  key: "op.exported",
  actor: "human" as const,
  destination: { kind: "host" as const },
  input: { path: `C:/model-${id}.rvt`, value: 1 },
  bases: {},
});
const settled = async (journal: ActionJournal, id: string) => {
  await journal.wait(id);
  return (await journal.list(undefined, id))[0]!;
};

test("each input is exported, byte-inspectable, before its effect runs", async () => {
  const journal = new ActionJournal(join(dir, "journal.json"));
  const { home } = await journal.outputs("a");
  const seen: string[] = [];
  await journal.admit(
    admission("a"),
    async () => ({ sealed: "preparation" }),
    async (execution) => {
      for (const key of ["first", "second"])
        await execution.step("native", key, { key }, async (requestId) => {
          seen.push(await readFile(join(home, "steps", `${requestId}.json`), "utf8"));
        });
    },
  );
  const row = await settled(journal, "a");
  expect(row.state).toBe("succeeded");
  expect(seen.map((bytes) => JSON.parse(bytes))).toEqual(
    row.steps.map(({ id, kind, key, input }) => ({ id, kind, key, input })),
  );
  expect(JSON.parse(await readFile(join(home, "admission.json"), "utf8"))).toEqual(admission("a"));
  expect(JSON.parse(await readFile(join(home, "preparation.json"), "utf8"))).toEqual({
    sealed: "preparation",
  });
});

test("an admission export failure refuses preparation and every effect", async () => {
  await writeFile(join(dir, "action-outputs"), "not a directory");
  const journal = new ActionJournal(join(dir, "journal.json"));
  let calls = 0;
  await journal.admit(
    admission("refused"),
    async () => ++calls,
    async (execution) => execution.step("native", "effect", {}, async () => ++calls),
  );
  const row = await settled(journal, "refused");
  expect(row).toMatchObject({ state: "failed", notDispatched: true, steps: [] });
  expect(calls).toBe(0);
});

test("a step export failure after a known effect keeps it and never replays it", async () => {
  const journal = new ActionJournal(join(dir, "journal.json"));
  const { home } = await journal.outputs("partial");
  const steps = join(home, "steps");
  const effects: string[] = [];
  const execute = async (execution: Parameters<Parameters<ActionJournal["admit"]>[2]>[0]) => {
    await execution.step("native", "first", { n: 1 }, async () => {
      effects.push("first");
      // The disk fails between effects: the steps folder is no longer a folder.
      if (effects.length === 1) {
        await rename(steps, `${steps}-kept`);
        await writeFile(steps, "not a directory");
      }
      return "done";
    });
    await execution.step("native", "second", { n: 2 }, async () => effects.push("second"));
  };
  await journal.admit(admission("partial"), async () => ({}), execute);
  const partial = await settled(journal, "partial");
  expect(partial.state).toBe("incomplete");
  expect(partial.steps).toMatchObject([
    { key: "first", state: "succeeded", result: "done" },
    { key: "second", state: "failed", notDispatched: true },
  ]);
  expect(partial.steps[1]!.state === "failed" && partial.steps[1]!.error).toContain(
    "Step input export failed",
  );
  expect(effects).toEqual(["first"]);

  await rm(steps);
  await rename(`${steps}-kept`, steps);
  await journal.admit(admission("partial"), async () => ({}), execute, true);
  const resumed = await settled(journal, "partial");
  expect(resumed.state).toBe("succeeded");
  expect(effects).toEqual(["first", "second"]);
});

test("unknown, cancelled and failed-preparation attempts stay discoverable by action ID", async () => {
  const path = join(dir, "journal.json");
  const journal = new ActionJournal(path);
  let effects = 0;
  await journal.admit(
    admission("unknown"),
    async () => ({ prepared: true }),
    async (execution) =>
      execution.step("native", "lost", { n: 1 }, async () => {
        ++effects;
        throw Error("reply lost");
      }),
  );
  await journal.admit(
    admission("cancelled"),
    async () => ({ prepared: true }),
    async (execution) => {
      await execution.step("file", "before", {}, async () => ++effects);
      await execution.step("native", "stopped", {}, async () => {
        ++effects;
        throw new BridgeError("cancelled", 499);
      });
    },
  );
  await journal.admit(
    admission("unprepared"),
    async () => {
      throw Error("stale base");
    },
    async () => ++effects,
  );
  const states = await Promise.all(
    ["unknown", "cancelled", "unprepared"].map(async (id) => (await settled(journal, id)).state),
  );
  expect(states).toEqual(["unknown", "cancelled", "failed"]);
  expect(effects).toBe(3);

  // Recovery reads evidence only: an unreadable receipt leaves the step uncertain, never redispatched.
  const reopened = new ActionJournal(path);
  const recovered = await reopened.recover("unknown", async () => {
    throw Error("no durable receipt");
  });
  expect(recovered.state).toBe("unknown");
  await expect(
    reopened.admit(
      admission("unknown"),
      async () => ({}),
      async () => ++effects,
      true,
    ),
  ).rejects.toThrow("Recover every uncertain step");
  expect(effects).toBe(3);

  const files = async (id: string) => Object.keys((await reopened.outputs(id)).files).sort();
  const stepFiles = async (id: string) =>
    (await reopened.list(undefined, id))[0]!.steps.map((step) => `steps/${step.id}.json`);
  expect(await files("unknown")).toEqual(
    ["admission.json", "preparation.json", ...(await stepFiles("unknown"))].sort(),
  );
  expect(await files("cancelled")).toEqual(
    ["admission.json", "preparation.json", ...(await stepFiles("cancelled"))].sort(),
  );
  expect(await files("unprepared")).toEqual(["admission.json"]);
  expect(await files("never-admitted")).toEqual([]);
});

test("caller IDs cannot address a path outside their own output home", async () => {
  const journal = new ActionJournal(join(dir, "journal.json"));
  await journal.admit(
    admission("../../outside"),
    async () => ({}),
    async () => null,
  );
  await settled(journal, "../../outside");
  expect((await journal.outputs("../../outside")).home).toMatch(/action-outputs[\\/][0-9a-f]{64}$/);
  expect(Object.keys((await journal.outputs("../../outside")).files)).toEqual([
    "admission.json",
    "preparation.json",
  ]);
});
