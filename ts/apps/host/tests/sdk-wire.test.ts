import { createHash } from "node:crypto";
import { contractSha256 } from "../../../packages/host-contracts/src/vendor/generated/pe-revit-wire.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { decodePeRevitPayload, isPeRevitEnvelope, parsePeRevitEnvelope } from "@pe/host-contracts/pe-revit-cli";
import { replay } from "./sdk-replay.ts";

test("runtime wire projection belongs to the pinned generated contract", () => {
  const contract = readFileSync(
    join(
      import.meta.dirname,
      "../../../packages/host-contracts/src/vendor/generated/pe-revit-contract.ts",
    ),
  );
  expect(
    createHash("sha256").update(contract.toString("utf8").replace(/\r\n/g, "\n")).digest("hex"),
  ).toBe(contractSha256);
});

const launch = { cmd: "recorded-sdk", args: [] };
const valid = () => JSON.parse(replay("doc-open", {}, "refused"));

test("recorded refusal survives production decoding without a test interceptor", () => {
  const stdout = replay("doc-open", {}, "refused");
  expect(parsePeRevitEnvelope(stdout, ["doc", "open"], launch)).toMatchObject({
    result: { state: "refused" },
  });
});

test("production refuses malformed nested wire fields and unknown discriminator cases", () => {
  for (const change of [
    (v: ReturnType<typeof valid>) => {
      v.binary.origin = "invented";
    },
    (v: ReturnType<typeof valid>) => {
      v.command.cwd = 12;
    },
    (v: ReturnType<typeof valid>) => {
      v.diagnostics = [{ code: "x", detail: 12, fix: null }];
    },
    (v: ReturnType<typeof valid>) => {
      v.resolved.pid = "71464";
    },
    (v: ReturnType<typeof valid>) => {
      delete v.binary.sha256;
    },
    (v: ReturnType<typeof valid>) => {
      v.exitCode = 0.5;
    },
  ]) {
    const value = valid();
    change(value);
    expect(isPeRevitEnvelope(value)).toBe(false);
  }
  for (const stdout of ["", "not json", "{}", "[]"])
    expect(() => parsePeRevitEnvelope(stdout, ["doc", "open"], launch)).toThrow();
});

// Preserve the captured frames; replay is deterministic transport evidence, never a native run.
test("recorded transport corpus remains independently inspectable", () => {
  const folder = join(import.meta.dirname, "sdk-envelopes");
  const rejected = readdirSync(folder).filter(
    (file) => !isPeRevitEnvelope(JSON.parse(readFileSync(join(folder, file), "utf8"))),
  );
  expect(rejected).toEqual([]);
});

// SDK Program.cs:317 and ServiceCommand.cs:133 use anonymous objects, not exported result DTOs.
test("anonymous SDK help and service payloads survive generated frame decoding", () => {
  for (const result of [
    { rootVerbs: [], verbs: [] },
    { appBase: "C:/example", services: [], locks: [] },
  ]) {
    const frame = { ...valid(), result };
    expect(isPeRevitEnvelope(frame)).toBe(true);
    expect(parsePeRevitEnvelope(JSON.stringify(frame), ["source-derived"], launch).result).toEqual(
      result,
    );
  }
});

// Mutate captured bytes independently of both the projection and replay's merge helper.
test("selected session contract decodes the recording and refuses nested hostile payloads", () => {
  const recording = readFileSync(join(import.meta.dirname, "sdk-envelopes/session-list.ok.json"), "utf8");
  const value = JSON.parse(recording);
  expect(decodePeRevitPayload("SessionListResult", value.result)).toEqual(value.result);
  for (const mutate of [
    (v: typeof value) => { v.result.sessions[0].case = "invented"; },
    (v: typeof value) => { v.result.sessions[0].process.pid = "71464"; },
    (v: typeof value) => { v.result.sessions[0].process.extraIdentity = "invented"; },
    (v: typeof value) => { v.result.sessions[0].process.processStartUtc = null; },
    (v: typeof value) => { v.result.sessions[0].receipt.payload = "foreign"; },
    (v: typeof value) => { v.result.sessions[0].bridge.documents[0].isModified = "false"; },
    (v: typeof value) => { delete v.result.sessions[0].shape.quarantine; },
    (v: typeof value) => { v.result.sessions[0].bridge.queue.depth = {}; },
    (v: typeof value) => { v.result.processReadErrors = [{ candidatePid: "42", detail: "unreadable", observedAtUtc: "now" }]; },
    (v: typeof value) => { v.result.sessions = null; },
    (v: typeof value) => { v.result.phase = "ready"; },
  ]) {
    const malformed = JSON.parse(recording);
    mutate(malformed);
    // A valid frame never pretends to validate its unknown result.
    expect(isPeRevitEnvelope(malformed)).toBe(true);
    expect(() => decodePeRevitPayload("SessionListResult", malformed.result)).toThrow(/SessionListResult/);
  }
});

// The decoder's return type comes from the generated named map, never a consumer's assertion.
function selectedPayloadType(value: unknown) {
  const decoded = decodePeRevitPayload("SessionListResult", value);
  const sessions: import("@pe/host-contracts/pe-revit-contract").SessionListResult = decoded;
  // @ts-expect-error A consumer cannot ask this boundary to assert an arbitrary result type.
  decodePeRevitPayload<{ trusted: true }>("SessionListResult", value);
  // @ts-expect-error Unprojected DTOs have no runtime decoder.
  decodePeRevitPayload("OpReceiptResult", value);
  return sessions;
}
void selectedPayloadType;
