import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("node scripts/familyfoundry-monthly-host-proof.mjs --host <dev|url> --bridge-session-id <id> --document-path <disposable.rvt> --original-document-path <original.rvt> --artifact-dir <dir> [--repo-root <dir>] [--mode plan|apply-one --profile <source> --family-id <id>]");
  process.exit(0);
}

const repo = resolve(args["repo-root"] ?? process.cwd());
const output = resolve(required("artifact-dir"));
const host = required("host");
const session = required("bridge-session-id");
const documentPath = resolve(required("document-path"));
const originalDocumentPath = resolve(required("original-document-path"));
if (samePath(documentPath, originalDocumentPath)) throw new Error("The proof document must be a disposable copy, not the original.");
const mode = args.mode ?? "plan";
if (!new Set(["plan", "apply-one"]).has(mode)) throw new Error(`Unknown --mode '${mode}'.`);
if (mode === "apply-one") {
  required("profile");
  required("family-id");
}

mkdirSync(join(output, "requests"), { recursive: true });
mkdirSync(join(output, "responses"), { recursive: true });
const evidencePath = join(output, "monthly-host-proof.json");
const evidence = {
  schemaVersion: 1,
  status: "running",
  mode,
  requestedSession: session,
  startedAt: new Date().toISOString(),
  sourceCommit: git(["rev-parse", "HEAD"]),
  executionOptionsTransported: false,
  profiles: [],
};
checkpoint();

const context = hostCall("00-context", "revit.context.summary", {});
const active = context.response?.documents?.activeDocument;
if (!active || active.isFamilyDocument || active.isReadOnly || active.isModifiable || !samePath(active.path ?? "", documentPath))
  fail(`Active document must be an unmodifiable, writable project copy; got ${JSON.stringify(active)}`);
evidence.document = active;
checkpoint();

const converted = convertProfiles();
if (!Array.isArray(converted.profiles) || converted.profiles.length !== 45)
  fail(`Expected 45 converted profile rows, got ${converted.profiles?.length ?? "none"}.`);

for (const [index, profile] of converted.profiles.entries()) {
  const row = { source: profile.source, conversion: profile.error ? "failed" : "converted", executionOptions: profile.executionOptions, plan: null };
  evidence.profiles.push(row);
  if (profile.error) row.error = profile.error;
  else {
    try {
      row.plan = hostCall(`${pad(index + 1)}-plan`, "familyfoundry.plan", { patchJson: profile.patchJson }).response;
      row.patchSha256 = sha(profile.patchJson);
      row.selectedCount = row.plan.families?.length ?? 0;
    } catch (error) {
      row.error = String(error.stack ?? error);
    }
  }
  checkpoint();
}

if (mode === "apply-one") applyOne(converted.profiles);
evidence.status = evidence.profiles.some((row) => row.error) ? "failed" : "completed";
evidence.finishedAt = new Date().toISOString();
checkpoint();
if (evidence.status !== "completed") process.exitCode = 1;

function applyOne(profiles) {
  const source = args.profile;
  const familyId = Number(args["family-id"]);
  if (!Number.isSafeInteger(familyId)) fail("--family-id must be an integer.");
  const converted = profiles.find((profile) => profile.source === source);
  const planned = evidence.profiles.find((profile) => profile.source === source);
  if (!converted || converted.error) fail(`Profile '${source}' did not convert.`);
  const selected = planned?.plan?.families?.find((family) => family.familyId === familyId);
  if (!selected) fail(`Family ${familyId} is not selected by '${source}'.`);
  if (!selected.planHash || selected.refusals?.length) fail(`Family ${familyId} has no applicable clean plan hash.`);

  const run = { source, requestedFamilyId: familyId, status: "starting" };
  evidence.applyOne = run;
  checkpoint();
  run.before = hostCall("90-before", "familyfoundry.project", { familyIds: [familyId] }).response;
  checkpoint();

  let applied;
  try {
    applied = hostCall("91-apply", "familyfoundry.apply", { patchJson: converted.patchJson, expectedPlanHashes: { [familyId]: selected.planHash } });
  } catch (error) {
    run.status = "outcomeUnknown";
    run.error = String(error.stack ?? error);
    checkpoint();
    throw new Error("Apply transport outcome is unknown; retry is blocked. Inspect 91-apply command evidence.");
  }
  run.apply = applied.response;
  const receipt = applied.response?.receipts?.[0];
  if (!receipt) {
    run.status = "outcomeUnknown";
    checkpoint();
    throw new Error("Apply returned no family receipt; retry is blocked.");
  }
  run.authoritativeFamilyId = receipt.familyId;
  checkpoint();

  run.after = hostCall("92-after", "familyfoundry.project", { familyIds: [receipt.familyId] }).response;
  if (!receipt.success || !receipt.converged) {
    run.status = "failed";
    run.rollbackModelJsonEqual = modelJson(run.before, familyId) === modelJson(run.after, receipt.familyId);
    checkpoint();
    return;
  }

  const noop = hostCall("93-noop-plan", "familyfoundry.plan", { patchJson: converted.patchJson, familyId: receipt.familyId }).response;
  run.noopPlan = noop;
  const family = noop.families?.[0];
  if (!family || family.changes?.length || family.refusals?.length) fail("Post-apply plan is not a no-change plan.");
  let repeated;
  try {
    repeated = hostCall("94-noop-apply", "familyfoundry.apply", { patchJson: converted.patchJson, expectedPlanHashes: { [receipt.familyId]: family.planHash } }).response;
  } catch (error) {
    run.status = "outcomeUnknown";
    run.error = String(error.stack ?? error);
    checkpoint();
    throw new Error("No-change reapply transport outcome is unknown; retry is blocked.");
  }
  run.repeat = repeated;
  const repeatReceipt = repeated.receipts?.[0];
  if (!repeatReceipt?.success || !repeatReceipt.converged) fail("No-change reapply did not converge.");
  run.final = hostCall("95-final", "familyfoundry.project", { familyIds: [repeatReceipt.familyId] }).response;
  run.finalPlan = hostCall("96-final-plan", "familyfoundry.plan", { patchJson: converted.patchJson, familyId: repeatReceipt.familyId }).response;
  run.status = run.finalPlan.families?.[0]?.changes?.length === 0 ? "completed" : "failed";
  checkpoint();
}

function convertProfiles() {
  const profilePath = join(repo, "source", "Pe.Revit.Tests", "Fixtures", "Profiles", "company-composed-20260906.json");
  const definitionsPath = join(repo, "source", "Pe.Revit.Tests", "Fixtures", "Profiles", "normalization-company-definitions.json");
  const scriptPath = join(output, "convert-company-profiles.cs");
  writeFileSync(scriptPath, conversionScript(profilePath, definitionsPath));
  const result = pea(["script", "execute", "--host", host, "--bridge-session-id", session, "--file", scriptPath, "--permission-mode", "ReadOnly", "--timeout-seconds", "600"], "conversion");
  const marker = "data      ";
  const offset = result.stdout.indexOf(marker);
  if (offset < 0) fail("Pea conversion script returned no structured data.");
  return JSON.parse(result.stdout.slice(offset + marker.length));
}

function hostCall(label, key, request) {
  writeJson(join(output, "requests", `${label}.json`), { key, request, bridgeSessionId: session });
  const result = pea(["host", "operations", "call", "--host", host, "--bridgeSessionId", session, "--key", key, "--request", JSON.stringify(request), "--verbosity", "compact"], label);
  const envelope = JSON.parse(result.stdout);
  writeJson(join(output, "responses", `${label}.json`), envelope);
  if (!envelope.ok) throw new Error(`${key}: ${envelope.message ?? "Host operation failed"}`);
  if (envelope.resolvedTarget?.session !== session)
    throw new Error(`${key}: target mismatch; requested '${session}', resolved '${envelope.resolvedTarget?.session ?? "none"}'.`);
  return envelope;
}

function pea(commandArgs, label) {
  const result = spawnSync(args.runner ?? "vp", ["run", "@pe/pea#pea", "--", ...commandArgs], {
    cwd: join(repo, "source", "pe-tools"), encoding: "utf8", timeout: 15 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, shell: false,
  });
  writeFileSync(join(output, "responses", `${label}.stdout.txt`), result.stdout ?? "");
  writeFileSync(join(output, "responses", `${label}.stderr.txt`), result.stderr ?? "");
  if (result.error || result.status !== 0) throw result.error ?? new Error(`pea exited ${result.status}: ${result.stderr}`);
  return result;
}

function conversionScript(profilePath, definitionsPath) {
  const literal = (value) => `@"${resolve(value).replaceAll('"', '""')}"`;
  return `using Newtonsoft.Json;\nusing Newtonsoft.Json.Linq;\nusing Pe.Revit.FamilyFoundry.Apply;\nusing Pe.Revit.Global.Services.Aps;\nusing Pe.Shared.RevitData.Families;\nusing System.Collections.Generic;\nusing System.IO;\nusing System.Linq;\nif (doc == null || doc.IsFamilyDocument) throw new System.InvalidOperationException("Activate the disposable Old Template project copy.");\nvar profiles = JArray.Parse(File.ReadAllText(${literal(profilePath)})).OfType<JObject>().ToList();\nvar definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(${literal(definitionsPath)}))!;\nvar rows = new JArray();\nforeach (var profile in profiles) {\n  ct.ThrowIfCancellationRequested();\n  var row = new JObject { ["source"] = (string)profile["source"]! }; rows.Add(row);\n  try { var converted = FamilyProfileConverter.Convert((JObject)profile["settings"]!, definitions, doc.GetUnits()); row["patchJson"] = JsonConvert.SerializeObject(converted.Patch); row["executionOptions"] = JObject.FromObject(converted.Options); }\n  catch (System.Exception ex) { row["error"] = ex.ToString(); }\n}\nResult(new JObject { ["documentTitle"] = doc.Title, ["documentPath"] = doc.PathName, ["profiles"] = rows });\n`;
}

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i++) {
    const token = values[i];
    if (token === "--help" || token === "-h") parsed.help = true;
    else if (token.startsWith("--")) parsed[token.slice(2)] = values[++i];
    else throw new Error(`Unexpected argument '${token}'.`);
  }
  return parsed;
}
function required(name) { if (!args[name]) throw new Error(`Provide --${name}.`); return args[name]; }
function git(commandArgs) { const result = spawnSync("git", commandArgs, { cwd: repo, encoding: "utf8", shell: false }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim(); }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function samePath(left, right) { return resolve(left).toLowerCase() === resolve(right).toLowerCase(); }
function pad(value) { return String(value).padStart(2, "0"); }
function modelJson(response, id) { return response?.families?.find((family) => family.familyId === id)?.modelJson ?? null; }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function checkpoint() { writeJson(evidencePath, evidence); }
function fail(message) { evidence.status = "refused"; evidence.error = message; checkpoint(); throw new Error(message); }
