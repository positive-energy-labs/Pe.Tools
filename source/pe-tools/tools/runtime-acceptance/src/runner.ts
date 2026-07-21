import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceFilePath } from "@pe/host-contracts/pe-service";
import { productRoot, sourceHostServiceName } from "@pe/host-contracts/service-identity";
import {
  acceptancePlan,
  isRecord,
  liveIdentity,
  parseSdkEnvelope,
  type AcceptanceProfile,
  type ProcessIdentity,
  type SdkEnvelope,
} from "./contract.ts";

export interface RunOptions {
  readonly profile: AcceptanceProfile;
  readonly year: number;
  readonly evidence?: string;
  readonly sdkRoot?: string;
  readonly allowDirty: boolean;
}

type GateResult = {
  id: string;
  passed: boolean;
  startedAtUtc: string;
  endedAtUtc: string;
  error?: string;
};
type CommandResult = { exitCode: number; stdout: string; stderr: string };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const addinProject = join(repoRoot, "source", "Pe.App", "Pe.App.csproj");
const testProject = join(repoRoot, "source", "Pe.Revit.Tests", "Pe.Revit.Tests.csproj");
const testFilter = "Name~Reports_runtime_assembly_load_paths";
type HostLane = "source" | "installed";
const sourceRoot = join(repoRoot, "source", "pe-tools");
const appBase = productRoot();
const serviceFiles: Record<HostLane, string> = {
  source: serviceFilePath(appBase, sourceHostServiceName(sourceRoot)),
  installed: serviceFilePath(appBase, "host"),
};
const installedShims = join(appBase, "shims");

export async function runAcceptance(options: RunOptions): Promise<void> {
  requireThat(
    Number.isInteger(options.year) && options.year >= 2023,
    "--year must be a Revit year",
  );
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const evidence = resolve(
    options.evidence ?? join(repoRoot, ".artifacts", "runtime-acceptance", runId),
  );
  const sdkRoot = resolve(options.sdkRoot ?? join(repoRoot, "..", "Pe.Revit.Sdk"));
  await mkdir(evidence, { recursive: true });
  await mkdir(evidenceTemp(evidence), { recursive: true });
  process.stderr.write(`runtime acceptance evidence: ${evidence}\n`);
  const state = new AcceptanceRun(options, evidence, sdkRoot, runId);
  try {
    if (options.profile === "showcase") await state.showcase();
    else await state.deterministic();
  } finally {
    await state.cleanupOwned();
    await state.writeVerdict();
  }
  process.stdout.write(`${join(evidence, "verdict.json")}\n`);
}

class AcceptanceRun {
  private readonly gates: GateResult[] = [];
  private readonly ownedSandboxes = new Set<string>();
  private readonly worktrees = new Set<string>();
  private baselineRrd?: ProcessIdentity;
  private sourceId?: string;
  private installedId?: string;
  private sourceCloseBaseline?: string;
  private failed = false;

  constructor(
    private readonly options: RunOptions,
    private readonly evidence: string,
    private readonly sdkRoot: string,
    private readonly runId: string,
  ) {}

  async deterministic(): Promise<void> {
    await this.gate("authority", () => this.authority());
    await this.gate("rrd-baseline", () => this.rrdBaseline());
    await this.gate("attached-and-fresh", () => this.attachedAndFresh());
    await this.gate("source-sandbox", () => this.sourceSandbox());
    await this.gate("installed-sandbox", () => this.installedSandbox());
    await this.gate("hot-reload-coexistence", () => this.hotReloadCoexistence());
    await this.gate("routing-and-service", () => this.routingAndService());
    await this.gate("worktree-coexistence", () => this.worktreeCoexistence());
    await this.gate("no-save-close", () => this.noSaveClose());
    await this.gate("cleanup", () => this.cleanupGate());
  }

  async showcase(): Promise<void> {
    await this.gate("pea-chat", async () => {
      const host = await this.waitForHost("source");
      const chat = await fetch(`http://127.0.0.1:${host.port}/chat`);
      requireThat(chat.ok, `/chat returned ${chat.status}`);
      const id = `pea-showcase-${this.runId}`;
      const fixture = join(
        repoRoot,
        "source",
        "Pe.Revit.Tests",
        "Fixtures",
        "Families",
        "pe-grd-supply.rfa",
      );
      const prompt = [
        `Use explicit selector sandbox:${id} for every Revit-backed operation.`,
        `Explicitly start installed Pe.App sandbox ${id} for Revit ${this.options.year}, wait until ready,`,
        `open ${fixture}, call revit.context.summary, execute a ReadOnly script that prints Environment.ProcessId,`,
        "then explicitly stop the sandbox ordinarily and verify state=stopped. Report the selector and PID.",
      ].join(" ");
      const pea = join(installedShims, "pea.exe");
      requireThat(existsSync(pea), `installed pea shim missing: ${pea}`);
      const result = await runCommand(
        pea,
        ["--installed", "--prompt", prompt, "--json"],
        evidenceTemp(this.evidence),
        1_200_000,
      );
      await this.record("showcase-pea", result);
      requireThat(result.exitCode === 0, `pea showcase exited ${result.exitCode}`);
      const text = result.stdout + result.stderr;
      requireThat(text.includes(`sandbox:${id}`), "Pea transcript omitted the exact selector");
      requireThat(/state.?[=: ]+stopped/i.test(text), "Pea transcript omitted stopped state");
    });
  }

  private async authority(): Promise<void> {
    const status = await runCommand("git", ["status", "--short"], repoRoot);
    const head = await runCommand("git", ["rev-parse", "HEAD"], repoRoot);
    await this.record("00-candidate", { head: head.stdout.trim(), status: status.stdout });
    requireThat(head.exitCode === 0, "cannot resolve consumer HEAD");
    requireThat(
      this.options.allowDirty || status.stdout.trim() === "",
      "consumer is dirty; commit it or pass --allow-dirty",
    );

    const globalJson = JSON.parse(await readFile(join(repoRoot, "global.json"), "utf8"));
    const toolsJson = JSON.parse(
      await readFile(join(repoRoot, ".config", "dotnet-tools.json"), "utf8"),
    );
    const sdkPin = globalJson["msbuild-sdks"]?.["Pe.Revit.Sdk"];
    const cliPin = toolsJson.tools?.["pe.revit.cli"]?.version;
    requireThat(
      typeof sdkPin === "string" && sdkPin === cliPin,
      `SDK ${sdkPin} and CLI ${cliPin} pins differ`,
    );

    const version = await this.sdk("00-version", ["version"]);
    const doctor = await this.sdk("00-doctor", ["doctor"], repoRoot, [0, 1]);
    const requiredChecks = [
      "windows-env",
      "dotnet",
      "version-source",
      "revit-installs",
      "lockstep-pins",
      "ts-client-drift",
    ];
    const checks = Array.isArray(doctor.result.checks) ? doctor.result.checks.filter(isRecord) : [];
    for (const id of requiredChecks)
      requireThat(
        checks.some((check) => check.Id === id && check.Ok === true),
        `doctor check failed: ${id}`,
      );
    const manifest = JSON.parse(await readFile(join(repoRoot, "product.payloads.json"), "utf8"));
    requireThat(
      version.result.releaseVersion === manifest.version,
      "CLI and product version authority differ",
    );
    const installed = await this.installedSdk("00-installed-verify", ["install", "verify"]);
    requireThat(
      installed.result.ok === true && installed.result.releaseVersion === manifest.version,
      "installed product is not the intact candidate version",
    );
  }

  private async rrdBaseline(): Promise<void> {
    // This runner observes RRD; it never gains permission to converge or restart it.
    // Freshness changes remain an explicit operator/agent action outside this run.
    const status = await this.liveStatus("01-live-baseline");
    this.baselineRrd = liveIdentity(status);
    const addins = Array.isArray(status.result.addins) ? status.result.addins.filter(isRecord) : [];
    requireThat(
      addins.some((addin) => addin.verdict === "fresh" && addin.pid === this.baselineRrd?.pid),
      "RRD is not fresh",
    );
  }

  private async attachedAndFresh(): Promise<void> {
    requireThat(this.baselineRrd !== undefined, "missing RRD baseline");
    await this.sdk("02-attached-plan", [
      "test",
      "attached",
      "--project",
      testProject,
      "--configuration",
      `Debug.R${String(this.options.year).slice(-2)}`,
      "--filter",
      testFilter,
      "--sync",
      "--plan",
    ]);
    await this.sdk("02-attached", [
      "test",
      "attached",
      "--project",
      testProject,
      "--configuration",
      `Debug.R${String(this.options.year).slice(-2)}`,
      "--filter",
      testFilter,
      "--sync",
    ]);
    await this.assertRrdUnchanged("02-live-after-attached");
    await this.sdk("03-fresh-plan", [
      "test",
      "fresh",
      "--project",
      testProject,
      "--configuration",
      `Debug.R${String(this.options.year).slice(-2)}`,
      "--filter",
      testFilter,
      "--plan",
    ]);
    await this.sdk("03-fresh", [
      "test",
      "fresh",
      "--project",
      testProject,
      "--configuration",
      `Debug.R${String(this.options.year).slice(-2)}`,
      "--filter",
      testFilter,
    ]);
    await this.assertRrdUnchanged("03-live-after-fresh");
  }

  private async sourceSandbox(): Promise<void> {
    const id = `accept-source-${this.runId}`;
    this.sourceId = id;
    this.ownedSandboxes.add(id);
    const started = await this.sdk("04-source-start", [
      "sandbox",
      "start",
      "--project",
      addinProject,
      "--year",
      String(this.options.year),
      "--id",
      id,
      "--wait",
    ]);
    requireSandbox(started, id, "ready", "source");
    const first = sandboxResult(started);
    const restarted = await this.sdk("04-source-restart", ["sandbox", "restart", "--id", id]);
    const waited = await this.sdk("04-source-wait", ["sandbox", "wait", "--id", id]);
    requireThat(
      waited.result.id === id && waited.result.state === "ready",
      "source sandbox did not become ready",
    );
    const second = statusSandbox(
      await this.sdk("04-source-after-restart", ["sandbox", "status", "--id", id]),
    );
    requireThat(
      second.state === "ready" && second.payloadSource === "source",
      "source provenance was not preserved after restart",
    );
    requireThat(
      first.pid !== second.pid && first.generationId !== second.generationId,
      "restart reused the sandbox incarnation",
    );
    requireThat(restarted.result.state !== "failed", "restart failed");
    const selector = `sandbox:${id}`;
    await this.waitForRoutedSession("04-source-route-ready", selector);

    const fixture = join(this.evidence, "fixture-source.rfa");
    await copyFile(
      join(repoRoot, "source", "Pe.Revit.Tests", "Fixtures", "Families", "pe-grd-supply.rfa"),
      fixture,
    );
    this.sourceCloseBaseline = join(this.evidence, "08-source-close-baseline.json");
    // Hash before Revit opens the file: an active RVT/RFA may deny independent hash readers.
    await this.closeHelper("snapshot", [
      "-JournalPath",
      stringField(second, "journal"),
      "-ProtectedPath",
      fixture,
      "-OutputPath",
      this.sourceCloseBaseline,
    ]);
    const opened = await this.call(
      "04-source-open",
      "revit.apply.document.open",
      { path: fixture },
      selector,
    );
    requireThat(
      isRecord(opened.body) &&
        isRecord(opened.body.document) &&
        opened.body.document.path === fixture,
      "source fixture did not open",
    );
    const summary = await this.call("04-source-summary", "revit.context.summary", {}, selector);
    requireThat(summary.status === 200, "source context summary failed");
    const script = await this.call(
      "04-source-script",
      "scripting.execute",
      {
        scriptContent: 'WriteLine($"PID={System.Environment.ProcessId};Title={doc.Title}");',
        sourceName: "runtime-acceptance-read.cs",
        permissionMode: "ReadOnly",
        timeoutSeconds: 60,
      },
      selector,
    );
    requireThat(
      isRecord(script.body) &&
        script.body.status === "Succeeded" &&
        String(script.body.output).includes(`PID=${String(second.pid)}`),
      "script did not execute in the selected source sandbox",
    );
    const mutation = await this.call(
      "04-source-mutate",
      "scripting.execute",
      {
        scriptContent: `doc.FamilyManager.RenameCurrentType("Acceptance_Unsaved_${this.runId}"); WriteLine(doc.FamilyManager.CurrentType.Name);`,
        sourceName: "runtime-acceptance-mutate.cs",
        permissionMode: "WriteTransaction",
        timeoutSeconds: 60,
      },
      selector,
    );
    requireThat(
      isRecord(mutation.body) && mutation.body.status === "Succeeded",
      "source mutation failed",
    );
    await this.assertRrdUnchanged("04-live-after-source");
  }

  private async installedSandbox(): Promise<void> {
    const id = `accept-installed-${this.runId}`;
    this.installedId = id;
    this.ownedSandboxes.add(id);
    // Use the installed shim from a neutral directory. A checkout-local tool would silently
    // turn this into another source-lane test and hide broken installed discovery.
    const started = await this.installedSdk("05-installed-start", [
      "sandbox",
      "start",
      "--installed",
      "Pe.App",
      "--year",
      String(this.options.year),
      "--id",
      id,
      "--wait",
    ]);
    requireSandbox(started, id, "ready", "installed");
    const selector = `sandbox:${id}`;
    await this.waitForRoutedSession("05-installed-route-ready", selector);
    const fixture = join(this.evidence, "fixture-installed.rfa");
    await copyFile(
      join(repoRoot, "source", "Pe.Revit.Tests", "Fixtures", "Families", "pe-grd-supply.rfa"),
      fixture,
    );
    await this.call("05-installed-open", "revit.apply.document.open", { path: fixture }, selector);
    const summary = await this.call("05-installed-summary", "revit.context.summary", {}, selector);
    requireThat(summary.status === 200, "installed context summary failed");
  }

  private async hotReloadCoexistence(): Promise<void> {
    requireThat(this.sourceId && this.installedId, "hot reload needs both sandbox lanes live");
    const sourceBefore = statusSandbox(
      await this.sdk("05a-source-before-hot-reload", ["sandbox", "status", "--id", this.sourceId]),
    );
    const installedBefore = statusSandbox(
      await this.sdk("05a-installed-before-hot-reload", [
        "sandbox",
        "status",
        "--id",
        this.installedId,
      ]),
    );
    const sessions = await this.call(
      "05a-sessions-before-hot-reload",
      "bridge.sessions.list",
      {},
      "user",
    );
    const rrdSession = sessionRows(sessions.body).find(
      (row) => row.processId === this.baselineRrd?.pid,
    );
    requireThat(rrdSession, "Pe.Tools did not expose the baseline RRD session");
    const selector = stringField(rrdSession, "sessionId");
    const before = catalogKeys(
      (await this.call("05a-host-op-before-hot-reload", "host.ops.catalog", {}, selector)).body,
    );

    const probePath = join(
      repoRoot,
      "source",
      "Pe.Revit.Global",
      "Services",
      "Host",
      "HostOpsCatalogOperations.cs",
    );
    const clean = await runCommand("git", ["diff", "--quiet", "HEAD", "--", probePath], repoRoot);
    requireThat(clean.exitCode === 0, `hot-reload probe target is already dirty: ${probePath}`);

    const anchor = ".OrderBy(entry => entry.Key, StringComparer.Ordinal)";
    const changed = ".OrderByDescending(entry => entry.Key, StringComparer.Ordinal)";
    const original = await readFile(probePath, "utf8");
    requireThat(original.split(anchor).length === 2, "hot-reload probe anchor is not unique");
    await writeFile(probePath, original.replace(anchor, changed), "utf8");
    try {
      const applied = await this.sdk("05a-hot-reload-apply", [
        "live",
        "converge",
        "--project",
        addinProject,
        "--year",
        String(this.options.year),
      ]);
      requireThat(
        applied.result.verdict === "hot-reload-applied",
        `probe was not applied by Hot Reload: ${String(applied.result.verdict)}`,
      );
      await this.assertRrdUnchanged("05a-live-after-hot-reload");
      const after = catalogKeys(
        (await this.call("05a-host-op-after-hot-reload", "host.ops.catalog", {}, selector)).body,
      );
      requireThat(
        after.join("\n") === [...before].reverse().join("\n"),
        "host.ops.catalog behavior did not change after Hot Reload",
      );
    } finally {
      // Restore only our expression so an unexpected concurrent edit is never overwritten.
      const current = await readFile(probePath, "utf8");
      requireThat(
        current.includes(changed),
        "hot-reload probe expression disappeared before rollback",
      );
      await writeFile(probePath, current.replace(changed, anchor), "utf8");
      const rolledBack = await this.sdk("05a-hot-reload-rollback", [
        "live",
        "converge",
        "--project",
        addinProject,
        "--year",
        String(this.options.year),
      ]);
      requireThat(
        rolledBack.result.verdict === "hot-reload-applied",
        `probe rollback was not applied by Hot Reload: ${String(rolledBack.result.verdict)}`,
      );
      await this.assertRrdUnchanged("05a-live-after-hot-reload-rollback");
      const restored = catalogKeys(
        (await this.call("05a-host-op-after-hot-reload-rollback", "host.ops.catalog", {}, selector))
          .body,
      );
      requireThat(
        restored.join("\n") === before.join("\n"),
        "host.ops.catalog behavior did not return to baseline after rollback",
      );
    }

    const sourceAfter = statusSandbox(
      await this.sdk("05a-source-after-hot-reload", ["sandbox", "status", "--id", this.sourceId]),
    );
    const installedAfter = statusSandbox(
      await this.sdk("05a-installed-after-hot-reload", [
        "sandbox",
        "status",
        "--id",
        this.installedId,
      ]),
    );
    requireThat(
      sameSandbox(sourceBefore, sourceAfter) && sameSandbox(installedBefore, installedAfter),
      "Hot Reload changed a sandbox lifecycle identity",
    );
  }

  private async routingAndService(): Promise<void> {
    requireThat(this.sourceId && this.installedId, "routing needs both sandboxes");
    const sourceService = JSON.parse(await readFile(serviceFiles.source, "utf8"));
    const installedService = JSON.parse(await readFile(serviceFiles.installed, "utf8"));
    const sourceHost = await this.waitForHost("source");
    const installedHost = await this.waitForHost("installed");
    for (const [lane, service, host] of [
      ["source", sourceService, sourceHost],
      ["installed", installedService, installedHost],
    ] as const) {
      requireThat(
        service.schemaVersion === 2 && service.pid === host.pid && service.port === host.port,
        `${lane} service file and host status disagree`,
      );
      for (const key of ["instanceId", "processStartUtc", "version", "lane", "token"])
        requireThat(service[key] !== undefined, `${lane} service file lacks ${key}`);
    }
    await this.record("06-service", {
      source: { service: sourceService, host: sourceHost },
      installed: { service: installedService, host: installedHost },
    });

    const sourceSessions = await this.call(
      "06-source-sessions",
      "bridge.sessions.list",
      {},
      "user",
      [200],
    );
    const installedSessions = await this.call(
      "06-installed-sessions",
      "bridge.sessions.list",
      {},
      `sandbox:${this.installedId}`,
      [200],
    );
    const source = sessionRows(sourceSessions.body).find((row) => row.sandboxId === this.sourceId);
    const installed = sessionRows(installedSessions.body).find(
      (row) => row.sandboxId === this.installedId,
    );
    requireThat(source && installed, "each lane did not register its sandbox");

    const omitted = await this.call("06-omitted", "revit.context.summary", {}, undefined, [409]);
    requireThat(omitted.status === 409, "omitted selector did not reject ambiguity");
    const stale = await this.call(
      "06-stale",
      "revit.context.summary",
      {},
      "sandbox:not-real",
      [404],
    );
    requireThat(stale.status === 404, "stale selector did not return not-found");
    for (const [name, selector] of [
      ["source-logical", `sandbox:${this.sourceId}`],
      ["installed-logical", `sandbox:${this.installedId}`],
      ["source-pid", String(source.processId)],
      ["source-raw", String(source.sessionId)],
      ["user", "user"],
    ] as const) {
      const response = await this.call(
        `06-${name}`,
        "revit.context.document-session",
        {},
        selector,
      );
      requireThat(response.status === 200, `${name} selector failed`);
    }
    const sourceBefore = await this.sdk("06-source-before-script", [
      "sandbox",
      "status",
      "--id",
      this.sourceId,
    ]);
    await this.call(
      "06-script-no-lifecycle",
      "scripting.execute",
      {
        scriptContent: 'WriteLine($"PID={System.Environment.ProcessId}");',
        sourceName: "runtime-acceptance-no-lifecycle.cs",
        permissionMode: "ReadOnly",
      },
      `sandbox:${this.sourceId}`,
    );
    const sourceAfter = await this.sdk("06-source-after-script", [
      "sandbox",
      "status",
      "--id",
      this.sourceId,
    ]);
    requireThat(
      sameSandbox(statusSandbox(sourceBefore), statusSandbox(sourceAfter)),
      "script execution changed sandbox lifecycle identity",
    );
    await this.assertRrdUnchanged("06-live-after-routing");
    await this.sdk("06-installed-stop", ["sandbox", "stop", "--id", this.installedId]);
    this.ownedSandboxes.delete(this.installedId);
  }

  private async worktreeCoexistence(): Promise<void> {
    const root = join(this.evidence, "worktrees");
    const wtA = join(root, "a");
    const wtB = join(root, "b");
    await mkdir(root, { recursive: true });
    await this.git(["worktree", "add", "--detach", wtA, "HEAD"]);
    this.worktrees.add(wtA);
    await this.git(["worktree", "add", "--detach", wtB, "HEAD"]);
    this.worktrees.add(wtB);
    const idA = `accept-wta-${this.runId}`;
    const idB = `accept-wtb-${this.runId}`;
    this.ownedSandboxes.add(idA);
    this.ownedSandboxes.add(idB);
    const startA = await this.sdk(
      "07-wta-start",
      [
        "sandbox",
        "start",
        "--project",
        join(wtA, "source", "Pe.App", "Pe.App.csproj"),
        "--year",
        String(this.options.year),
        "--id",
        idA,
        "--wait",
      ],
      wtA,
    );
    const startB = await this.sdk(
      "07-wtb-start",
      [
        "sandbox",
        "start",
        "--project",
        join(wtB, "source", "Pe.App", "Pe.App.csproj"),
        "--year",
        String(this.options.year),
        "--id",
        idB,
        "--wait",
      ],
      wtB,
    );
    const a = sandboxResult(startA);
    const b = sandboxResult(startB);
    requireThat(
      a.pid !== b.pid && a.generationRoot !== b.generationRoot,
      "worktree sandboxes share an incarnation or generation",
    );
    await this.assertRrdUnchanged("07-live-with-worktrees");

    const breakFile = join(wtA, "source", "Pe.App", "RuntimeAcceptanceCompileBreak.cs");
    // Break only the disposable worktree. Restart materializes first, so the old sandbox must
    // remain usable; touching the primary checkout would turn a safety proof into a footgun.
    await writeFile(breakFile, "this intentionally does not compile", "utf8");
    try {
      await this.sdk("07-wta-failed-restart", ["sandbox", "restart", "--id", idA], wtA, [1, 3]);
      const afterFailure = await this.sdk(
        "07-wta-after-failure",
        ["sandbox", "status", "--id", idA],
        wtA,
      );
      requireThat(
        sameSandbox(a, statusSandbox(afterFailure)),
        "failed build replaced the usable sandbox",
      );
    } finally {
      await rm(breakFile, { force: true });
    }
    await this.sdk("07-wta-restart", ["sandbox", "restart", "--id", idA], wtA);
    const afterRestart = await this.sdk("07-wta-wait", ["sandbox", "wait", "--id", idA], wtA);
    const restarted = sandboxResult(afterRestart);
    requireThat(
      a.pid !== restarted.pid && a.generationId !== restarted.generationId,
      "successful worktree restart reused identity",
    );
    // `sandbox wait` is deliberately compact; take the lifecycle baseline from the same full
    // status shape used after stopping B so descriptor presence cannot create a false change.
    const a2 = statusSandbox(
      await this.sdk("07-wta-after-restart", ["sandbox", "status", "--id", idA], wtA),
    );
    const bStill = statusSandbox(
      await this.sdk("07-wtb-during-a-restart", ["sandbox", "status", "--id", idB], wtB),
    );
    requireThat(sameSandbox(b, bStill), "restarting A changed B");
    await this.sdk("07-wtb-stop", ["sandbox", "stop", "--id", idB], wtB);
    this.ownedSandboxes.delete(idB);
    const aStill = statusSandbox(
      await this.sdk("07-wta-after-b-stop", ["sandbox", "status", "--id", idA], wtA),
    );
    requireThat(sameSandbox(a2, aStill), "stopping B changed A");
    await this.sdk("07-wta-stop", ["sandbox", "stop", "--id", idA], wtA);
    this.ownedSandboxes.delete(idA);
  }

  private async noSaveClose(): Promise<void> {
    requireThat(this.sourceId && this.sourceCloseBaseline, "source close proof was not prepared");
    const stop = await this.sdk("08-source-stop", ["sandbox", "stop", "--id", this.sourceId]);
    requireThat(stop.result.state === "stopped", "ordinary source stop did not stop");
    this.ownedSandboxes.delete(this.sourceId);
    await this.closeHelper("verify", [
      "-BaselinePath",
      this.sourceCloseBaseline,
      "-StopResultPath",
      join(this.evidence, "08-source-stop.json"),
      "-OutputPath",
      join(this.evidence, "08-source-close-proof.json"),
    ]);
    await this.assertRrdUnchanged("08-live-after-close");
  }

  private async cleanupGate(): Promise<void> {
    await this.cleanupOwned();
    const final = await this.sdk("09-sandbox-final", ["sandbox", "status"]);
    const sandboxes = Array.isArray(final.result.sandboxes)
      ? final.result.sandboxes.filter(isRecord)
      : [];
    const ownedPrefix = `accept-`;
    requireThat(
      !sandboxes.some(
        (sandbox) =>
          String(sandbox.id).startsWith(ownedPrefix) &&
          !["stopped", "failed"].includes(String(sandbox.state)),
      ),
      "acceptance-owned sandbox remains live",
    );
    await this.assertRrdUnchanged("09-live-final");
  }

  async cleanupOwned(): Promise<void> {
    for (const id of [...this.ownedSandboxes].reverse()) {
      try {
        await this.sdk(
          `cleanup-${safeName(id)}`,
          ["sandbox", "stop", "--id", id],
          repoRoot,
          [0, 1, 3],
        );
      } catch {}
      this.ownedSandboxes.delete(id);
    }
    for (const worktree of [...this.worktrees].reverse()) {
      try {
        await this.git(["worktree", "remove", "--force", worktree]);
      } catch {}
      this.worktrees.delete(worktree);
    }
  }

  async writeVerdict(): Promise<void> {
    await this.record("verdict", {
      schemaVersion: 1,
      profile: this.options.profile,
      pass:
        !this.failed &&
        this.gates.length === acceptancePlan(this.options.profile).length &&
        this.gates.every((gate) => gate.passed),
      capturedAtUtc: new Date().toISOString(),
      evidence: this.evidence,
      gates: this.gates,
      baselineRrd: this.baselineRrd ?? null,
    });
  }

  private async gate(id: string, action: () => Promise<void>): Promise<void> {
    const startedAtUtc = new Date().toISOString();
    try {
      await action();
      this.gates.push({ id, passed: true, startedAtUtc, endedAtUtc: new Date().toISOString() });
    } catch (error) {
      this.failed = true;
      this.gates.push({
        id,
        passed: false,
        startedAtUtc,
        endedAtUtc: new Date().toISOString(),
        error: errorText(error),
      });
      throw error;
    } finally {
      await this.record("run-state", { profile: this.options.profile, gates: this.gates });
    }
  }

  private liveStatus(label: string): Promise<SdkEnvelope> {
    return this.sdk(label, [
      "live",
      "status",
      "--project",
      addinProject,
      "--year",
      String(this.options.year),
    ]);
  }

  private async assertRrdUnchanged(label: string): Promise<void> {
    requireThat(this.baselineRrd !== undefined, "RRD baseline missing");
    const actual = liveIdentity(await this.liveStatus(label));
    requireThat(
      actual.pid === this.baselineRrd.pid &&
        actual.processStartUtc === this.baselineRrd.processStartUtc,
      `RRD identity changed: ${JSON.stringify({ expected: this.baselineRrd, actual })}`,
    );
  }

  private async sdk(
    label: string,
    args: string[],
    cwd = repoRoot,
    allowed = [0],
  ): Promise<SdkEnvelope> {
    return this.sdkCommand(
      label,
      "dotnet",
      ["tool", "run", "pe-revit", "--", ...args, "--json"],
      cwd,
      allowed,
    );
  }

  private async installedSdk(label: string, args: string[]): Promise<SdkEnvelope> {
    const shim = join(installedShims, "pe-revit.cmd");
    requireThat(existsSync(shim), `installed pe-revit shim missing: ${shim}`);
    return this.sdkCommand(label, shim, [...args, "--json"], evidenceTemp(this.evidence), [0]);
  }

  private async sdkCommand(
    label: string,
    command: string,
    args: string[],
    cwd: string,
    allowed: number[],
  ): Promise<SdkEnvelope> {
    const result = await runCommand(command, args, cwd, 1_200_000);
    await writeFile(join(this.evidence, `${label}.stderr.txt`), result.stderr, "utf8");
    let envelope: SdkEnvelope;
    try {
      envelope = parseSdkEnvelope(result.stdout);
    } catch (error) {
      await this.record(`${label}-invalid`, { command, args, cwd, ...result });
      throw error;
    }
    await this.record(label, envelope);
    requireThat(
      allowed.includes(result.exitCode),
      `${label} exited ${result.exitCode}: ${result.stderr.trim()}`,
    );
    return envelope;
  }

  private async call(
    label: string,
    key: string,
    request: unknown,
    selector?: string,
    expected = [200],
  ): Promise<{ status: number; body: unknown }> {
    const host = await this.waitForHost(this.hostLaneForSelector(selector));
    const response = await fetch(`http://127.0.0.1:${host.port}/call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(selector ? { "x-pe-bridge-session-id": selector } : {}),
      },
      body: JSON.stringify({ key, request }),
      signal: AbortSignal.timeout(300_000),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const result = { status: response.status, selector: selector ?? null, key, request, body };
    await this.record(label, result);
    requireThat(
      expected.includes(response.status),
      `${label} returned ${response.status}: ${text}`,
    );
    return result;
  }

  private hostLaneForSelector(selector?: string): HostLane {
    return this.installedId && selector === `sandbox:${this.installedId}` ? "installed" : "source";
  }

  private async waitForHost(
    lane: HostLane = "source",
  ): Promise<Record<string, unknown> & { port: number; pid: number }> {
    const deadline = Date.now() + 120_000;
    let last = "service file missing";
    while (Date.now() < deadline) {
      try {
        const service = JSON.parse(await readFile(serviceFiles[lane], "utf8"));
        const response = await fetch(`http://127.0.0.1:${service.port}/host/status`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (response.ok) {
          const status = await response.json();
          if (isRecord(status)) return { ...status, port: service.port, pid: service.pid };
        }
        last = `HTTP ${response.status}`;
      } catch (error) {
        last = errorText(error);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
    throw new Error(`Pe.Tools ${lane} host was not ready: ${last}`);
  }

  private async waitForRoutedSession(label: string, selector: string): Promise<void> {
    const deadline = Date.now() + 120_000;
    let attempts = 0;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      const response = await this.call(
        label,
        "revit.context.summary",
        {},
        selector,
        [200, 404, 409],
      );
      lastStatus = response.status;
      const routedWithoutDocument =
        response.status === 409 &&
        isRecord(response.body) &&
        response.body.message === "No active document.";
      if (response.status === 200 || routedWithoutDocument) {
        await this.record(`${label}-verdict`, { selector, attempts, status: response.status });
        return;
      }
      // SDK readiness and Pe.Tools routing readiness are separate public contracts:
      // Revit may expose the SDK bridge before its UI thread registers with Pe.Host.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
    throw new Error(
      `${selector} did not become routable through Pe.Tools (last HTTP status ${lastStatus})`,
    );
  }

  private async closeHelper(action: string, args: string[]): Promise<void> {
    const script = join(this.sdkRoot, "scripts", "runtime-close-proof.ps1");
    requireThat(existsSync(script), `SDK close verifier missing: ${script}`);
    const result = await runCommand(
      "powershell",
      ["-NoProfile", "-File", script, "-Action", action, ...args],
      repoRoot,
    );
    await this.record(`close-helper-${action}`, result);
    requireThat(result.exitCode === 0, `close helper ${action} failed: ${result.stderr}`);
  }

  private async git(args: string[]): Promise<void> {
    const result = await runCommand("git", args, repoRoot, 300_000);
    requireThat(result.exitCode === 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  }

  private record(label: string, value: unknown): Promise<void> {
    return writeFile(
      join(this.evidence, `${label}.json`),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
  }
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 300_000,
): Promise<CommandResult> {
  return new Promise((resolveCommand, reject) => {
    const isCommandShim = command.toLowerCase().endsWith(".cmd");
    const executable = isCommandShim ? (process.env.ComSpec ?? "cmd.exe") : command;
    // Node's shell:true loses an unquoted .cmd path at the first space. `call` keeps the selected
    // installed shim authoritative instead of letting cmd.exe reinterpret or fall through to PATH.
    const commandArgs = isCommandShim
      ? ["/d", "/s", "/c", `call "${command}" ${args.map(quoteCmdArgument).join(" ")}`]
      : args;
    const child = spawn(executable, commandArgs, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: isCommandShim,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolveCommand({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function quoteCmdArgument(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sandboxResult(envelope: SdkEnvelope): Record<string, unknown> {
  requireThat(
    envelope.result.id && envelope.result.pid && envelope.result.generationId,
    "sandbox result lacks identity",
  );
  return envelope.result;
}

function statusSandbox(envelope: SdkEnvelope): Record<string, unknown> {
  const sandboxes = envelope.result.sandboxes;
  requireThat(
    Array.isArray(sandboxes) && sandboxes.length === 1 && isRecord(sandboxes[0]),
    "sandbox status did not resolve exactly one sandbox",
  );
  return sandboxes[0];
}

function requireSandbox(envelope: SdkEnvelope, id: string, state: string, source: string): void {
  const sandbox = sandboxResult(envelope);
  requireThat(
    sandbox.id === id && sandbox.state === state && sandbox.payloadSource === source,
    `unexpected sandbox: ${JSON.stringify(sandbox)}`,
  );
}

function sameSandbox(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return (
    left.pid === right.pid &&
    left.generationId === right.generationId &&
    left.descriptor === right.descriptor
  );
}

function sessionRows(value: unknown): Record<string, unknown>[] {
  if (isRecord(value) && Array.isArray(value.sessions)) return value.sessions.filter(isRecord);
  if (Array.isArray(value)) return value.filter(isRecord);
  throw new Error("bridge.sessions.list returned no sessions");
}

function catalogKeys(value: unknown): string[] {
  requireThat(isRecord(value) && Array.isArray(value.operations), "catalog has no operations");
  const keys = value.operations
    .filter(isRecord)
    .map((operation) => operation.key)
    .filter((key): key is string => typeof key === "string");
  requireThat(keys.length > 1, "catalog has too few operation keys for an ordering witness");
  return keys;
}

function stringField(value: Record<string, unknown>, key: string): string {
  requireThat(typeof value[key] === "string", `missing ${key}`);
  return value[key];
}

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-");
}

function evidenceTemp(evidence: string): string {
  return join(tmpdir(), "pe-runtime-acceptance", basename(evidence));
}
