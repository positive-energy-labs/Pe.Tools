import { useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import { routeAddress, type ActionStatus, type FamilyDraft } from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { Code } from "@pe/kit/lang/code";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ListView } from "@pe/kit/lang/list-view";
import { useList } from "@pe/kit/lang/collection";
import { routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { isSpecOf } from "#/route/workflow";
import { Ladder } from "#/route/ladder";
import { FAMILY_MODEL_SCHEMA, familyGraph, type FamilyPage } from "./graph";
import { familyBinding, familyCell } from "./actions";
import { familySources, readingValue } from "./sources";
import { FamilyProvider } from "./workspace";
import { useFamilyWorkspace } from "./workspace-context";
import { FamilyWorkspaceAnatomy } from "./workspace-anatomy";
import { FamilyWorkspaceTable } from "./workspace-table";
import { FamilyWorkspaceDocPane } from "./workspace-doc-pane";

type Body = MountBody<FamilyPage, FamilyDraft>;
function ParametersBody() {
  const { store } = useFamilyWorkspace();
  return (
    <>
      {store.editFailure && (
        <OutcomeLine kind="refused" label="Family edit" says={store.editFailure.message} />
      )}
      {store.editFailure && (
        <Button
          label="Retry staging"
          onClick={() => void store.actions.flush().catch(() => undefined)}
        >
          Retry staging
        </Button>
      )}
      <FamilyWorkspaceTable />
    </>
  );
}
function WorkBody({ owner, verbs }: Body) {
  const { store } = useFamilyWorkspace();
  const statuses = readingValue<ActionStatus[]>(store.scope.readings.receipts) ?? [];
  return (
    <>
      {store.lane.parseError && (
        <OutcomeLine kind="error" label="Family model" says={store.lane.parseError} />
      )}
      {store.sharedEdit && (
        <OutcomeLine kind="refused" label="Shared source" says={store.sharedEdit.pointer} />
      )}
      {Object.entries(store.fields)
        .filter(([, cell]) => cell.edit || cell.suggestion)
        .map(([key]) => (
          <div key={key} role="group" aria-label={`Cell ${key}`}>
            <Button
              label={`Locate ${key}`}
              onClick={() => owner.view.setPage(familyGraph.cells![0]!.focus!(key))}
            >
              {key}
            </Button>
            {verbs({ key })}
          </div>
        ))}
      {statuses
        .filter((row) => row.key.startsWith("family."))
        .map((row) => (
          <a key={row.id} href={routeAddress("ops").link({ actionId: row.id })}>
            {row.key} · {row.state} · {row.id}
          </a>
        ))}
    </>
  );
}
function SpecBody({ owner, page, verbs }: Body) {
  const { store } = useFamilyWorkspace();
  const pods = readingValue<PodList["pods"]>(store.scope.readings.pods) ?? [];
  const rows = pods.flatMap((pod) =>
    pod.members
      .filter((member) => isSpecOf(member.schema, FAMILY_MODEL_SCHEMA))
      .map((member) => ({ ...member, pod: pod.id })),
  );
  const list = useList({
    items: rows,
    keyOf: (row) => `${row.pod}/${row.path}`,
    search: (row) => ({ text: [row.pod, row.path] }),
    select: "single",
    onPick: (row) => owner.view.setPage({ pod: row.pod, path: row.path }),
  });
  return (
    <>
      <Ladder
        levels={[
          {
            key: "pod",
            label: page.pod || null,
            placeholder: "choose a destination pod",
            options: pods.map((pod) => ({ id: pod.id, label: pod.name })),
            pick: (pod) => owner.view.setPage({ pod, path: "" }),
          },
        ]}
      />
      {rows.length ? (
        <ListView
          list={list}
          aria-label="Family members"
          row={(row) => ({
            label: row.path,
            sub: row.pod,
            active: row.pod === page.pod && row.path === page.path,
            actions: verbs({ source: { pod: row.pod, path: row.path, sha256: row.sha256 } }),
          })}
          empty={{ message: "No matching family members", exit: "Clear the member search" }}
        />
      ) : (
        <EmptyState story="scope" exit="Save a family into a pod">
          No saved family members
        </EmptyState>
      )}
    </>
  );
}
function HistoryBody({ owner, verbs, focusRow }: Body) {
  const [readingId, setReadingId] = useState("");
  const result = owner.results.get("saved");
  const receipt = result?.state === "done" && result.kind === "query" ? result.receipt : null;
  return (
    <>
      <Input
        aria-label="Saved family reading id"
        value={readingId}
        onChange={(event) => setReadingId(event.target.value)}
      />
      <div role="group" aria-label="Saved family reading" onFocus={() => focusRow({ readingId })}>
        {verbs({ readingId })}
      </div>
      {receipt && (
        <Code
          title="Saved family reading"
          lang="json"
          code={JSON.stringify(receipt.value, null, 2)}
        />
      )}
    </>
  );
}
export const familyAdapters: RouteAdapters<FamilyPage, FamilyDraft> = {
  sources: familySources(),
  binding: familyBinding,
  cell: familyCell,
  subjects: {},
  verbReadings: {},
  verbDepends: { apply: ["profile"], build: ["profile"] },
  receiptPaths: (receipt) =>
    receipt.key === "family.apply" || receipt.key === "family.observe" ? [[]] : [],
  wrap: (owner, children) => (
    <RegistryContext value={owner.registry}>
      <FamilyProvider owner={owner}>{children}</FamilyProvider>
    </RegistryContext>
  ),
  bodies: {
    anatomy: () => <FamilyWorkspaceAnatomy />,
    table: () => <ParametersBody />,
    doc: () => <FamilyWorkspaceDocPane />,
    work: (body) => <WorkBody {...body} />,
    spec: (body) => <SpecBody {...body} />,
    history: (body) => <HistoryBody {...body} />,
  },
};
export const familyRoute = routeFromGraph(familyGraph, familyAdapters, "/family");
