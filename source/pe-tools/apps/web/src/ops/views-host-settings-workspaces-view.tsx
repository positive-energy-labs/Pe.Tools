import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import {
  type Column,
  DataTable,
  KVGrid,
  type TreeNode,
  TreeView,
  VizChip,
  type VizIndex,
} from "#/ops/primitives";
import { asRecord, asRecords, asString, type OpViewProps, UnrecognizedShape } from "#/ops/registry";
import { MonoAside } from "./views-host-lanes";

export function SettingsWorkspacesView({ data }: OpViewProps) {
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
              className="rounded-sm border border-line px-3 py-2"
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

export const KIND_VIZ: Record<string, VizIndex> = {
  Profile: 1,
  Fragment: 4,
  Schema: 3,
  Other: 6,
};

export function settingsDirToNode(dir: Record<string, unknown>, path: string): TreeNode {
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

export function countSettingsFiles(dir: Record<string, unknown>): number {
  return (
    asRecords(dir.files).length +
    asRecords(dir.directories).reduce((acc, sub) => acc + countSettingsFiles(sub), 0)
  );
}

export function SettingsTreeView({ data }: OpViewProps) {
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

export type PodRow = Record<string, unknown>;

export const POD_COLUMNS: Column<PodRow>[] = [
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

export function ScriptingPodListView({ data }: OpViewProps) {
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

export function ApsAuthStatusView({ data }: OpViewProps) {
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
          ...(asString(rec.accessToken) ? [{ label: "access token", value: "•••" }] : []),
          ...(asString(rec.refreshToken) ? [{ label: "refresh token value", value: "•••" }] : []),
        ]}
      />
      <Provenance>persisted-token status only — no network call to APS was made</Provenance>
    </Section>
  );
}

export function opDomain(key: string): string {
  const parts = key.split(".");
  return parts[0] === "revit" && parts.length > 1 ? `revit.${parts[1]}` : parts[0];
}
