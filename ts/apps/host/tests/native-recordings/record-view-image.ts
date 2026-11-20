// From ts/: node --import jiti/register apps/host/tests/native-recordings/record-view-image.ts
// Reuses the native recorder behind 753b8a44; the SDK owns and retires its fresh session.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { canonicalJson } from "@pe/host-internal/native-read";

const root = resolve(import.meta.dirname, "../../../../..");
const output = join(
  root,
  ".artifacts/runs/view-image-recording",
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
mkdirSync(output, { recursive: true });
const project = "dotnet/Pe.Revit.Tests/Pe.Revit.Tests.csproj";
const args = [
  "tool",
  "run",
  "pe-revit",
  "--",
  "test",
  "--project",
  project,
  "--filter",
  "Name~Record_lens_DTO_on_an_owned_project_copy",
  "--timeout-seconds",
  "900",
  "--json",
];
const env = {
  ...process.env,
  PE_NATIVE_FIXTURE_OUTPUT: output,
  PE_TOOLS_PRODUCT_HOME: join(output, "home"),
};
const sdk = (extra: string[]) =>
  execFileSync("dotnet", [...args, ...extra], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 32 * 1024 * 1024,
  });
writeFileSync(join(output, "plan.json"), sdk(["--plan"]));
execFileSync("python", [".agents/skills/slot.execute/machine.py", "admit", "revit-test"], {
  cwd: root,
  stdio: "inherit",
});
const receipt = sdk([]);
writeFileSync(join(output, "sdk.json"), receipt);
const envelope = JSON.parse(receipt);
assert.equal(envelope.result.outcome, "passed");
assert.equal(envelope.result.mode, "fresh");
const source = join(output, "image.json");
const bytes = readFileSync(source);
const image = JSON.parse(bytes.toString("utf8"));
assert(Array.isArray(image.marks), "native response must include marks");
assert(existsSync(image.filePath), "replay requires the native PNG");
assert.equal(readFileSync(image.filePath).length, image.byteSize);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const provenanceFile = join(import.meta.dirname, "provenance.json");
const provenance = JSON.parse(readFileSync(provenanceFile, "utf8"));
provenance["retained-view-image"] = {
  operation: "revit.context.view-image",
  source,
  sourceSha256: sha(bytes),
  pointer: "$",
  canonicalResponseSha256: sha(canonicalJson(image)),
  lane: "fresh",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  date: new Date().toISOString(),
  modelCopy: join(output, "lens-fixture-model.rvt"),
  modelCopySha256: sha(readFileSync(join(output, "lens-fixture-model.rvt"))),
  resultsFile: envelope.result.resultsFile,
  receipt: join(output, "sdk.json"),
  recorderSha256: sha(
    readFileSync(join(root, "dotnet/Pe.Revit.Tests/Proofs/NativeLensFixtureRecorder.cs")),
  ),
};
writeFileSync(join(import.meta.dirname, "retained-view-image.json"), JSON.stringify(image) + "\n");
const lensSource = join(output, "lens.json");
const lensBytes = readFileSync(lensSource);
const lens = JSON.parse(lensBytes.toString("utf8"));
provenance["fresh-revit.context.lens"] = {
  ...provenance["retained-view-image"],
  operation: lens.operation,
  source: lensSource,
  sourceSha256: sha(lensBytes),
  pointer: "response",
  canonicalResponseSha256: sha(canonicalJson(lens.response)),
  requestFile: "fresh-revit.context.lens-request.json",
};
writeFileSync(
  join(import.meta.dirname, "fresh-revit.context.lens.json"),
  JSON.stringify(lens.response) + "\n",
);
writeFileSync(
  join(import.meta.dirname, "fresh-revit.context.lens-request.json"),
  JSON.stringify(lens.request) + "\n",
);
writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + "\n");
console.log(
  `Recorded native response unchanged from ${source}; SDK receipt ${join(output, "sdk.json")}`,
);
