import { createHash } from "node:crypto";
import { contractSha256 } from "../../../packages/host-contracts/src/vendor/generated/pe-revit-wire.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { isPeRevitEnvelope, parsePeRevitEnvelope } from "@pe/host-contracts/pe-revit-cli";
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

// These captured bytes predate the pin. This corpus must expose incompatible evidence rather than
// silently upgrading recordings or claiming a native run happened during a deterministic test.
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
