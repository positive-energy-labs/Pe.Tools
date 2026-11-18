/**
 * Typegen: emit browser-safe operation contracts and a separate host-only runtime catalog.
 * Both generated files are checked in like lockfiles.
 *
 * Two catalog sources (VerbCatalog pattern — offline single source of truth,
 * live host as a verification pass):
 *   --catalog <file>   OFFLINE projection from `pe-dev ops-catalog` (default
 *                      generation + drift-gate lane; deterministic, no host).
 *   (no --catalog)     LIVE fetch from GET /ops of a running host, session-
 *                      targeted — the verify lane (codegen:verify-live): proves
 *                      a real session serves the same catalog the offline
 *                      projection generated from.
 *
 * Run (from packages/host-contracts):
 *   pnpm codegen                                # offline regenerate
 *   pnpm codegen:check                          # offline drift gate: exit 1 if stale
 *   pnpm codegen:verify-live -- --session <id>  # live parity check
 *   [--host http://127.0.0.1:5180] [--session <bridgeSessionId>] [--out <path>]
 */
import { compile } from "json-schema-to-typescript";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "../src/contracts/bridge-protocol.ts";
import { generateNativeEffect } from "./native-effect-generator.ts";

type CatalogEntry = {
  key: string;
  subject: string;
  touches: string;
  effect: string;
  cardinality: string;
  internal: boolean;
  displayName?: string | null;
  costTier: string;
  description: string;
  requestSchemaJson: string;
  responseSchemaJson: string;
  artifactSchemaJson?: string;
  // Host-local (TS-only) ops are listed in /ops for discovery but carry no schema JSON — their
  // types are hand-authored in operation-types.ts. Skip them here; the bridge is the type source.
  origin?: string;
};

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function pascalCase(key: string): string {
  return key
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : line))
    .join("\n");
}

// json-schema-to-typescript prefers the schema's root `title` (e.g. the C# type
// name) over the name argument; drop it so the root is always Request/Response.
function parseUntitled(schemaJson: string): Record<string, unknown> {
  const schema = JSON.parse(schemaJson) as Record<string, unknown>;
  delete schema.title;
  return schema;
}

const DEFAULT_OUT = resolve(import.meta.dirname, "../src/generated/host-ops.generated.ts");

const hostBase = argValue("--host", "http://127.0.0.1:5180");
const session = argValue("--session", "");
const outPath = argValue("--out", DEFAULT_OUT);
const catalogOutPath = resolve(dirname(outPath), "host-catalog.generated.ts");
const catalogPath = argValue("--catalog", "");
const checkMode = process.argv.includes("--check");

/** Contract constants: C# public consts, keyed by camel-cased class then field name. */
type CatalogConstants = Record<string, Record<string, unknown>>;

let catalogSource: string;
let operations: CatalogEntry[];
let constants: CatalogConstants = {};

if (catalogPath) {
  // Offline lane: the catalog file is `pe-dev ops-catalog` output. Deterministic — a missing
  // file or empty catalog is a hard failure, never a soft skip.
  catalogSource = catalogPath;
  const raw = await readFile(resolve(catalogPath), "utf8").catch(() => null);
  if (raw === null) {
    console.error(
      `host-typegen: catalog file ${catalogPath} is missing. Run \`pe-dev ops-catalog --out ${catalogPath}\` first.`,
    );
    process.exit(1);
  }
  const catalog = JSON.parse(raw) as { operations: CatalogEntry[]; constants?: CatalogConstants };
  operations = [...catalog.operations].sort((a, b) => a.key.localeCompare(b.key));
  constants = catalog.constants ?? {};
  if (operations.length === 0) {
    console.error(`host-typegen: catalog file ${catalogPath} contains no operations.`);
    process.exit(1);
  }
} else {
  // Live lane (codegen:verify-live): fetch a session-targeted catalog from a running host.
  const url = `${hostBase}/ops${session ? `?session=${encodeURIComponent(session)}` : ""}`;
  catalogSource = url;
  const response = await fetch(url, {
    headers: session ? { [HOST_RPC_BRIDGE_SESSION_HEADER]: session } : undefined,
  }).catch(() => null);
  if (!response || !response.ok) {
    const reason = response ? `${response.status} ${await response.text()}` : "host unreachable";
    console.error(`GET ${url} failed: ${reason}`);
    process.exit(1);
  }
  const catalog = (await response.json()) as {
    operations: CatalogEntry[];
    constants?: CatalogConstants;
    bridgeSessionId?: string;
    bridgeCatalogError?: string;
  };
  if (catalog.bridgeCatalogError) {
    console.error(
      `GET ${url} could not acquire a live bridge catalog: ${catalog.bridgeCatalogError}`,
    );
    process.exit(1);
  }
  constants = catalog.constants ?? {};
  operations = [...catalog.operations]
    .filter((op) => op.origin !== "host-local") // types are hand-authored, not generated from /ops
    .sort((a, b) => a.key.localeCompare(b.key));

  // Discovery may return generated rows without Revit; only an acquired bridge catalog verifies.
  if (operations.length === 0) {
    console.error(`GET ${url} returned no bridge operations (no live Revit session).`);
    process.exit(1);
  }

  // Verification is a contract assertion, not a status display. An untargeted host may select RRD
  // while the operator intends another session; accepting that catalog makes a wrong-lane check look
  // green.
  if (!session) {
    console.error(
      `host-typegen refused an untargeted live catalog from ${url}; pass --session <bridgeSessionId>.`,
    );
    process.exit(1);
  }
  if (catalog.bridgeSessionId !== session) {
    console.error(
      `host-typegen target mismatch: requested '${session}', host reported '${catalog.bridgeSessionId ?? "<missing>"}'.`,
    );
    process.exit(1);
  }
}

for (const op of operations) {
  for (const axis of ["subject", "touches", "effect"] as const) {
    if (op[axis].split(/,\s*/).includes("Unset"))
      throw new Error(`host-typegen: ${op.key}: ${axis} is Unset`);
  }
}

const banner = [
  "/* eslint-disable */",
  "// Generated by host-typegen from the bridge op catalog. Do not edit.",
  "// Regenerate: pnpm --filter @pe/host-contracts codegen        (offline, via pe-dev ops-catalog)",
  "// Drift gate: pnpm --filter @pe/host-contracts codegen:check  (offline, deterministic)",
  "// Live parity: pnpm --filter @pe/host-contracts codegen:verify-live -- --session <id>",
  "",
];
const chunks: string[] = [...banner];
const mapEntries: string[] = [];

// The native snapshot catalog owns fan words. Export both decoder values and aliases from it.
const snapshot = operations.find(op => op.key === "ducts.snapshot.walk");
if (!snapshot) throw new Error("Missing native duct snapshot vocabulary");
const vocabularySchema = JSON.parse(snapshot.responseSchemaJson);
for (const [name, valuesName] of [["DuctUnitKind", "DUCT_UNIT_KINDS"], ["FanBlockerKind", "FAN_BLOCKER_KINDS"]]) {
  const definition = vocabularySchema.definitions?.[name] ?? vocabularySchema.$defs?.[name];
  if (!definition?.enum?.length) throw new Error(`Missing native vocabulary ${name}`);
  chunks.push(`export const ${valuesName} = ${JSON.stringify(definition.enum)} as const;`,
    `export type ${name} = (typeof ${valuesName})[number];`, "");
}

for (const op of operations) {
  const ns = pascalCase(op.key);
  const requestTs = await compile(parseUntitled(op.requestSchemaJson), "Request", {
    bannerComment: "",
    additionalProperties: false,
  });
  const responseTs = await compile(parseUntitled(op.responseSchemaJson), "Response", {
    bannerComment: "",
    additionalProperties: false,
  });
  const artifactSchema = op.artifactSchemaJson ? JSON.parse(op.artifactSchemaJson) : null;
  const artifactTs = artifactSchema
    ? await compile(artifactSchema, artifactSchema.title ?? "Metadata", {
        bannerComment: "",
        additionalProperties: false,
      })
    : null;
  chunks.push(
    `/** ${op.description} */`,
    `export namespace ${ns} {`,
    indent(`export namespace Req {\n${indent(requestTs.trim())}\n}`),
    indent(`export namespace Res {\n${indent(responseTs.trim())}\n}`),
    ...(artifactTs ? [indent(`export namespace Artifact {\n${indent(artifactTs.trim())}\n}`)] : []),
    "}",
    "",
  );
  mapEntries.push(`  "${op.key}": { request: ${ns}.Req.Request; response: ${ns}.Res.Response };`);
}

for (const [name, fields] of Object.entries(constants).sort(([a], [b]) => a.localeCompare(b)))
  chunks.push(
    "/** Contract constants shared with C#; read these instead of re-typing the numbers. */",
    `export const ${name} = ${JSON.stringify(fields, null, 2)} as const;`,
    "",
  );

chunks.push(
  "/** Key → request/response types for every bridge op the generating session supported. */",
  "export interface HostOps {",
  ...mapEntries,
  "}",
  "",
  "/** Runtime key list matching HostOps. */",
  "export const hostOpKeys = [",
  ...operations.map((op) => `  "${op.key}",`),
  "] as const satisfies readonly (keyof HostOps)[];",
  "",
  "/** C# operation safety metadata. Unknown operations never inherit read permission. */",
  "export const hostOpSafety = {",
  ...operations.map(
    (op) =>
      `  ${JSON.stringify(op.key)}: ${JSON.stringify({ costTier: op.costTier, subject: op.subject, touches: op.touches, effect: op.effect, cardinality: op.cardinality, internal: op.internal })},`,
  ),
  "} as const satisfies Record<keyof HostOps, { costTier: string; subject: string; touches: string; effect: string; cardinality: string; internal: boolean }>;",
  "",
);

const output = chunks.join("\n");
const catalogOutput = [
  ...banner,
  "/** Host-only C# discovery metadata. Runtime availability is reported separately by the host. */",
  'import type { HostOperationDefinition } from "../contracts/operation-vocabulary.ts";',
  'type CatalogEntry = Omit<HostOperationDefinition, "intent" | "rollsBack" | "usesTransactions"> & { readonly requestSchemaJson: string; readonly responseSchemaJson: string; readonly description: string; readonly artifactSchemaJson?: string } & (',
  ...operations.map(
    (op) =>
      `  | { readonly key: ${JSON.stringify(op.key)}${op.artifactSchemaJson ? "; readonly artifactSchemaJson: string" : ""} }`,
  ),
  ");",
  `export const hostOpCatalog: readonly CatalogEntry[] = ${JSON.stringify(operations.map((op) => Object.fromEntries(Object.entries(op).filter(([key]) => !["intent", "rollsBack", "usesTransactions"].includes(key)))), null, 2)};`,
  "",
].join("\n");
const outputs = [
  [outPath, output],
  [catalogOutPath, catalogOutput],
  [resolve(dirname(outPath), "native-effect.generated.ts"), generateNativeEffect(operations)],
] as const;

if (checkMode) {
  // Windows checkouts may carry CRLF (git autocrlf); the contract is content, not EOLs.
  let stale = false;
  for (const [path, content] of outputs) {
    const existing =
      (await readFile(path, "utf8").catch(() => null))?.replaceAll("\r\n", "\n") ?? null;
    if (existing === content) continue;
    stale = true;
    console.error(
      existing === null
        ? `${path} is missing. Run host-typegen without --check to generate it.`
        : `${path} is stale against the catalog at ${catalogSource}. Run \`pnpm codegen\` to regenerate, review, and commit.`,
    );
  }
  if (stale) process.exit(1);
  console.log(
    `Host contracts and catalog are in sync with ${catalogSource} (${operations.length} operations).`,
  );
  regenerateCommandTable(true);
  process.exit(0);
}

for (const [path, content] of outputs) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  console.log(`Wrote ${operations.length} operations to ${path}`);
}
regenerateCommandTable(false);

function regenerateCommandTable(check: boolean) {
  // Custom outputs are isolated artifacts; only the checkout catalog refreshes its command table.
  if (resolve(outPath) !== DEFAULT_OUT) return;
  // A fresh process reads the just-written catalog, not this process's cached modules.
  const cwd = fileURLToPath(new URL("../../agent-contracts/", import.meta.url));
  const result = spawnSync(process.execPath,
    ["--import", "jiti/register", "scripts/command-axes.ts", ...(check ? ["--check"] : [])],
    { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
