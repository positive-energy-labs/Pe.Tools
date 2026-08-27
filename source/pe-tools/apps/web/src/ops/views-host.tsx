import type { ReactNode } from "react";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import type { Lane } from "#/host/target";
import { LaneBadge, LiveDot } from "#/host/target-ui";
import {
  type Column,
  DataTable,
  KVGrid,
  type TreeNode,
  TreeView,
  VizChip,
  type VizIndex,
} from "#/ops/primitives";
import {
  asArray,
  asNumber,
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
} from "#/ops/registry";

/**
 * Curated readonly views for host/bridge/settings/scripting/aps ops. Testimony,
 * not controls: every surface renders observed facts with honest empty states.
 */

// The SDK's lane union, verbatim. A value outside it is NOT a lane — there is no "unknown"
// member to fall back to, so the badge simply does not render.
const LANES: readonly Lane[] = ["dev", "installed"];

function laneOf(value: unknown): Lane | null {
  return LANES.find((lane) => lane === value) ?? null;
}

function MonoAside({ children }: { children: ReactNode }) {
  return <span className="face-mono t-caption text-ink-2">{children}</span>;
}

/* ── host.status — host identity card ─────────────────────────────────────── */

function HostStatusView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const connected = rec.bridgeIsConnected === true;
  const disconnectReason = asString(rec.disconnectReason);
  const agentRuntime = asRecord(rec.agentRuntime);
  return (
    <Section
      label="host"
      aside={
        <span className="flex items-center gap-1.5">
          <LiveDot tone="implicit" lane={connected ? "dev" : null} />
          <FactChip
            tone={connected ? "done" : "caution"}
            title={
              connected
                ? "the Revit bridge is connected"
                : "a busy bridge is not the model disagreeing — caution, not alarm"
            }
          >
            {connected ? "bridge connected" : "bridge down"}
          </FactChip>
        </span>
      }
    >
      <KVGrid
        columns={3}
        items={[
          { label: "lane", value: asString(rec.lane) ?? "∅" },
          { label: "service", value: asString(rec.serviceName) ?? "∅" },
          { label: "pid", value: asNumber(rec.processId)?.toString() ?? "∅" },
          { label: "runtime", value: asString(rec.runtimeIdentity) ?? "∅" },
          {
            label: "contracts",
            value: `bridge v${asNumber(rec.bridgeContractVersion) ?? "?"} · host v${asNumber(rec.hostContractVersion) ?? "?"}`,
          },
          { label: "source root", value: asString(rec.sourceRoot) ?? "∅" },
        ]}
      />
      {!connected && disconnectReason && (
        <Provenance>
          <span style={{ color: "var(--pe-caution)" }}>disconnect: {disconnectReason}</span>
        </Provenance>
      )}
      {agentRuntime && agentRuntime.available !== true && (
        <Provenance>
          agent runtime unavailable
          {asString(agentRuntime.error)
            ? ` — ${asString(agentRuntime.error)}`
            : " (not yet settled)"}
        </Provenance>
      )}
    </Section>
  );
}

/* ── bridge sessions — the readonly patch bay ─────────────────────────────── */

function SessionRow({
  connected,
  lane,
  title,
  processId,
  sessionId,
  revitVersion,
  openDocumentCount,
}: {
  connected: boolean;
  lane: Lane | null;
  title: string | undefined;
  processId: number | undefined;
  sessionId: string | undefined;
  revitVersion: string | undefined;
  openDocumentCount: number | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-line px-2 py-1.5">
      <LiveDot tone={connected ? "implicit" : "dangling"} lane={lane} />
      {lane ? <LaneBadge lane={lane} /> : null}
      <span className="t-value min-w-0 truncate font-medium" title={title}>
        {title ?? <span className="italic text-ink-mute">no active document</span>}
      </span>
      <span className="face-mono t-caption ml-auto shrink-0 text-ink-2">
        {revitVersion ? `revit ${revitVersion}` : "revit ∅"} · {openDocumentCount ?? 0} doc
        {openDocumentCount === 1 ? "" : "s"}
      </span>
      <span className="face-mono t-caption shrink-0 text-ink-2" title={sessionId}>
        pid {processId ?? "∅"} · {sessionId ? `${sessionId.slice(0, 8)}…` : "∅"}
      </span>
    </div>
  );
}

function sessionListFrame(children: ReactNode) {
  return <div className="rounded-md border border-line">{children}</div>;
}

function BridgeSessionsListView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const sessions = asRecords(rec.sessions);
  return (
    <Section label="sessions" aside={<MonoAside>{sessions.length} connected</MonoAside>}>
      {sessions.length === 0 ? (
        <EmptyState story="scope" exit="start a Revit session with the bridge add-in loaded">
          no revit connected
        </EmptyState>
      ) : (
        sessionListFrame(
          sessions.map((s, i) => (
            <SessionRow
              key={asString(s.sessionId) ?? String(i)}
              connected={s.connected === true}
              lane={laneOf(s.lane)}
              title={asString(s.activeDocumentTitle)}
              processId={asNumber(s.processId)}
              sessionId={asString(s.sessionId)}
              revitVersion={asString(s.revitVersion)}
              openDocumentCount={asNumber(s.openDocumentCount)}
            />
          )),
        )
      )}
    </Section>
  );
}

function BridgeSessionSummaryView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const connected = rec.bridgeIsConnected === true;
  const activeDocument = asRecord(rec.activeDocument);
  if (!connected)
    return (
      <EmptyState story="scope" exit="start a Revit session with the bridge add-in loaded">
        no revit connected
      </EmptyState>
    );
  const observedAt = asNumber(activeDocument?.observedAtUnixMs);
  return (
    <Section label="session">
      {sessionListFrame(
        <SessionRow
          connected={connected}
          lane={laneOf(rec.lane)}
          title={asString(activeDocument?.title)}
          processId={asNumber(rec.processId)}
          sessionId={asString(rec.sessionId)}
          revitVersion={asString(rec.revitVersion)}
          openDocumentCount={asNumber(rec.openDocumentCount)}
        />,
      )}
      <Provenance>
        {asString(rec.runtimeFramework) ?? "framework ∅"}
        {asString(rec.buildStamp) ? ` · build ${asString(rec.buildStamp)}` : ""}
        {observedAt ? ` · doc observed ${new Date(observedAt).toISOString()}` : ""}
      </Provenance>
    </Section>
  );
}

/* ── logs.tail — mono log lane ────────────────────────────────────────────── */

const LOG_TIMESTAMP = /^(\[?\d{4}-\d{2}-\d{2}[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?\s*)/;

/** error/warn lines go caution — a log line is never the model disagreeing, so no
 * alarm is spent; the word in the line carries the rank. */
function logLineColor(line: string): string | undefined {
  if (/\b(error|err|fatal)\b/i.test(line)) return "var(--pe-caution)";
  if (/\bwarn(ing)?\b/i.test(line)) return "var(--pe-caution)";
  return undefined;
}

function LogLine({ line }: { line: string }) {
  const match = line.match(LOG_TIMESTAMP);
  const timestamp = match?.[1] ?? "";
  const rest = timestamp ? line.slice(timestamp.length) : line;
  return (
    <div className="face-mono t-label whitespace-pre leading-[1.5]">
      {timestamp && <span className="text-ink-2">{timestamp}</span>}
      <span style={{ color: logLineColor(rest) }}>{rest}</span>
    </div>
  );
}

function scrollToBottom(el: HTMLDivElement | null) {
  if (el) el.scrollTop = el.scrollHeight;
}

function LogsTailView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const files = asRecords(rec.files);
  if (files.length === 0)
    return (
      <EmptyState story="scope" exit="name at least one log file in the request">
        no log files in response
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-4">
      {files.map((file, i) => {
        const lines = asArray(file.lines).flatMap((line) =>
          typeof line === "string" ? [line] : [],
        );
        return (
          <Section
            key={asString(file.label) ?? String(i)}
            label={asString(file.label) ?? `log ${i}`}
            aside={<MonoAside>{lines.length} lines</MonoAside>}
          >
            {lines.length === 0 ? (
              <EmptyState story="scope" exit="nothing has logged here yet — check the path">
                log empty or unreadable
              </EmptyState>
            ) : (
              <div
                ref={scrollToBottom}
                className="max-h-[18rem] overflow-auto rounded-md border border-line px-2 py-1"
              >
                {lines.map((line, index) => (
                  <LogLine key={index} line={line} />
                ))}
              </div>
            )}
            <Provenance>
              {asString(file.filePath) ?? "path ∅"} · tail only, older lines not fetched
            </Provenance>
          </Section>
        );
      })}
    </div>
  );
}

/* ── settings.workspaces — workspace cards ────────────────────────────────── */

function SettingsWorkspacesView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const workspaces = asRecords(rec.workspaces);
  if (workspaces.length === 0)
    return (
      <EmptyState story="scope" exit="create a workspace under the settings root">
        no workspaces
      </EmptyState>
    );
  return (
    <Section label="workspaces" aside={<MonoAside>{workspaces.length}</MonoAside>}>
      <div className="flex flex-col gap-2">
        {workspaces.map((workspace, i) => {
          const modules = asRecords(workspace.modules);
          return (
            <div
              key={asString(workspace.workspaceKey) ?? String(i)}
              className="rounded-md border border-line px-3 py-2"
            >
              <div className="flex items-baseline gap-2">
                <span className="t-value font-medium">
                  {asString(workspace.displayName) ?? asString(workspace.workspaceKey) ?? "∅"}
                </span>
                <MonoAside>{asString(workspace.workspaceKey) ?? "∅"}</MonoAside>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {modules.map((module, j) => (
                  <FactChip key={asString(module.moduleKey) ?? String(j)} title="module key">
                    {asString(module.moduleKey) ?? "∅"}
                  </FactChip>
                ))}
              </div>
              {modules.map((module, j) => {
                const roots = asRecords(module.roots);
                const defaultRootKey = asString(module.defaultRootKey);
                return (
                  <div key={j} className="face-mono t-caption mt-1 text-ink-2">
                    {asString(module.moduleKey)}:{" "}
                    {roots
                      .map((root) => {
                        const key = asString(root.rootKey) ?? "∅";
                        return key === defaultRootKey ? `${key}*` : key;
                      })
                      .join(" · ") || "no roots"}
                  </div>
                );
              })}
              <Provenance>{asString(workspace.basePath) ?? "base path ∅"}</Provenance>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ── settings.tree — profiles/fragments/schemas tree ──────────────────────── */

/** Settings-file KIND is taxonomy — a viz rung per kind. */
const KIND_VIZ: Record<string, VizIndex> = {
  Profile: 1,
  Fragment: 4,
  Schema: 3,
  Other: 6,
};

function settingsDirToNode(dir: Record<string, unknown>, path: string): TreeNode {
  const directories = asRecords(dir.directories);
  const files = asRecords(dir.files);
  const children: TreeNode[] = [
    ...directories.map((sub, i) =>
      settingsDirToNode(sub, `${path}/${asString(sub.relativePath) ?? String(i)}`),
    ),
    ...files.map((file, i) => {
      const kind = asString(file.kind) ?? "Other";
      return {
        id: `${path}/file:${asString(file.id) ?? asString(file.relativePath) ?? String(i)}`,
        label: asString(file.name) ?? "∅",
        meta: <VizChip viz={KIND_VIZ[kind] ?? 3}>{kind.toLowerCase()}</VizChip>,
      } satisfies TreeNode;
    }),
  ];
  return {
    id: `${path}/dir`,
    label: asString(dir.name) || "(root)",
    meta: `${files.length}f`,
    children,
    defaultOpen: true,
  };
}

function countSettingsFiles(dir: Record<string, unknown>): number {
  return (
    asRecords(dir.files).length +
    asRecords(dir.directories).reduce((acc, sub) => acc + countSettingsFiles(sub), 0)
  );
}

function SettingsTreeView({ data }: OpViewProps) {
  const rec = asRecord(data);
  const root = asRecord(rec?.root);
  if (!rec || !root) return <UnrecognizedShape />;
  const total = countSettingsFiles(root);
  return (
    <Section label="settings tree" aside={<MonoAside>{total} files</MonoAside>}>
      {total === 0 && asRecords(root.directories).length === 0 ? (
        <EmptyState story="scope" exit="add a profile, fragment or schema under the settings root">
          no settings documents found
        </EmptyState>
      ) : (
        <TreeView nodes={[settingsDirToNode(root, "root")]} dense />
      )}
    </Section>
  );
}

/* ── scripting.pod.list — pods schedule ───────────────────────────────────── */

type PodRow = Record<string, unknown>;

const POD_COLUMNS: Column<PodRow>[] = [
  {
    key: "name",
    header: "Name",
    cell: (pod) => {
      const manifest = asRecord(pod.manifest);
      const name = asString(manifest?.name) ?? asString(pod.workspaceKey) ?? "∅";
      const version = asString(manifest?.version);
      return (
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{name}</span>
          {version && <MonoAside>v{version}</MonoAside>}
          {pod.isValid !== true && (
            <FactChip tone="caution" title="manifest failed validation">
              invalid
            </FactChip>
          )}
        </span>
      );
    },
  },
  {
    key: "description",
    header: "Description",
    cell: (pod) => asString(asRecord(pod.manifest)?.description) ?? "—",
  },
  {
    key: "entries",
    header: "Entrypoints",
    cell: (pod) => {
      const entrypoints = asRecords(asRecord(pod.manifest)?.entrypoints);
      if (entrypoints.length === 0) return <MonoAside>none</MonoAside>;
      return (
        <span
          className="face-mono t-caption"
          title={entrypoints.map((e) => asString(e.sourcePath) ?? "").join("\n")}
        >
          {entrypoints.map((e) => asString(e.id) ?? "∅").join(" · ")}
        </span>
      );
    },
  },
  {
    key: "diagnostics",
    header: "Diag",
    numeric: true,
    cell: (pod) => asRecords(pod.diagnostics).length || "",
  },
];

function ScriptingPodListView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const pods = asRecords(rec.pods);
  if (pods.length === 0)
    return (
      <EmptyState story="scope" exit="create a pod under the workspace root">
        no pods in workspace root
      </EmptyState>
    );
  return (
    <Section label="pods" aside={<MonoAside>{pods.length}</MonoAside>}>
      <DataTable
        columns={POD_COLUMNS}
        rows={pods}
        rowKey={(pod, i) => asString(pod.workspaceKey) ?? String(i)}
        footer={<Provenance>root: {asString(rec.workspacesRootPath) ?? "∅"}</Provenance>}
      />
    </Section>
  );
}

/* ── aps.auth.status — auth card ──────────────────────────────────────────── */

function ApsAuthStatusView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const exists = rec.exists === true;
  const expiresAtUtc = asString(rec.expiresAtUtc);
  const expiryMs = expiresAtUtc ? new Date(expiresAtUtc).getTime() : Number.NaN;
  const state: { label: string; tone: "caution" | "done" } = !exists
    ? { label: "no token", tone: "caution" }
    : Number.isFinite(expiryMs) && expiryMs <= Date.now()
      ? { label: "expired", tone: "caution" }
      : Number.isFinite(expiryMs)
        ? { label: "valid", tone: "done" }
        : { label: "present · expiry unknown", tone: "caution" };
  return (
    <Section
      label="aps auth"
      aside={
        <FactChip tone={state.tone} title="persisted APS token state at read time">
          {state.label}
        </FactChip>
      }
    >
      <KVGrid
        columns={2}
        items={[
          { label: "scope profile", value: asString(rec.scopeProfile) ?? "∅" },
          { label: "flow", value: asString(rec.flowKind) ?? "∅" },
          { label: "expires", value: expiresAtUtc ?? "∅" },
          { label: "refresh token", value: rec.hasRefreshToken === true ? "present" : "absent" },
          // Never render token material, even if the response carries it.
          ...(asString(rec.accessToken) ? [{ label: "access token", value: "•••" }] : []),
          ...(asString(rec.refreshToken) ? [{ label: "refresh token value", value: "•••" }] : []),
        ]}
      />
      <Provenance>persisted-token status only — no network call to APS was made</Provenance>
    </Section>
  );
}

/* ── host.ops.catalog — the catalog looking at itself ─────────────────────── */

function opDomain(key: string): string {
  const parts = key.split(".");
  return parts[0] === "revit" && parts.length > 1 ? `revit.${parts[1]}` : parts[0];
}

function HostOpsCatalogView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const operations = asRecords(rec.operations);
  if (operations.length === 0)
    return (
      <EmptyState story="scope" exit="is the host running with its op registry loaded?">
        catalog empty
      </EmptyState>
    );
  const counts = new Map<string, number>();
  for (const op of operations) {
    const key = asString(op.key);
    if (!key) continue;
    const domain = opDomain(key);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([domain, count]) => ({ label: domain, value: String(count) }));
  return (
    <Section label="op catalog" aside={<MonoAside>{operations.length} ops</MonoAside>}>
      <KVGrid columns={3} items={items} />
      <Provenance>counts by domain prefix, from the live catalog response</Provenance>
    </Section>
  );
}

/* ── registry ─────────────────────────────────────────────────────────────── */

export const views: OpViewRegistry = {
  "host.status": HostStatusView,
  "bridge.sessions.summary": BridgeSessionSummaryView,
  "bridge.sessions.list": BridgeSessionsListView,
  "logs.tail": LogsTailView,
  "settings.workspaces": SettingsWorkspacesView,
  "settings.tree": SettingsTreeView,
  "scripting.pod.list": ScriptingPodListView,
  "aps.auth.status": ApsAuthStatusView,
  "host.ops.catalog": HostOpsCatalogView,
};
