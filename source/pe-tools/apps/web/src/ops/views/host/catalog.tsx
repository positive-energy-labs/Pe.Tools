import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid } from "#/ops/primitives";
import {
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
} from "#/ops/registry";
import {
  BridgeSessionSummaryView,
  BridgeSessionsListView,
  HostStatusView,
  LogsTailView,
  MonoAside,
} from "./lanes";
import {
  ApsAuthStatusView,
  ScriptingPodListView,
  SettingsTreeView,
  SettingsWorkspacesView,
  opDomain,
} from "./settings-workspaces";

export function HostOpsCatalogView({ data }: OpViewProps) {
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
