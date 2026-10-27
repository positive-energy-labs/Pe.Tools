import { afterEach, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { ActionJournal } from "../src/action-journal.ts";
import { alignBootstrap } from "../src/bootstrap.ts";
import { replay } from "./e2-sdk-recordings.ts";
import { bootstrapAlignmentSchema } from "@pe/host-contracts/pe-api";
import { actionReceiptSchema } from "@pe/agent-contracts";
import { GENERATED_FROM } from "@pe/host-contracts/pe-revit-contract";

const folders: string[] = [];
afterEach(async () => {
  for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true });
});
const input = bootstrapAlignmentSchema.parse({
  id: "align-2025",
  year: "2025",
  confirmedVersion: GENERATED_FROM,
});
const human = { kind: "human", via: "local" } as const;
const installation = JSON.parse(replay("bootstrap-verify", {}, "missing")).result;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-bootstrap-"));
  folders.push(dir);
  const owner = new ActionJournal(join(dir, "actions.json"));
  const base = async (args: readonly string[]) => {
    if (args[0] === "version")
      return replay(
        "bootstrap-verify",
        { binary: { informationalVersion: GENERATED_FROM }, result: null, exitCode: 0 },
        "missing",
      );
    if (args[0] === "session")
      return replay("session-list", {
        result: { sessions: [], unreadableReceipts: [], processReadErrors: [] },
      });
    return replay(
      "bootstrap-verify",
      {
        binary: { informationalVersion: GENERATED_FROM },
        result: {
          verb: args[1],
          ok: true,
          actions: [
            {
              year: "2025",
              op: args[1] === "install" ? "copy" : "check",
              dest: installation.actions[0].dest,
              status: args[1] === "install" ? "installed" : "ok",
            },
          ],
        },
        exitCode: 0,
      },
      "missing",
    );
  };
  let read = base;
  const calls: Array<readonly string[]> = [];
  const sdk = Object.assign(
    async (args: readonly string[]) => {
      calls.push([...args]);
      return read(args);
    },
    {
      calls,
      base,
      respond(next: typeof base) {
        read = next;
      },
    },
  );
  return { owner, sdk };
}

test("alignment requires a human and confirmation of this host's exact SDK version", async () => {
  const { owner, sdk } = await fixture();
  await expect(alignBootstrap(input, { kind: "anonymous" }, owner, sdk)).rejects.toThrow("human");
  await expect(
    alignBootstrap({ ...input, confirmedVersion: "0.1.0-beta.1" }, human, owner, sdk),
  ).resolves.toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringContaining("Confirm this host's pinned SDK"),
  });
  expect(sdk.calls).toHaveLength(0);
});

test("alignment refuses an open foreign/observed Revit and names its year and pid", async () => {
  const { owner, sdk } = await fixture();
  sdk.respond(async (args) => (args[0] === "session" ? replay("session-list") : sdk.base(args)));
  const receipt = actionReceiptSchema.parse(await alignBootstrap(input, human, owner, sdk));
  expect(receipt).toMatchObject({
    state: "failed",
    error: expect.stringMatching(/Revit 2025.*71464/),
  });
  expect(sdk.calls.some((args) => args[0] === "bootstrap" && args[1] === "install")).toBe(false);
});

test("alignment installs only the chosen year's bootstrap and verifies it in one durable receipt", async () => {
  const { owner, sdk } = await fixture();
  const receipt = actionReceiptSchema.parse(await alignBootstrap(input, human, owner, sdk));
  expect(receipt).toMatchObject({
    state: "succeeded",
    key: "machine.bootstrap",
    result: { year: "2025", sdkVersion: GENERATED_FROM },
  });
  expect(sdk.calls).toEqual([
    ["bootstrap", "verify", "--year", "2025", "--json"],
    ["version", "--json"],
    ["session", "list", "--all", "--json"],
    ["version", "--json"],
    ["session", "list", "--all", "--json"],
    ["bootstrap", "verify", "--year", "2025", "--json"],
    ["bootstrap", "install", "--year", "2025", "--json"],
    ["bootstrap", "verify", "--year", "2025", "--json"],
  ]);
  expect((await owner.list()).find((row) => row.id === input.id)).toMatchObject({
    state: "succeeded",
    effects: [{ kind: "directory", path: win32.dirname(installation.actions[0].dest) }],
    prepared: {
      state: "ready",
      value: {
        installation: { year: "2025", directory: win32.dirname(installation.actions[0].dest) },
      },
    },
  });
  const calls = sdk.calls.length;
  sdk.respond(async () => {
    throw Error("A duplicate command must not consult the current SDK");
  });
  expect(await alignBootstrap(input, human, owner, sdk)).toEqual(receipt);
  await expect(alignBootstrap({ ...input, year: "2026" }, human, owner, sdk)).rejects.toThrow(
    "conflicts",
  );
  expect(sdk.calls).toHaveLength(calls);
});

test("an unreadable machine census refuses; absence of known rows is not proof of no Revit", async () => {
  const { owner, sdk } = await fixture();
  const base = sdk.base;
  sdk.respond(async (args) =>
    args[0] === "session"
      ? replay("session-list", {
          result: {
            sessions: [],
            processReadErrors: [
              { candidatePid: 9, detail: "denied", observedAtUtc: new Date().toISOString() },
            ],
          },
        })
      : base(args),
  );
  expect(await alignBootstrap(input, human, owner, sdk)).toMatchObject({
    state: "failed",
    error: expect.stringContaining("census"),
  });
  expect(sdk.calls.some((args) => args[0] === "bootstrap" && args[1] === "install")).toBe(false);
});

test("a Revit that appears after confirmation still refuses before installation", async () => {
  const { owner, sdk } = await fixture();
  const base = sdk.base;
  let censuses = 0;
  sdk.respond(async (args) =>
    args[0] === "session" && ++censuses === 2 ? replay("session-list") : base(args),
  );
  expect(await alignBootstrap(input, human, owner, sdk)).toMatchObject({
    state: "failed",
    error: expect.stringContaining("Close every Revit"),
  });
  expect(sdk.calls.some((args) => args[0] === "bootstrap" && args[1] === "install")).toBe(false);
});

test("an SDK journal failure still names an open Revit and blocks installation", async () => {
  const { owner, sdk } = await fixture();
  const base = sdk.base;
  const {
    process,
    bridge: _bridge,
    dialogs: _dialogs,
    receipt: _receipt,
    detail: _detail,
    ...row
  } = JSON.parse(replay("session-list")).result.sessions[0];
  const failed = {
    ...row,
    case: "failed-receipt",
    failure: {
      source: "journal",
      process,
      event: "startup-failed",
      message: "payload failed",
      journalFile: "fixture.events.jsonl",
    },
  };
  sdk.respond(async (args) =>
    args[0] === "session" ? replay("session-list", { result: { sessions: [failed] } }) : base(args),
  );
  expect(await alignBootstrap(input, human, owner, sdk)).toMatchObject({
    state: "failed",
    error: expect.stringContaining(`pid ${process.pid}`),
  });
  expect(sdk.calls.some((args) => args[0] === "bootstrap" && args[1] === "install")).toBe(false);
});

test("the answering SDK must match the host pin, and a failed verification never reports success", async () => {
  const { owner, sdk } = await fixture();
  const base = sdk.base;
  sdk.respond(async (args) =>
    args[0] === "version"
      ? replay(
          "bootstrap-verify",
          { binary: { informationalVersion: "0.1.0-beta.208+other" }, result: null, exitCode: 0 },
          "missing",
        )
      : base(args),
  );
  expect(await alignBootstrap(input, human, owner, sdk)).toMatchObject({
    state: "failed",
    error: expect.stringContaining("answering SDK"),
  });
  expect(sdk.calls).toHaveLength(2);
  let verifies = 0;
  sdk.respond(async (args) =>
    args[0] === "bootstrap" && args[1] === "verify" && ++verifies === 3
      ? replay("bootstrap-verify", {}, "missing")
      : base(args),
  );
  expect(
    await alignBootstrap({ ...input, id: "verify-failure" }, human, owner, sdk),
  ).not.toMatchObject({ state: "succeeded" });
});

test.each(["absent", "ambiguous", "wrong-year"] as const)(
  "bootstrap records refusal of a %s SDK destination without installation",
  async (shape) => {
    const { owner, sdk } = await fixture();
    sdk.respond(async (args) => {
      const body = JSON.parse(await sdk.base(args));
      if (args[0] === "bootstrap")
        body.result.actions =
          shape === "absent"
            ? []
            : shape === "ambiguous"
              ? [body.result.actions[0], body.result.actions[0]]
              : [{ ...body.result.actions[0], year: "2026" }];
      return JSON.stringify(body);
    });
    const refused = await alignBootstrap(input, human, owner, sdk);
    expect(refused).toMatchObject({
      state: "failed",
      notDispatched: true,
      error: expect.stringContaining("destination"),
    });
    expect(await owner.list()).toEqual([refused]);
    expect(sdk.calls.some((args) => args[1] === "install")).toBe(false);
  },
);

test("bootstrap refuses a changed SDK destination at the native boundary", async () => {
  const { owner, sdk } = await fixture();
  let verifies = 0;
  sdk.respond(async (args) => {
    const body = JSON.parse(await sdk.base(args));
    if (args[0] === "bootstrap" && args[1] === "verify" && ++verifies === 2) {
      body.result.addinsBase = "C:\\Changed\\Addins";
      body.result.actions[0].dest = "C:\\Changed\\Addins\\2025\\Sdk-owned-payload";
    }
    return JSON.stringify(body);
  });
  expect(await alignBootstrap(input, human, owner, sdk)).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringContaining("destination changed"),
  });
  expect(sdk.calls.some((args) => args[1] === "install")).toBe(false);
});
