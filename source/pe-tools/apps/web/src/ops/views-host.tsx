import type { ReactNode } from "react";

import type { SessionLane } from "#/host/target";
import { LaneBadge, LiveDot } from "#/host/target-ui";
import {
  Chip,
  EmptyState,
  KVGrid,
  MonoNote,
  OpSection,
  Provenance,
  DataTable,
  TreeView,
  type CatHue,
  type Column,
  type TreeNode,
} from "#/ops/primitives";
import {
  asArray,
  asNumber,
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  type OpViewRegistry,
} from "#/ops/registry";

/**
 * Curated readonly views for host/bridge/settings/scripting/aps ops. Testimony,
 * not controls: every surface renders observed facts with honest empty states.
 */

const LANES: readonly SessionLane[] = ["rrd", "sandbox", "installed", "unknown"];

function laneOf(value: unknown): SessionLane {
  return LANES.find((lane) => lane === value) ?? "unknown";
}

/* ── host.status — host identity card ─────────────────────────────────────── */

function HostStatusView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const connected = rec.bridgeIsConnected === true;
  const disconnectReason = asString(rec.disconnectReason);
  const agentRuntime = asRecord(rec.agentRuntime);
  return (
    <OpSection
      label="host"
      aside={
        <span className="flex items-center gap-1.5">
          <LiveDot tone="implicit" lane={connected ? "rrd" : "unknown"} />
          <MonoNote hue={connected ? "green" : "kiln"}>
            {connected ? "bridge connected" : "bridge down"}
          </MonoNote>
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
          <span style={{ color: "var(--cat-clay)" }}>disconnect: {disconnectReason}</span>
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
    </OpSection>
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
  lane: SessionLane;
  title: string | undefined;
  processId: number | undefined;
  sessionId: string | undefined;
  revitVersion: string | undefined;
  openDocumentCount: number | undefined;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-2 px-2 py-1.5"
      style={{ borderBottom: "0.5px solid var(--line-soft)" }}
    >
      <LiveDot tone={connected ? "implicit" : "dangling"} lane={lane} />
      <LaneBadge lane={lane} />
      <span className="min-w-0 truncate text-xs font-medium" title={title}>
        {title ?? <span className="text-muted-foreground">no active document</span>}
      </span>
      <span className="tele ml-auto shrink-0 text-[10px] text-muted-foreground">
        {revitVersion ? `revit ${revitVersion}` : "revit ∅"} · {openDocumentCount ?? 0} doc
        {openDocumentCount === 1 ? "" : "s"}
      </span>
      <span className="tele shrink-0 text-[10px] text-muted-foreground" title={sessionId}>
        pid {processId ?? "∅"} · {sessionId ? `${sessionId.slice(0, 8)}…` : "∅"}
      </span>
    </div>
  );
}

function sessionListFrame(children: ReactNode) {
  return <div style={{ border: "0.5px solid var(--line)", borderRadius: 2 }}>{children}</div>;
}

function BridgeSessionsListView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const sessions = asRecords(rec.sessions);
  return (
    <OpSection label="sessions" aside={<MonoNote>{sessions.length} connected</MonoNote>}>
      {sessions.length === 0 ? (
        <EmptyState note="no revit connected" />
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
    </OpSection>
  );
}

function BridgeSessionSummaryView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const connected = rec.bridgeIsConnected === true;
  const activeDocument = asRecord(rec.activeDocument);
  if (!connected) return <EmptyState note="no revit connected" />;
  const observedAt = asNumber(activeDocument?.observedAtUnixMs);
  return (
    <OpSection label="session">
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
    </OpSection>
  );
}

/* ── logs.tail — tele log lane ────────────────────────────────────────────── */

const LOG_TIMESTAMP = /^(\[?\d{4}-\d{2}-\d{2}[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?\s*)/;

function logLineColor(line: string): string | undefined {
  if (/\b(error|err|fatal)\b/i.test(line)) return "var(--cat-clay)";
  if (/\bwarn(ing)?\b/i.test(line)) return "var(--cat-kiln)";
  return undefined;
}

function LogLine({ line }: { line: string }) {
  const match = line.match(LOG_TIMESTAMP);
  const timestamp = match?.[1] ?? "";
  const rest = timestamp ? line.slice(timestamp.length) : line;
  return (
    <div style={{ whiteSpace: "pre", fontSize: 11, lineHeight: "1.5" }} className="tele">
      {timestamp && <span className="text-muted-foreground">{timestamp}</span>}
      <span style={{ color: logLineColor(rest) }}>{rest}</span>
    </div>
  );
}

function scrollToBottom(el: HTMLDivElement | null) {
  if (el) el.scrollTop = el.scrollHeight;
}

function LogsTailView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const files = asRecords(rec.files);
  if (files.length === 0) return <EmptyState note="no log files in response" />;
  return (
    <div className="flex flex-col gap-4">
      {files.map((file, i) => {
        const lines = asArray(file.lines).flatMap((line) =>
          typeof line === "string" ? [line] : [],
        );
        return (
          <OpSection
            key={asString(file.label) ?? String(i)}
            label={asString(file.label) ?? `log ${i}`}
            aside={<MonoNote>{lines.length} lines</MonoNote>}
          >
            {lines.length === 0 ? (
              <EmptyState note="log empty or unreadable" />
            ) : (
              <div
                ref={scrollToBottom}
                className="overflow-auto px-2 py-1"
                style={{ border: "0.5px solid var(--line)", borderRadius: 2, maxHeight: "18rem" }}
              >
                {lines.map((line, index) => (
                  <LogLine key={index} line={line} />
                ))}
              </div>
            )}
            <Provenance>
              {asString(file.filePath) ?? "path ∅"} · tail only, older lines not fetched
            </Provenance>
          </OpSection>
        );
      })}
    </div>
  );
}

/* ── settings.workspaces — workspace cards ────────────────────────────────── */

function SettingsWorkspacesView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const workspaces = asRecords(rec.workspaces);
  if (workspaces.length === 0) return <EmptyState note="no workspaces" />;
  return (
    <OpSection label="workspaces" aside={<MonoNote>{workspaces.length}</MonoNote>}>
      <div className="flex flex-col gap-2">
        {workspaces.map((workspace, i) => {
          const modules = asRecords(workspace.modules);
          return (
            <div
              key={asString(workspace.workspaceKey) ?? String(i)}
              className="px-3 py-2"
              style={{ border: "0.5px solid var(--line)", borderRadius: 2 }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium">
                  {asString(workspace.displayName) ?? asString(workspace.workspaceKey) ?? "∅"}
                </span>
                <MonoNote>{asString(workspace.workspaceKey) ?? "∅"}</MonoNote>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {modules.map((module, j) => (
                  <Chip key={asString(module.moduleKey) ?? String(j)} hue="blue">
                    {asString(module.moduleKey) ?? "∅"}
                  </Chip>
                ))}
              </div>
              {modules.map((module, j) => {
                const roots = asRecords(module.roots);
                const defaultRootKey = asString(module.defaultRootKey);
                return (
                  <div key={j} className="tele mt-1 text-[10px] text-muted-foreground">
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
    </OpSection>
  );
}

/* ── settings.tree — profiles/fragments/schemas tree ──────────────────────── */

const KIND_HUE: Record<string, CatHue> = {
  Profile: "blue",
  Fragment: "lichen",
  Schema: "slate",
  Other: "kiln",
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
        meta: <Chip hue={KIND_HUE[kind] ?? "slate"}>{kind.toLowerCase()}</Chip>,
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
  if (!rec || !root) return <EmptyState note="unrecognized response shape" />;
  const total = countSettingsFiles(root);
  return (
    <OpSection label="settings tree" aside={<MonoNote>{total} files</MonoNote>}>
      {total === 0 && asRecords(root.directories).length === 0 ? (
        <EmptyState note="no settings documents found" />
      ) : (
        <TreeView nodes={[settingsDirToNode(root, "root")]} dense />
      )}
    </OpSection>
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
          {version && <MonoNote>v{version}</MonoNote>}
          {pod.isValid !== true && <Chip hue="clay">invalid</Chip>}
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
      if (entrypoints.length === 0) return <MonoNote>none</MonoNote>;
      return (
        <span
          className="tele text-[10px]"
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
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const pods = asRecords(rec.pods);
  if (pods.length === 0) return <EmptyState note="no pods in workspace root" />;
  return (
    <OpSection label="pods" aside={<MonoNote>{pods.length}</MonoNote>}>
      <DataTable
        columns={POD_COLUMNS}
        rows={pods}
        rowKey={(pod, i) => asString(pod.workspaceKey) ?? String(i)}
        footer={<Provenance>root: {asString(rec.workspacesRootPath) ?? "∅"}</Provenance>}
      />
    </OpSection>
  );
}

/* ── aps.auth.status — auth card ──────────────────────────────────────────── */

function ApsAuthStatusView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const exists = rec.exists === true;
  const expiresAtUtc = asString(rec.expiresAtUtc);
  const expiryMs = expiresAtUtc ? new Date(expiresAtUtc).getTime() : Number.NaN;
  const state: { label: string; hue: CatHue } = !exists
    ? { label: "no token", hue: "kiln" }
    : Number.isFinite(expiryMs) && expiryMs <= Date.now()
      ? { label: "expired", hue: "clay" }
      : Number.isFinite(expiryMs)
        ? { label: "valid", hue: "green" }
        : { label: "present · expiry unknown", hue: "kiln" };
  return (
    <OpSection label="aps auth" aside={<Chip hue={state.hue}>{state.label}</Chip>}>
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
    </OpSection>
  );
}

/* ── host.ops.catalog — the catalog looking at itself ─────────────────────── */

function opDomain(key: string): string {
  const parts = key.split(".");
  return parts[0] === "revit" && parts.length > 1 ? `revit.${parts[1]}` : parts[0];
}

function HostOpsCatalogView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <EmptyState note="unrecognized response shape" />;
  const operations = asRecords(rec.operations);
  if (operations.length === 0) return <EmptyState note="catalog empty" />;
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
    <OpSection label="op catalog" aside={<MonoNote>{operations.length} ops</MonoNote>}>
      <KVGrid columns={3} items={items} />
      <Provenance>counts by domain prefix, from the live catalog response</Provenance>
    </OpSection>
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
