import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Deferred, Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import {
  BRIDGE_CONTRACT_VERSION,
  BRIDGE_PATH,
  DOCUMENT_IDENTITY_AUTHORITY,
  HOST_CONTEXT_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import type { DocumentInfo, SessionDocument } from "@pe/host-contracts/pe-revit-contract";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { makeHttpLive } from "../src/app.ts";
import { hostActionJournal } from "../src/gateway-owner.ts";
import { planAcquisition } from "../src/acquisition.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { originalProcess } from "./native-receipt-fixture.ts";
import { crossingOf } from "./callers.ts";

/**
 * A fake `pe-revit` binary: one SDK envelope per call, built from the JSON world file that
 * `PE_FAKE_SDK` names and re-read every call, so the test changes the world between requests.
 */
const fakeSdk = join(mkdtempSync(join(tmpdir(), "pe-fake-sdk-")), "pe-revit.mjs");
writeFileSync(
  fakeSdk,
  `import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const world = JSON.parse(readFileSync(process.env.PE_FAKE_SDK, "utf8"));
const args = process.argv.slice(2);
const [noun, verb] = args;
const out = noun === "doc" && verb === "save" && args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
// The SDK's own rule (DocCommand.NewOutput): --out names a new file in an existing folder.
if (out && !existsSync(dirname(out))) {
  process.stdout.write(JSON.stringify({ result: {}, resolved: null, diagnostics: [{ code: "doc.bad-invocation",
    detail: "--out parent directory does not exist: '" + dirname(out) + "'.", fix: null }], binary: {}, command: {},
    nextSteps: [], guide: "doc", related: [], exitCode: 2 }));
  process.exit(2);
}
if (out) writeFileSync(out, "saved result", { flag: "wx" });
const result =
  noun === "session" && verb === "list"
    ? { state: "ok", sessions: world.sessions, processReadErrors: [] }
    : noun === "doc" && verb === "list"
      ? { state: "ok", documents: args.includes("--holdings") ? null : world.documents }
      : noun === "doctor"
        ? { revitYears: ["2025"] }
        : { state: "ok" };
process.stdout.write(JSON.stringify({ result, resolved: noun === "doc" ? world.resolved : null,
  diagnostics: [], binary: {}, command: {}, nextSteps: [], guide: "op", related: [], exitCode: 0 }));
`,
);
vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [fakeSdk] }),
}));

type Facts = Partial<Pick<SessionDocument, "isWorkshared" | "isDetached">>;
const controlledId = "c".repeat(32);
const observedId = "d".repeat(32);

/**
 * Round 3 F1 (acceptance 2026-10-13): Pea's acquisition could never write, hand over or pin,
 * because the SDK beta.202 document read carried no native worksharing facts and the host's
 * doc-list parse dropped any it was given. Independence is certified only by a native fact read
 * through the SDK, isWorkshared false or isDetached true; an unread fact fails closed naming it,
 * and a workshared, attached document refuses (cloud and central acquisition are owed).
 *
 * This runs the real host: the SDK answers come from the fake `pe-revit` binary in beta.203's
 * shapes, Revit attaches over the real bridge socket, and handover goes through `/actions`.
 */
test("handover certifies Pea's acquisition only from native SDK document facts", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-host-independence-"));
  const world = join(localAppData, "sdk-world.json");
  const prev = { localAppData: process.env.LOCALAPPDATA, sdk: process.env.PE_FAKE_SDK };
  process.env.LOCALAPPDATA = localAppData;
  process.env.PE_FAKE_SDK = world;
  const now = new Date().toISOString();
  /** The SDK's world: one Revit, Pea's two acquired copies in it, each document with these facts. */
  const census = (custody: "controlled" | "observed", facts: Facts) => {
    const docs = [controlledId, observedId].map((openId) => ({
      openId,
      title: `${openId.slice(0, 4)}.rvt`,
      path: work[openId],
      isActive: false,
      isFamily: false,
      isModified: false,
      window: null,
      centralPath: null,
      isCloud: false,
      modelGuid: null,
      projectGuid: null,
      region: null,
      ...facts,
    }));
    const shape = {
      payload: "checkout",
      reload: "none",
      posture: "background",
      quarantine: false,
      purpose: "interactive",
    };
    const execution = { allowed: true, code: null, detail: null };
    writeFileSync(
      world,
      JSON.stringify({
        resolved: { pid: originalProcess.pid, processStartUtc: originalProcess.processStartUtc },
        documents: docs.map(
          (doc): Omit<SessionDocument, "isWorkshared" | "isDetached"> => ({
            ...doc,
            sessionId: "pea",
          }),
        ),
        sessions: [
          custody === "controlled"
            ? {
                case: "controlled-active",
                id: "pea",
                process: originalProcess,
                receipt: { receiptPath: join(localAppData, "pea.json") },
                shape,
                execution,
                observedAtUtc: now,
                year: 2025,
                bridge: {
                  bridge: "ready",
                  documents: docs.map(
                    (doc): Omit<DocumentInfo, "isWorkshared" | "isDetached"> => ({
                      ...doc,
                      persistence: null,
                      observedAtUtc: now,
                      supportedActions: null,
                      centralFreshnessAtObservation: null,
                    }),
                  ),
                  modal: null,
                  privateBytes: null,
                  queue: null,
                  sessionDescriptor: null,
                  unresponsive: false,
                },
              }
            : {
                case: "observed-active",
                process: originalProcess,
                execution,
                observedAtUtc: now,
                year: 2025,
                shape,
                bridge: { bridge: "missing-endpoint" },
              },
        ],
      }),
    );
  };
  // Two held acquisitions, as `instances.open` with into.start owner pea records them.
  const work: Record<string, string> = {};
  const planned: Record<string, { result: string; diffPlan: string }> = {};
  const journal = hostActionJournal();
  for (const [id, openId] of [
    ["acq-controlled", controlledId],
    ["acq-observed", observedId],
  ] as const) {
    const start = { year: "2025", owner: "pea", addins: "off" } as const;
    const launch = { source: "C:/Tower.rvt", into: { start } };
    const intent = planAcquisition(
      id,
      join(localAppData, "pea-work"),
      { kind: "create", year: "2025" },
      launch,
      false,
    );
    work[openId] = (intent.document!.origin as { work: string }).work;
    planned[id] = intent.document!;
    // The copy the acquisition's file steps made; its folder is the only one that exists.
    mkdirSync(dirname(work[openId]), { recursive: true });
    writeFileSync(work[openId], "work copy");
    const row = await journal.admit(
      {
        id,
        kind: "workflow",
        key: "instances.open",
        ...crossingOf("agent"),
        destination: { kind: "host" },
        input: launch,
        bases: {},
      },
      async () => ({ target: null, acquisition: intent }),
      async (execution) => {
        await execution.step("native", "instances.open.start", { argv: [] }, async () => ({
          session: { process: originalProcess },
        }));
        return execution.step("native", "instances.open", { argv: [] }, async () => ({
          document: { openId, path: work[openId] },
        }));
      },
    );
    expect((await journal.wait(row.id)).state).toBe("succeeded");
  }
  census("controlled", {});

  const latch = Effect.runSync(Deferred.make<void>());
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Deferred.make<ServiceHostHandle>();
        const HttpLive = makeHttpLive({
          capabilities: { revit: true },
          port: 0,
          lifecycle: { latch, handle },
          webRoot: null,
        });
        yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
      }),
    ),
  );
  let socket: WebSocket | undefined;
  try {
    let file = await readServiceFile(productRoot(), hostOwnership.serviceName);
    for (let i = 0; !file && i < 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      file = await readServiceFile(productRoot(), hostOwnership.serviceName);
    }
    const base = `http://127.0.0.1:${file!.port}`;
    // Pe.App in Pea's Revit attaches and attests the SDK's openIds.
    socket = new WebSocket(
      `${base.replace("http:", "ws:")}${BRIDGE_PATH}?${HOST_RUNTIME_SERVICE_QUERY}=${hostOwnership.serviceName}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", reject, { once: true });
    });
    const ack = new Promise<unknown>((resolve) =>
      socket!.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), {
        once: true,
      }),
    );
    socket.send(
      JSON.stringify({
        kind: "Registration",
        registration: {
          contractVersion: BRIDGE_CONTRACT_VERSION,
          processId: originalProcess.pid,
          processStartUtcUnixMs: Date.parse(originalProcess.processStartUtc),
          lane: hostOwnership.lane,
          sourceRoot: hostOwnership.sourceRoot,
          serviceName: hostOwnership.serviceName,
          state: {
            activeDocumentIsFamilyDocument: false,
            activeDocumentIsModelInCloud: false,
            activeDocumentIsWorkshared: false,
            activeDocumentObservedAtUnixMs: 1,
            hasActiveDocument: false,
            revitVersion: "independence",
            runtimeFramework: "test",
            runtimeAssemblies: [],
            documentIdentity: DOCUMENT_IDENTITY_AUTHORITY,
            openDocuments: [controlledId, observedId].map((openId) => ({
              openId,
              title: `${openId.slice(0, 4)}.rvt`,
              address: work[openId],
              isActive: false,
              isFamilyDocument: false,
            })),
          },
        },
      }),
    );
    expect(await ack).toMatchObject({ registrationAck: { accepted: true } });

    const terminal = readFileSync(hostContextTokenPath(hostOwnership.serviceName), "utf8");
    const handover = async (acquisition: string) => {
      const response = await fetch(`${base}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json", [HOST_CONTEXT_HEADER]: terminal },
        body: JSON.stringify({
          id: randomUUID(),
          kind: "workflow",
          key: "instances.handover",
          destination: { kind: "host" },
          input: { acquisition },
        }),
      });
      const body = (await response.json()) as {
        id?: string;
        refusal?: { code: string; reason: string };
      };
      return { status: response.status, refusal: body.refusal ?? null, id: body.id };
    };
    const refused = async (acquisition: string, fact: RegExp) => {
      const answer = await handover(acquisition);
      expect(answer.status, JSON.stringify(answer)).toBe(403);
      expect(answer.refusal?.code).toBe("acquisition.unproven");
      expect(answer.refusal?.reason).toMatch(fact);
    };

    for (const [custody, acquisition, certify] of [
      ["controlled", "acq-controlled", { isWorkshared: false, isDetached: false }],
      ["observed", "acq-observed", { isWorkshared: true, isDetached: true }],
    ] as const) {
      // beta.202's read: no fact at all. Unproven, naming the fact it lacks.
      census(custody, {});
      await refused(acquisition, /isWorkshared/);
      // The native read failed: null is unknown, never independent.
      census(custody, { isWorkshared: null, isDetached: null });
      await refused(acquisition, /isWorkshared/);
      census(custody, { isWorkshared: true, isDetached: null });
      await refused(acquisition, /isDetached/);
      // Workshared and attached: a central or cloud copy, refused until that acquisition exists.
      census(custody, { isWorkshared: true, isDetached: false });
      await refused(acquisition, /workshared and not detached/);
      // Certified: not workshared, or detached. Handover is admitted.
      census(custody, certify);
      const admitted = await handover(acquisition);
      expect(admitted.refusal, `${custody}: ${JSON.stringify(admitted)}`).toBeNull();
      expect(admitted.status).toBeLessThan(300);
      // An observed Revit is admitted here but never saved into: release needs a controlled row.
      if (custody === "observed") continue;
      // Acceptance R4b (d3aaaef1): the SDK refuses a save into a folder that does not exist, so
      // the host creates exactly the planned result folder, receipted, before it asks.
      const settled = await journal.wait(admitted.id!);
      expect(settled, JSON.stringify(settled)).toMatchObject({ state: "succeeded" });
      const plan = planned[acquisition]!;
      expect(settled.steps.map((step) => [step.key, step.state])).toEqual([
        ["acquisition.result-folder", "succeeded"],
        ["instances.handover.save", "succeeded"],
        ["acquisition.handover", "succeeded"],
      ]);
      expect(settled.steps[0]!.input).toEqual({ to: dirname(plan.result) });
      expect(readFileSync(plan.result, "utf8")).toBe("saved result");
      expect(existsSync(plan.diffPlan)).toBe(true);
    }
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    Effect.runSync(Deferred.succeed(latch, undefined));
    await done.catch(() => {});
    if (prev.localAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev.localAppData;
    if (prev.sdk === undefined) delete process.env.PE_FAKE_SDK;
    else process.env.PE_FAKE_SDK = prev.sdk;
    rmSync(localAppData, { recursive: true, force: true });
    rmSync(dirname(fakeSdk), { recursive: true, force: true });
  }
}, 60_000);
