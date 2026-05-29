import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { cli, define } from "gunshi";
import {
  createPeHostClient,
  defaultHostBaseUrl,
  defaultWorkspaceKey,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "./pe-host.js";
import {
  HostLogTarget,
  PeHostClientError,
  ScriptExecutionSourceKind,
} from "./host-client.js";
import type {
  HostLogsData,
  HostProbeData,
  HostSessionSummaryData,
} from "./host-client.js";
import {
  hostProcessIdentity,
  peaCliIdentity,
  productIdentity,
} from "./generated/product.generated.js";
import { callHostOperation, searchHostOperations, type HostOperationCallResult } from "./host-operation-runtime.js";
import { ensurePeaRuntimeDefaults, getPeaRuntimeDefaultsSummary, type PeaRuntimeDefaultsSummary } from "./pea-runtime-defaults.js";

interface PeHostStatusSnapshot {
  probe: HostProbeData;
  sessionSummary: HostSessionSummaryData;
}

interface PeaPayloadManifest {
  schemaVersion: number;
  productName: string;
  payloadName: string;
  version: string;
  archiveFileName: string;
  sha256: string;
  sizeBytes: number;
  createdUtc: string;
  commitSha?: string | null;
}

const commonArgs = {
  host: {
    type: "string",
    description: "Pe.Host base URL.",
    default: resolveHostBaseUrl(),
  },
  workspace: {
    type: "string",
    description: "Pe scripting workspace key.",
    default: resolveWorkspaceKey(),
  },
} as const;

const agentCommand = define({
  name: "agent",
  description: "Start the Pe Agent TUI.",
  args: {
    ...commonArgs,
    workspaceRoot: {
      type: "string",
      description: "Explicit agent cwd override. Defaults to the product home returned by Pe.Host bootstrap.",
    },
  },
  toKebab: true,
  examples: [
    "pea agent",
    "pea agent --workspace default",
    "pea agent --workspace-root C:\\Users\\you\\Documents\\Pe.Tools\\workspaces\\default",
  ].join("\n"),
  run: async (ctx) => {
    const { runPeAgent } = await import("./agent.js");
    await runPeAgent({
      hostBaseUrl: ctx.values.host,
      workspaceKey: ctx.values.workspace,
      workspaceRoot: ctx.values.workspaceRoot,
    });
  },
});

const hostStatusCommand = define({
  name: "status",
  description: "Print Pe.Host, Revit session, and agent environment locations.",
  args: {
    host: commonArgs.host,
    workspace: commonArgs.workspace,
    json: {
      type: "boolean",
      description: "Print the raw host status DTO as JSON.",
      default: false,
    },
  },
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const status = await getHostStatus(hostBaseUrl);
    if (ctx.values.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    writeStatus(status);
  },
});

const hostLogsCommand = define({
  name: "logs",
  description: "Print Pe.Host/Revit logs through the generated TypeScript host client.",
  args: {
    host: commonArgs.host,
    target: {
      type: "string",
      description: "Log target: host, revit, or all.",
      default: "all",
    },
    tail: {
      type: "number",
      description: "Number of lines to print per log file.",
      default: 200,
    },
    json: {
      type: "boolean",
      description: "Print the raw host logs DTO as JSON.",
      default: false,
    },
  },
  examples: ["pea host logs", "pea host logs --target revit --tail 50"].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const logs = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).host.getLogs({
        target: parseLogTarget(ctx.values.target),
        tailLineCount: ctx.values.tail,
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(logs, null, 2));
      return;
    }

    writeLogs(logs);
  },
});

const operationSearchArgs = {
  query: {
    type: "string",
    description: "Optional search query.",
  },
  domain: {
    type: "string",
    description: "Optional exact top-level domain filter, such as revit, host, settings, script, or aps.",
  },
  intent: {
    type: "string",
    description: "Optional intent filter: Read or Mutate.",
  },
  limit: {
    type: "number",
    description: "Maximum operations to print. Compact output is capped lower than full output.",
    default: 8,
  },
  verbosity: {
    type: "string",
    description: "Output size: compact, hints, or full. Use full with --json only when full shapes/routes are needed.",
    default: "compact",
  },
  json: {
    type: "boolean",
    description: "Print operation search results as JSON.",
    default: false,
  },
} as const;

function runOperationSearch(values: {
  query?: string;
  domain?: string;
  intent?: string;
  limit?: number;
  verbosity?: string;
  json?: boolean;
}): void {
  const results = searchHostOperations({
    query: values.query,
    domain: values.domain,
    intent: parseOperationIntent(values.intent),
    limit: values.limit,
    verbosity: parseOperationVerbosity(values.verbosity),
  });
  if (values.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  writeOperationSearchResults(results);
}

const hostOperationsCommand = define({
  name: "operations",
  description: "List generated public Pe.Host operations available to the agent, including layer/domain/cost/result-grain metadata.",
  args: operationSearchArgs,
  examples: [
    "pea host operations",
    "pea host operations --query \"loaded families\"",
    "pea host operations --domain revit --intent Read",
  ].join("\n"),
  run: (ctx) => runOperationSearch(ctx.values),
});

const hostOperationSearchCommand = define({
  name: "search",
  description: "Search generated public Pe.Host operations by user intent and operation metadata.",
  args: operationSearchArgs,
  examples: [
    "pea host operation search --query \"this view\"",
    "pea host operation search --query \"parameter presence\" --json",
  ].join("\n"),
  run: (ctx) => runOperationSearch(ctx.values),
});

const hostOperationCallCommand = define({
  name: "call",
  description: "Call a generated public Pe.Host operation by key with JSON request data.",
  args: {
    host: commonArgs.host,
    key: {
      type: "string",
      description: "Host operation key, such as revit.context.summary, revit.resolve.references, or settings.document.validate.",
    },
    requestJson: {
      type: "string",
      description: "JSON request object. Omit for NoRequest operations.",
    },
    verbosity: {
      type: "string",
      description: "Successful-call metadata size: compact, hints, or full. Failures always include full metadata.",
      default: "compact",
    },
    json: {
      type: "boolean",
      description: "Print the raw call result as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea host operation call --key revit.context.summary --json",
    "pea host operation call --key revit.resolve.references --request-json '{\"referenceText\":\"this view\",\"maxResults\":5}' --json",
  ].join("\n"),
  run: async (ctx) => {
    if (!ctx.values.key)
      throw new Error("Provide --key <operation-key>.");

    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const result = await callHostOperation(
      { baseUrl: hostBaseUrl },
      ctx.values.key,
      parseRequestJson(ctx.values.requestJson),
      parseOperationVerbosity(ctx.values.verbosity),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok)
        process.exitCode = 1;
      return;
    }

    writeOperationCallResult(result);
    if (!result.ok)
      process.exitCode = 1;
  },
});

const hostOperationCommand = define({
  name: "operation",
  description: "Search and call generated public Pe.Host operations.",
  examples: [
    "pea host operation search --query \"schedule fields\"",
    "pea host operation call --key revit.context.summary --json",
  ].join("\n"),
  subCommands: {
    search: hostOperationSearchCommand,
    call: hostOperationCallCommand,
  },
  run: () => {
    console.log("Run `pea host operation --help` to list operation commands.");
  },
});

const hostCommand = define({
  name: "host",
  description: "Inspect Pe.Host state.",
  examples: [
    "pea host status",
    "pea host logs --target revit --tail 50",
    "pea host operations --query \"active document\"",
  ].join("\n"),
  subCommands: {
    status: hostStatusCommand,
    logs: hostLogsCommand,
    operations: hostOperationsCommand,
    operation: hostOperationCommand,
  },
  run: () => {
    console.log("Run `pea host --help` to list host commands.");
  },
});

const scriptExecuteCommand = define({
  name: "execute",
  description: "Execute a C# Revit script through Pe.Host.",
  args: {
    ...commonArgs,
    file: {
      type: "string",
      description: "Read inline script content from a local file.",
    },
    stdin: {
      type: "boolean",
      description: "Read inline script content from stdin.",
      default: false,
    },
    scriptContent: {
      type: "string",
      description: "Inline script content to execute.",
    },
    sourcePath: {
      type: "string",
      description: "Workspace-relative source path to execute.",
    },
    sourceName: {
      type: "string",
      description: "Display name for inline source content.",
      default: "AgentSnippet.cs",
    },
    json: {
      type: "boolean",
      description: "Print the raw execution DTO as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea script execute --file scratch\\Probe.cs",
    "pea script execute --source-path src\\SampleScript.cs",
    "Get-Content .\\Probe.cs | pea script execute --stdin --source-name Probe.cs",
  ].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const scriptContent = await resolveScriptContent({
      file: ctx.values.file,
      stdin: ctx.values.stdin,
      scriptContent: ctx.values.scriptContent,
    });
    const isWorkspacePath = ctx.values.sourcePath != null && ctx.values.sourcePath.trim().length > 0;

    if (!scriptContent && !isWorkspacePath)
      throw new Error("Provide --file, --stdin, --script-content, or --source-path.");

    const result = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).scripting.execute({
        workspaceKey: ctx.values.workspace,
        sourceKind: isWorkspacePath
          ? ScriptExecutionSourceKind.WorkspacePath
          : ScriptExecutionSourceKind.InlineSnippet,
        sourcePath: ctx.values.sourcePath,
        scriptContent,
        sourceName: ctx.values.sourceName,
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`status    ${result.status}`);
    console.log(`execution ${result.executionId}`);
    console.log(`revit     ${result.revitVersion}`);
    if (result.containerTypeName)
      console.log(`container ${result.containerTypeName}`);
    if (result.output)
      console.log(result.output.trimEnd());
    for (const diagnostic of result.diagnostics)
      console.error(`${diagnostic.severity} ${diagnostic.stage}: ${diagnostic.message}`);
  },
});

const scriptBootstrapCommand = define({
  name: "bootstrap",
  description: "Create or update a Pe scripting workspace through Pe.Host.",
  args: {
    ...commonArgs,
    noSample: {
      type: "boolean",
      description: "Do not create the sample script file.",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the raw bootstrap DTO as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: ["pea script bootstrap", "pea script bootstrap --workspace default --no-sample"].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const bootstrap = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).scripting.bootstrapWorkspace({
        workspaceKey: ctx.values.workspace,
        createSampleScript: !ctx.values.noSample,
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(bootstrap, null, 2));
      return;
    }

    console.log(`workspace key ${bootstrap.workspaceKey}`);
    console.log(`product home ${bootstrap.productHomePath}`);
    console.log(`workspace    ${bootstrap.workspaceRootPath}`);
    console.log(`project      ${bootstrap.projectFilePath}`);
    console.log(`sample       ${bootstrap.sampleScriptPath}`);
  },
});

const scriptCommand = define({
  name: "script",
  description: "Bootstrap and execute Pe.Revit scripts through Pe.Host.",
  examples: [
    "pea script bootstrap",
    "pea script execute --source-path src\\SampleScript.cs",
  ].join("\n"),
  subCommands: {
    bootstrap: scriptBootstrapCommand,
    execute: scriptExecuteCommand,
  },
  run: () => {
    console.log("Run `pea script --help` to list script commands.");
  },
});

const runtimeStatusCommand = define({
  name: "status",
  description: "Print the installed pea runtime payload status.",
  args: {
    json: {
      type: "boolean",
      description: "Print runtime status as JSON.",
      default: false,
    },
  },
  run: async (ctx) => {
    const status = await getPeaRuntimeStatus();
    if (ctx.values.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log(`pea root  ${status.peaRoot}`);
    console.log(`active    ${status.activeVersion ?? "none"}`);
    console.log(`version   ${status.activeVersionRoot ?? "none"}`);
    console.log(`manifest  ${status.manifestPath ?? "none"}`);
  },
});

const runtimeUpdateCommand = define({
  name: "update",
  description: "Install and activate a versioned pea payload from a manifest path or URL.",
  args: {
    manifest: {
      type: "string",
      description: "Path or URL to a pea payload manifest.",
    },
  },
  run: async (ctx) => {
    if (!ctx.values.manifest)
      throw new Error("Provide --manifest <path-or-url>.");

    const result = await updatePeaRuntime(ctx.values.manifest);
    console.log(`installed ${result.version}`);
    console.log(`active    ${result.currentVersionPath}`);
  },
});

const runtimeCommand = define({
  name: "runtime",
  description: "Inspect or update the installed pea runtime payload.",
  examples: [
    "pea runtime status",
    "pea runtime update --manifest .\\Pe.Tools.pea.0.1.0.json",
  ].join("\n"),
  subCommands: {
    status: runtimeStatusCommand,
    update: runtimeUpdateCommand,
  },
  run: () => {
    console.log("Run `pea runtime --help` to list runtime commands.");
  },
});

const configDefaultsCommand = define({
  name: "defaults",
  description: "Print Pea-owned agent settings path and default model/runtime posture.",
  args: {
    ...commonArgs,
    workspaceRoot: {
      type: "string",
      description: "Explicit product/workbench root. Avoids asking Pe.Host to bootstrap the scripting workspace.",
    },
    write: {
      type: "boolean",
      description: "Seed/update the Pea-owned settings file before printing defaults.",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print defaults as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea config defaults",
    "pea config defaults --write",
    "pea config defaults --workspace-root C:\\Users\\you\\Documents\\Pe.Tools --json",
  ].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const workspaceKey = resolveWorkspaceKey(ctx.values.workspace);
    const productHomePath = await resolveProductHomeForConfig(
      hostBaseUrl,
      workspaceKey,
      ctx.values.workspaceRoot,
    );
    const summary = ctx.values.write
      ? await ensurePeaRuntimeDefaults(productHomePath)
      : getPeaRuntimeDefaultsSummary(productHomePath);

    if (ctx.values.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    writePeaDefaultsSummary(summary);
  },
});

const configCommand = define({
  name: "config",
  description: "Inspect Pea agent configuration paths and default posture.",
  examples: [
    "pea config defaults",
    "pea config defaults --write --json",
  ].join("\n"),
  subCommands: {
    defaults: configDefaultsCommand,
  },
  run: () => {
    console.log("Run `pea config --help` to list config commands.");
  },
});

const entryCommand = define({
  name: "pea",
  description: "Pe Agent command surface.",
  examples: [
    "pea agent",
    "pea host status",
    "pea host logs --target revit --tail 50",
    "pea runtime status",
    "pea script bootstrap --workspace default",
    "pea script execute --source-path src\\SampleScript.cs",
  ].join("\n"),
  run: () => {
    console.log("Run `pea --help` to list commands, or `pea agent` to start the Pe Agent TUI.");
  },
});

try {
  await cli(process.argv.slice(2), entryCommand, {
    name: "pea",
    version: "0.1.0",
    description: `Pe Agent command surface. Defaults: host=${defaultHostBaseUrl}, workspace=${defaultWorkspaceKey}.`,
    subCommands: {
      agent: agentCommand,
      config: configCommand,
      host: hostCommand,
      runtime: runtimeCommand,
      script: scriptCommand,
    },
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

async function resolveProductHomeForConfig(
  hostBaseUrl: string,
  workspaceKey: string,
  workspaceRoot: string | undefined,
): Promise<string> {
  if (workspaceRoot?.trim())
    return resolve(workspaceRoot.trim());

  const bootstrap = await callPeHost(
    hostBaseUrl,
    () => createPeHostClient(hostBaseUrl).scripting.bootstrapWorkspace({
      workspaceKey,
      createSampleScript: false,
    }),
  );
  return bootstrap.productHomePath;
}

function writePeaDefaultsSummary(summary: PeaRuntimeDefaultsSummary): void {
  console.log(`settings  ${summary.settingsPath}`);
  console.log(`pack      ${summary.modelPackId}`);
  console.log(`agent     ${summary.agentModelId}`);
  console.log(`fast      ${summary.fastModelId}`);
  console.log(`observer  ${summary.observerModelId}`);
  console.log(`reflector ${summary.reflectorModelId}`);
  console.log(`goal      judge=${summary.goalJudgeModelId} maxTurns=${summary.goalMaxTurns}`);
  console.log(`om        observe=${summary.observationThreshold} reflect=${summary.reflectionThreshold}`);
  console.log(`ui        theme=${summary.theme} quiet=${summary.quietMode} previewLines=${summary.quietModeMaxToolPreviewLines}`);
  console.log(`runtime   configDir=${summary.policy.configDir} mcpEnabled=${summary.policy.mcpEnabled}`);
  console.log(`cache     promptRequired=${summary.policy.promptCachingRequired} openaiResponsesHistoryCompat=${summary.policy.openAiResponsesHistoryCompatEnabled}`);
}

async function getPeaRuntimeStatus(): Promise<{
  peaRoot: string;
  currentVersionPath: string;
  activeVersion: string | null;
  activeVersionRoot: string | null;
  manifestPath: string | null;
}> {
  const peaRoot = resolvePeaRoot();
  const currentVersionPath = join(peaRoot, peaCliIdentity.currentVersionFileName);
  const activeVersion = await readOptionalText(currentVersionPath);
  const normalizedVersion = activeVersion?.trim() || null;
  const activeVersionRoot = normalizedVersion ? join(peaRoot, peaCliIdentity.versionsDirectoryName, normalizedVersion) : null;
  const manifestPath = activeVersionRoot ? join(activeVersionRoot, peaCliIdentity.payloadManifestFileName) : null;
  return {
    peaRoot,
    currentVersionPath,
    activeVersion: normalizedVersion,
    activeVersionRoot,
    manifestPath,
  };
}

async function updatePeaRuntime(manifestRef: string): Promise<{
  version: string;
  currentVersionPath: string;
}> {
  const peaRoot = resolvePeaRoot();
  const packagesRoot = join(peaRoot, peaCliIdentity.packagesDirectoryName);
  const versionsRoot = join(peaRoot, peaCliIdentity.versionsDirectoryName);
  await mkdir(packagesRoot, { recursive: true });
  await mkdir(versionsRoot, { recursive: true });

  const manifest = await readPayloadManifest(manifestRef);
  validatePayloadManifest(manifest);
  const archivePath = join(packagesRoot, manifest.archiveFileName);
  await stageArchive(manifestRef, manifest, archivePath);
  const actualSha256 = await computeSha256(archivePath);
  if (actualSha256.toLowerCase() !== manifest.sha256.toLowerCase())
    throw new Error(`Payload hash mismatch. Expected ${manifest.sha256}; actual ${actualSha256}.`);

  const versionRoot = join(versionsRoot, manifest.version);
  const tempRoot = `${versionRoot}.tmp-${process.pid}`;
  await rm(tempRoot, { recursive: true, force: true });
  await rm(versionRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  await extractZip(archivePath, tempRoot);
  await writeFile(join(tempRoot, peaCliIdentity.payloadManifestFileName), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  await rename(tempRoot, versionRoot);

  const currentVersionPath = join(peaRoot, peaCliIdentity.currentVersionFileName);
  const tempCurrentPath = `${currentVersionPath}.tmp`;
  await writeFile(tempCurrentPath, manifest.version, "utf-8");
  await rename(tempCurrentPath, currentVersionPath);

  return { version: manifest.version, currentVersionPath };
}

function resolvePeaRoot(): string {
  const mainPath = fileURLToPath(import.meta.url);
  const distRoot = dirname(mainPath);
  const versionRoot = dirname(distRoot);
  const versionsRoot = dirname(versionRoot);
  return dirname(versionsRoot);
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function readPayloadManifest(manifestRef: string): Promise<PeaPayloadManifest> {
  const text = isUrl(manifestRef)
    ? await fetchText(manifestRef)
    : await readFile(resolve(manifestRef), "utf-8");
  return JSON.parse(text) as PeaPayloadManifest;
}

function validatePayloadManifest(manifest: PeaPayloadManifest): void {
  if (manifest.schemaVersion !== peaCliIdentity.payloadManifestSchemaVersion)
    throw new Error(`Unsupported pea payload manifest schema ${manifest.schemaVersion}.`);
  if (manifest.productName !== productIdentity.productName)
    throw new Error(`Unsupported product '${manifest.productName}'.`);
  if (manifest.payloadName !== peaCliIdentity.directoryName)
    throw new Error(`Unsupported payload '${manifest.payloadName}'.`);
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(manifest.version))
    throw new Error(`Invalid payload version '${manifest.version}'.`);
  if (!/^[0-9a-f]{64}$/i.test(manifest.sha256))
    throw new Error("Payload manifest sha256 must be a 64-character hex string.");
}

async function stageArchive(
  manifestRef: string,
  manifest: PeaPayloadManifest,
  archivePath: string,
): Promise<void> {
  const archiveRef = isUrl(manifestRef)
    ? new URL(manifest.archiveFileName, manifestRef).toString()
    : resolve(dirname(resolve(manifestRef)), manifest.archiveFileName);
  if (isUrl(archiveRef)) {
    await downloadFile(archiveRef, archivePath);
    return;
  }

  const sourcePath = isAbsolute(archiveRef) ? archiveRef : resolve(archiveRef);
  await stat(sourcePath);
  await rm(archivePath, { force: true });
  await copyFile(sourcePath, archivePath);
}

async function computeSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function extractZip(archivePath: string, targetDirectory: string): Promise<void> {
  await runProcess("tar", ["-xf", archivePath, "-C", targetDirectory]);
}

async function runProcess(fileName: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(fileName, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0)
        resolvePromise();
      else
        reject(new Error(`${fileName} exited with code ${code}.`));
    });
  });
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function downloadFile(url: string, path: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path, buffer);
}

async function resolveScriptContent(options: {
  file?: string;
  stdin?: boolean;
  scriptContent?: string;
}): Promise<string | undefined> {
  const sources = [options.file, options.stdin ? "stdin" : undefined, options.scriptContent]
    .filter((value) => value != null && String(value).trim().length > 0);
  if (sources.length > 1)
    throw new Error("Provide only one of --file, --stdin, or --script-content.");

  if (options.file)
    return readFile(options.file, "utf-8");
  if (options.stdin)
    return readStdin();
  return options.scriptContent;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

async function getHostStatus(hostBaseUrl: string): Promise<PeHostStatusSnapshot> {
  return callPeHost(hostBaseUrl, async () => {
    const client = createPeHostClient(hostBaseUrl);
    const [probe, sessionSummary] = await Promise.all([
      client.host.getProbe(),
      client.host.getSessionSummary(),
    ]);
    return { probe, sessionSummary };
  });
}

function parseOperationIntent(value: string | undefined): "Read" | "Mutate" | undefined {
  if (!value)
    return undefined;

  switch (value.toLowerCase()) {
    case "read":
      return "Read";
    case "mutate":
    case "write":
      return "Mutate";
    default:
      throw new Error("Unknown operation intent. Expected Read or Mutate.");
  }
}

function parseOperationVerbosity(value: string | undefined): "compact" | "hints" | "full" {
  if (!value)
    return "compact";

  switch (value.toLowerCase()) {
    case "compact":
      return "compact";
    case "hints":
      return "hints";
    case "full":
      return "full";
    default:
      throw new Error("Unknown operation verbosity. Expected compact, hints, or full.");
  }
}

function parseRequestJson(value: string | undefined): unknown {
  if (!value || value.trim().length === 0)
    return undefined;

  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --request-json value: ${detail}`);
  }
}

function parseLogTarget(value: string): HostLogTarget {
  switch (value.toLowerCase()) {
    case "host":
      return HostLogTarget.Host;
    case "revit":
    case "app":
      return HostLogTarget.Revit;
    case "all":
    case "both":
      return HostLogTarget.All;
    default:
      throw new Error("Unknown log target. Expected host, revit, or all.");
  }
}

async function callPeHost<T>(hostBaseUrl: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof PeHostClientError)) {
      try {
        await ensurePeHostRunning(hostBaseUrl);
        return await action();
      } catch (retryError) {
        throw new Error(formatPeHostError(hostBaseUrl, retryError));
      }
    }

    throw new Error(formatPeHostError(hostBaseUrl, error));
  }
}

async function ensurePeHostRunning(hostBaseUrl: string): Promise<void> {
  try {
    await createPeHostClient(hostBaseUrl).host.getProbe();
    return;
  } catch (error) {
    if (error instanceof PeHostClientError)
      return;
  }

  const hostExecutablePath = await resolveHostExecutablePath();
  if (!hostExecutablePath)
    return;

  const child = spawn(hostExecutablePath, [], {
    cwd: dirname(hostExecutablePath),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 8000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await delay(250);
    try {
      await createPeHostClient(hostBaseUrl).host.getProbe();
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof PeHostClientError)
        return;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`Started Pe.Host from ${hostExecutablePath}, but it did not become reachable at ${hostBaseUrl} within 8 seconds. Last probe error: ${detail}`);
}

async function resolveHostExecutablePath(): Promise<string | null> {
  const candidates = [
    process.env[hostProcessIdentity.hostExecutablePathVariable],
    join(dirname(resolvePeaRoot()), hostProcessIdentity.directoryName, hostProcessIdentity.executableName),
  ].filter((value): value is string => value != null && value.trim().length > 0);

  for (const candidate of candidates) {
    try {
      const resolved = resolve(candidate);
      const fileStat = await stat(resolved);
      if (fileStat.isFile())
        return resolved;
    } catch {
    }
  }

  return null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function formatPeHostError(hostBaseUrl: string, error: unknown): string {
  if (error instanceof PeHostClientError) {
    if (error.status === 503)
      return [
        `Pe.Host is reachable at ${hostBaseUrl}, but Revit is not ready for this request.`,
        error.message,
        "Open Revit, connect the bridge, then retry.",
      ].filter(Boolean).join("\n");

    return `Pe.Host request failed at ${hostBaseUrl}: ${error.message}`;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return [
    `Pe.Host is not reachable at ${hostBaseUrl}.`,
    detail,
    "Check the Pe.Host install path, host logs, or pass --host <url>.",
  ].join("\n");
}

function writeOperationSearchResults(results: ReturnType<typeof searchHostOperations>): void {
  if (results.length === 0) {
    console.log("No host operations matched.");
    return;
  }

  for (const result of results) {
    console.log(`${result.key}`);
    console.log(`  ${result.summary}`);
    console.log(`  family=${result.family ?? "-"} layer=${result.revitLayer ?? "-"} domain=${result.domainNoun ?? "-"} grain=${result.resultGrain ?? "-"} cost=${result.costTier ?? "-"}`);
    console.log(`  request=${result.requestTypeName} response=${result.responseTypeName}`);
    console.log(`  hint ${result.requestHint}`);
    if (result.bestRequestExample) {
      console.log(`  example ${result.bestRequestExample.name}: ${result.bestRequestExample.description}`);
      console.log(`  json ${compactJsonLiteral(result.bestRequestExample.json)}`);
    }
    if ("executionMode" in result)
      console.log(`  mode=${result.intent} ${result.executionMode}${result.singleFlightGroup ? ` single-flight=${result.singleFlightGroup}` : ""}`);
    if ("verb" in result)
      console.log(`  route=${result.verb} ${result.route}`);
    for (const hint of result.preflightHints)
      console.log(`  preflight ${hint}`);
    if ("boundedExpansionHints" in result) {
      for (const hint of result.boundedExpansionHints)
        console.log(`  expand ${hint}`);
    }
  }
}

function compactJsonLiteral(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json.replace(/\s+/g, " ").trim();
  }
}

function writeOperationCallResult(result: HostOperationCallResult): void {
  console.log(`${result.key} ${result.ok ? "ok" : "failed"}`);
  if (!result.ok) {
    console.error(result.status ? `status ${result.status}: ${result.message}` : result.message);
    if (result.problem)
      console.error(JSON.stringify(result.problem, null, 2));
    if (result.bestRequestExample) {
      console.error(`example ${result.bestRequestExample.name}: ${result.bestRequestExample.description}`);
      console.error(`json ${compactJsonLiteral(result.bestRequestExample.json)}`);
    }
    for (const step of result.nextSteps)
      console.error(`next ${step}`);
    return;
  }

  if (result.operation)
    console.log(`operation ${result.operation.summary}`);
  console.log(JSON.stringify(result.response, null, 2));
}

function writeLogs(logs: HostLogsData): void {
  for (const file of logs.files) {
    console.log(`== ${file.label} log ==`);
    console.log(file.filePath);
    if (file.lines.length === 0)
      console.log("(empty)");
    else
      console.log(file.lines.join("\n"));
    console.log();
  }
}

function writeStatus(status: PeHostStatusSnapshot): void {
  console.log(`host      reachable`);
  console.log(`bridge    ${status.probe.bridgeIsConnected ? "connected" : "disconnected"}`);
  console.log(`transport ${status.probe.bridgePath}`);
  console.log(`contract  host=${status.probe.hostContractVersion} bridge=${status.probe.bridgeContractVersion}`);

  if (status.probe.disconnectReason)
    console.log(`reason    ${status.probe.disconnectReason}`);

  if (status.sessionSummary.bridgeIsConnected) {
    console.log(`session   ${status.sessionSummary.sessionId ?? "unknown"}`);
    console.log(`process   ${status.sessionSummary.processId ?? "unknown"}`);
    console.log(`revit     ${status.sessionSummary.revitVersion ?? "unknown"}`);
    console.log(`runtime   ${status.sessionSummary.runtimeFramework ?? "unknown"}`);
    console.log(`document  ${status.sessionSummary.activeDocument?.title ?? "none"}`);
    console.log(`open docs ${status.sessionSummary.openDocumentCount}`);
    console.log(`modules   ${status.sessionSummary.availableModules.length}`);
  }
}
