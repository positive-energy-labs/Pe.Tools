/**
 * Typegen: emit one TypeScript file with per-op request/response types, a
 * runtime key list, and a key→types map. The emitted file is CHECKED IN — it
 * is the compile-time contract artifact, committed like a lockfile.
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
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "../src/contracts/bridge-protocol.ts";

type CatalogEntry = {
  key: string;
  displayName?: string | null;
  intent: string;
  description: string;
  requestSchemaJson: string;
  responseSchemaJson: string;
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
  };
  constants = catalog.constants ?? {};
  operations = [...catalog.operations]
    .filter((op) => op.origin !== "host-local") // types are hand-authored, not generated from /ops
    .sort((a, b) => a.key.localeCompare(b.key));

  // No bridge ops means no live Revit session (the host still lists its host-local ops, which we
  // filtered out). That can't verify anything — hard fail; the offline lane is the generator.
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

const chunks: string[] = [
  "/* eslint-disable */",
  "// Generated by host-typegen from the bridge op catalog. Do not edit.",
  "// Regenerate: pnpm --filter @pe/host-contracts codegen        (offline, via pe-dev ops-catalog)",
  "// Drift gate: pnpm --filter @pe/host-contracts codegen:check  (offline, deterministic)",
  "// Live parity: pnpm --filter @pe/host-contracts codegen:verify-live -- --session <id>",
  "",
];
const mapEntries: string[] = [];

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
  chunks.push(
    `/** ${op.description} */`,
    `export namespace ${ns} {`,
    indent(`export namespace Req {\n${indent(requestTs.trim())}\n}`),
    indent(`export namespace Res {\n${indent(responseTs.trim())}\n}`),
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
  "/** Runtime key list matching HostOps — powers key guards without a metadata catalog. */",
  "export const hostOpKeys = [",
  ...operations.map((op) => `  "${op.key}",`),
  "] as const satisfies readonly (keyof HostOps)[];",
  "",
);

const output = chunks.join("\n");

if (checkMode) {
  // Windows checkouts may carry CRLF (git autocrlf); the contract is content, not EOLs.
  const existing =
    (await readFile(outPath, "utf8").catch(() => null))?.replaceAll("\r\n", "\n") ?? null;
  if (existing === output) {
    console.log(
      `host-ops types are in sync with ${catalogSource} (${operations.length} operations).`,
    );
    process.exit(0);
  }
  console.error(
    existing === null
      ? `${outPath} is missing. Run host-typegen without --check to generate it.`
      : `${outPath} is stale against the catalog at ${catalogSource}. Run \`pnpm codegen\` to regenerate, review, and commit.`,
  );
  process.exit(1);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, output, "utf8");
console.log(`Wrote ${operations.length} operations to ${outPath}`);
