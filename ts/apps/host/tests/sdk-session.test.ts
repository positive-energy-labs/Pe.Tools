import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { peRevitLauncher } from "../src/pe-revit-launch.ts";
import { resolveSdkSession } from "../src/sdk-session.ts";
import { RevitBridgeLive, type BridgeSessionView } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { sdkEnvelope, sdkResolved, sdkSessions } from "./native-receipt-fixture.ts";

const socket: BridgeSessionView = {
  connected: true,
  sessionId: "attachment",
  processId: 42,
  processStartUtcUnixMs: 1000,
};
const bridge = (sockets: BridgeSessionView[] = [socket]) => ({
  list: Effect.sync(() => sockets),
  snapshot: (id?: string) =>
    Effect.sync(() => sockets.find((s) => s.sessionId === id) ?? { connected: false }),
});

test.each([undefined, { id: "4242" }, { pid: 4242 }])(
  "SDK owns the ladder for %j; digits never become pid",
  async (selection) => {
    const calls: readonly string[][] = [];
    const read = async (args: readonly string[]) => {
      (calls as string[][]).push([...args]);
      return sdkSessions(args);
    };
    const selectedBridge = bridge([
      { ...socket, processId: selection && "pid" in selection ? selection.pid : socket.processId },
    ]);
    expect((await resolveSdkSession(selectedBridge, { session: selection }, read)).sessionId).toBe(
      "attachment",
    );
    expect(calls).toEqual([
      [
        "doc",
        "list",
        ...(selection
          ? "id" in selection
            ? ["--id", selection.id]
            : ["--pid", String(selection.pid)]
          : []),
        "--json",
      ],
    ]);
  },
);

test.each(["session.ambiguous", "session.no-match", "session.no-revit"])(
  "%s passes through with the complete SDK envelope",
  async (code) => {
    const envelope = {
      ...JSON.parse(sdkEnvelope({ state: "refused", candidates: ["a", "b"] })),
      exitCode: 3,
      diagnostics: [{ code, detail: "SDK's exact words", fix: "SDK's exact remedy" }],
      nextSteps: ["SDK next step"],
    };
    await expect(
      resolveSdkSession(bridge(), {}, async () => JSON.stringify(envelope)),
    ).rejects.toMatchObject({
      message: `${code}: SDK's exact words`,
      evidence: { notDispatched: true, result: envelope },
    });
  },
);

test.each([
  { pid: 43 },
  { processStartUtc: "1970-01-01T00:00:02Z" },
  { processStartUtc: null },
  { pid: null },
])("stale or incomplete SDK process %j has no socket fallback", async (patch) => {
  await expect(
    resolveSdkSession(bridge(), {}, async () =>
      sdkEnvelope({ state: "ok", documents: [] }, { ...sdkResolved, ...patch }),
    ),
  ).rejects.toMatchObject({ evidence: { notDispatched: true } });
});

test("two attachments for a process refuse; an unrelated last attachment never wins", async () => {
  await expect(
    resolveSdkSession(bridge([socket, { ...socket, sessionId: "duplicate" }]), {}, sdkSessions),
  ).rejects.toMatchObject({ message: expect.stringContaining("unique") });
  expect(
    (
      await resolveSdkSession(
        bridge([socket, { ...socket, sessionId: "last", processId: 99 }]),
        {},
        sdkSessions,
      )
    ).sessionId,
  ).toBe("attachment");
});

test.each(["", "not json", JSON.stringify({ result: { state: "ok" } })])(
  "malformed SDK output %j cannot resolve a socket",
  async (output) => {
    await expect(resolveSdkSession(bridge(), {}, async () => output)).rejects.toThrow(/pe-revit/);
  },
);

test("the held attachment is checked again after the SDK answers", async () => {
  const sockets = [socket];
  await expect(
    resolveSdkSession(bridge(sockets), { bridgeSessionId: socket.sessionId }, async (args) => {
      sockets.length = 0;
      return sdkSessions(args);
    }),
  ).rejects.toMatchObject({ evidence: { notDispatched: true } });
});

test("an exact product document uses its held pid and refuses a closed lifetime or SDK document id", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, target } = yield* connectTestBridge();
        const scope = { bridgeSessionId: target.session, openDocumentId: target.openId };
        const calls: string[][] = [];
        const read = async (args: readonly string[]) => {
          calls.push([...args]);
          return sdkSessions(args);
        };
        yield* Effect.promise(async () => {
          expect((await resolveSdkSession(bridge, scope, read)).sessionId).toBe(target.session);
          expect(calls).toEqual([["doc", "list", "--pid", "42", "--json"]]);
          await expect(
            resolveSdkSession(bridge, { ...scope, openDocumentId: "sdk-open-id" }, read),
          ).rejects.toMatchObject({
            message: expect.stringContaining("product document lifetime"),
          });
          await expect(
            resolveSdkSession(bridge, { ...scope, bridgeSessionId: "other" }, read),
          ).rejects.toMatchObject({ message: expect.stringContaining("exact bridge attachment") });
        });
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  ));

test("pinned SDK round trip refuses a missing name against isolated roots", async () => {
  const run = promisify(execFile);
  const root = await mkdtemp(join(tmpdir(), "pe-sdk-resolver-"));
  const launch = peRevitLauncher({
    lane: "dev",
    sourceRoot: checkoutRootFrom(import.meta.dirname)!,
  });
  try {
    const started = performance.now();
    await expect(
      resolveSdkSession(
        bridge(),
        { session: { id: "mcp-w1-missing-measurement" } },
        async (args) => {
          const result = await run(launch.cmd, [...launch.args, ...args], {
            cwd: launch.cwd,
            windowsHide: true,
            timeout: 20_000,
            env: {
              ...process.env,
              PE_REVIT_ADDINS_ROOT: join(root, "addins"),
              PE_SERVICE_STATE_ROOT: join(root, "services"),
              PE_SESSION_FILES_ROOT: join(root, "files"),
              PE_SESSION_REGISTRY_ROOT: join(root, "registry"),
            },
          }).catch((error: unknown) => {
            if (
              typeof error === "object" &&
              error !== null &&
              "stdout" in error &&
              typeof error.stdout === "string"
            )
              return { stdout: error.stdout };
            throw error;
          });
          return result.stdout;
        },
      ),
    ).rejects.toMatchObject({
      evidence: {
        notDispatched: true,
        result: { exitCode: 3, diagnostics: [{ code: "session.no-match" }] },
      },
    });
    process.stdout.write(
      `SDK_ISOLATED_REFUSAL_ROUND_TRIP_MS=${(performance.now() - started).toFixed(2)}\n`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
