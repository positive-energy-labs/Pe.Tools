import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import type { ActionStep } from "@pe/agent-contracts";
import { opResultArgv } from "@pe/host-contracts/pe-revit-contract";
import {
  nativeReceiptArgs,
  readNativeReceipt,
  readOriginalProcess,
} from "../src/native-receipts.ts";
import { originalProcess, sdkEnvelope, sdkSessions } from "./native-receipt-fixture.ts";

const step: ActionStep = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "takeoffs.partition",
  kind: "native",
  input: { zoneRegion: 1 },
  state: "unknown",
  error: "reply lost",
  status: 503,
};
test("original process freeze requires one exact bridge incarnation before native dispatch", async () => {
  expect(await readOriginalProcess(42, 1000, sdkSessions)).toEqual(originalProcess);
  await expect(readOriginalProcess(42, 1001, sdkSessions)).rejects.toThrow(/Cannot prove/);
  await expect(
    readOriginalProcess(42, 1000, async () =>
      sdkEnvelope({
        sessions: [
          { process: originalProcess },
          { process: { ...originalProcess, processStartUtc: "1970-01-01T00:00:01.0000001Z" } },
        ],
      }),
    ),
  ).rejects.toThrow(/Cannot prove/);
});
test("production SDK reader uses exact generated selector; mismatched or unresolved saved receipts never authorize replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-sdk-receipt-"));
  const file = join(dir, "sdk-envelope.json");
  const receipt = {
    requestId: step.id,
    key: step.key,
    pid: originalProcess.pid,
    processStartUtc: originalProcess.processStartUtc,
    verdict: "ok",
    responsePath: "recorded by SDK",
    startedUtc: originalProcess.processStartUtc,
    completedUtc: "1970-01-01T00:00:02.0000000Z",
  };
  const result = { state: "completed", requestId: step.id, receipt, response: { written: true } };
  const read = async (args: readonly string[]) => {
    const selector = {
      requestId: step.id,
      pid: originalProcess.pid,
      processStartUtc: originalProcess.processStartUtc,
      key: step.key,
    };
    expect(args).toEqual(opResultArgv(selector));
    expect(args).toContain(originalProcess.processStartUtc);
    return readFile(file, "utf8");
  };
  try {
    expect(nativeReceiptArgs(step.id, originalProcess, step.key)).toContain(
      String(originalProcess.pid),
    );
    await writeFile(file, sdkEnvelope(result));
    expect((await readNativeReceipt(step, originalProcess, read)).step).toMatchObject({
      id: step.id,
      state: "succeeded",
      result: { written: true },
    });
    for (const altered of [
      { ...result, requestId: "another-request" },
      ...[
        { requestId: "another-request" },
        { key: "takeoffs.adopt" },
        { pid: 43 },
        { processStartUtc: "1970-01-01T00:00:01.0000001Z" },
      ].map((patch) => ({ ...result, receipt: { ...receipt, ...patch } })),
      ...["pending", "unknown-request", "response-missing", "abandoned"].map((state) => ({
        ...result,
        state,
      })),
    ]) {
      await writeFile(file, sdkEnvelope(altered));
      expect((await readNativeReceipt(step, originalProcess, read)).step).toEqual(step);
    }
    await writeFile(
      file,
      sdkEnvelope({
        ...result,
        receipt: { ...receipt, verdict: "failed" },
        response: { error: "central unreachable", statusCode: 409 },
      }),
    );
    expect((await readNativeReceipt(step, originalProcess, read)).step).toEqual({
      id: step.id,
      key: step.key,
      kind: step.kind,
      input: step.input,
      state: "failed",
      error: "central unreachable",
      status: 409,
    });
    await writeFile(
      file,
      sdkEnvelope({
        ...result,
        receipt: { ...receipt, verdict: "rejected" },
        response: { error: "queue refusal", statusCode: 423, outcome: "RefusedQueueUnresponsive" },
      }),
    );
    expect((await readNativeReceipt(step, originalProcess, read)).step).toMatchObject({
      id: step.id,
      state: "failed",
      notDispatched: true,
    });
    await writeFile(
      file,
      sdkEnvelope({
        ...result,
        receipt: { ...receipt, verdict: "cancelled" },
        response: { error: "stopped at checkpoint", statusCode: 499 },
      }),
    );
    expect((await readNativeReceipt(step, originalProcess, read)).step).toMatchObject({
      id: step.id,
      state: "cancelled",
      error: "stopped at checkpoint",
      status: 499,
    });
    for (const altered of [
      { ...result, receipt: { ...receipt, verdict: "cancelled" }, response: undefined },
      {
        ...result,
        receipt: { ...receipt, verdict: "cancelled" },
        response: { error: "not cancellation", statusCode: 500 },
      },
      {
        ...result,
        receipt: { ...receipt, verdict: "cancelled", key: "takeoffs.adopt" },
        response: { error: "stopped", statusCode: 499 },
      },
    ]) {
      await writeFile(file, sdkEnvelope(altered));
      expect((await readNativeReceipt(step, originalProcess, read)).step).toEqual(step);
    }
    await writeFile(
      file,
      JSON.stringify({
        ...JSON.parse(sdkEnvelope(result)),
        result: {
          ...result,
          receipt: { ...receipt, verdict: "cancelled" },
          response: { error: "stopped", statusCode: 499 },
        },
        diagnostics: [{ code: "ambiguous", message: "ambiguous evidence" }],
      }),
    );
    expect((await readNativeReceipt(step, originalProcess, read)).step).toEqual(step);
    await writeFile(file, sdkEnvelope({ ...result, response: null }));
    expect((await readNativeReceipt(step, originalProcess, read)).step).toMatchObject({
      state: "succeeded",
      result: null,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
