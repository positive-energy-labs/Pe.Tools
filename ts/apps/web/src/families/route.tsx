import { RegistryContext } from "@effect/atom-react";
import {
  routeAddress,
  familyCellAddress,
  showFamilyCell,
  type FamiliesRouteDocument,
} from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { Button } from "@pe/kit/lang/button";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ListView } from "@pe/kit/lang/list-view";
import { useList } from "@pe/kit/lang/collection";
import { Switcher } from "@pe/kit/lang/switcher";
import { routeFromGraph, type RouteAdapters, type MountBody } from "#/shell/mount";
import { Ladder } from "#/route/ladder";
import { isSpecOf } from "#/route/workflow";
import { FAMILIES_SPEC_SCHEMAS, familiesGraph, type FamiliesPage } from "./graph";
import { familiesBinding, familiesEditRefusal, familiesWorkRefusal, readingValue } from "./actions";
import { familiesSources } from "./sources";
import { FamiliesProvider } from "./workspace";
import { useFamiliesWorkspace } from "./workspace-context";
import { FamiliesMatrix } from "./matrix";
import { FamiliesProposalsBand, FamiliesReceipts } from "./readout-bands";
import { FamiliesScopeProposal } from "./scope-band";

function ScopeBody({ owner, page }: MountBody<FamiliesPage, FamiliesRouteDocument>) {
  const {
    store,
    archived,
    categories,
    draftCategories,
    pickedFamilies,
    placement,
    familyFeed,
    setPlacement,
    setDraftCategories,
    setPickedFamilies,
  } = useFamiliesWorkspace();
  const history = useList({
    items: store.archive.list,
    keyOf: (row) => row.id,
    search: (row) => ({ text: [row.documentTitle ?? row.document.openId, row.capturedAt] }),
    select: "single",
    onPick: (row) => owner.view.setPage({ past: row.id }),
  });
  if (archived)
    return (
      <ListView
        list={history}
        aria-label="Past family reads"
        row={(row) => ({
          label: row.documentTitle ?? row.document.openId,
          sub: new Date(row.completedAt).toLocaleString(),
          active: row.id === page.past,
        })}
        empty={{ message: "No saved family reads", exit: "Read families in Audit" }}
      />
    );
  return (
    <>
      <Switcher
        ariaLabel="placement"
        value={placement}
        options={["AllLoaded", "PlacedOnly", "UnplacedOnly"].map((value) => ({
          value,
          title:
            value === "AllLoaded"
              ? "Every loaded family"
              : value === "PlacedOnly"
                ? "Families placed in this project"
                : "Loaded families with no placements",
          label:
            value === "AllLoaded" ? "all loaded" : value === "PlacedOnly" ? "placed" : "unplaced",
        }))}
        onChange={(value) => setPlacement(value as typeof placement)}
      />
      <Ladder
        levels={[
          {
            key: "category",
            label: draftCategories.join(", ") || null,
            placeholder: "choose categories",
            options: categories.map((id) => ({ id, label: id })),
            picked: (id) => draftCategories.includes(id),
            pick: (id) =>
              setDraftCategories(
                draftCategories.includes(id)
                  ? draftCategories.filter((name) => name !== id)
                  : [...draftCategories, id],
              ),
          },
          {
            key: "family",
            label: pickedFamilies?.join(", ") ?? "every family",
            placeholder: "choose families",
            options: [...(familyFeed.options ?? [])],
            picked: (id) => pickedFamilies === null || pickedFamilies.includes(id),
            pick: (id) => {
              const all = familyFeed.options?.map((row) => row.id) ?? [];
              const names = pickedFamilies ?? all;
              setPickedFamilies(
                names.includes(id) ? names.filter((name) => name !== id) : [...names, id],
              );
            },
          },
        ]}
      />
    </>
  );
}

function MatrixBody() {
  const { store } = useFamiliesWorkspace();
  return (
    <>
      {store.workUnreadable && (
        <OutcomeLine kind="error" label="Family Work" says="The saved Work cannot be read" />
      )}
      <FamiliesMatrix />
    </>
  );
}

function WorkBody({ owner, verbs }: MountBody<FamiliesPage, FamiliesRouteDocument>) {
  const { store, cells, families } = useFamiliesWorkspace();
  const rows = Object.entries(cells).filter(([, cell]) => cell.edit || cell.suggestion);
  return (
    <>
      <FamiliesScopeProposal />
      <FamiliesProposalsBand />
      {[
        ...new Set([
          ...families.map((family) => family.familyName),
          ...Object.keys(store.excluded),
        ]),
      ].map((name) => (
        <div key={name} role="group" aria-label={`Family ${name}`}>
          <span>
            {name} · {Object.hasOwn(store.excluded, name) ? "held back" : "included"}
          </span>
          {verbs({ name })}
        </div>
      ))}
      {(["scope", "patch"] as const).flatMap((key) => {
        const cell = store.work?.doc[key];
        return cell?.suggestion || cell?.edit
          ? [
              <div key={key} role="group" aria-label={`Cell ${key}`}>
                {verbs({ segment: null, key })}
              </div>,
            ]
          : [];
      })}
      {rows.map(([key, cell]) => (
        <div key={key} role="group" aria-label={`Cell ${key}`} data-key={`cells:${key}`}>
          <Button
            label={`Locate ${key}`}
            onClick={() => owner.view.setPage({ query: familyCellAddress(key).parameter })}
          >
            {showFamilyCell((cell.edit ?? cell.suggestion)!.value)}
          </Button>
          {verbs({ segment: "cells", key })}
        </div>
      ))}
      {store.applyData && (
        <a href={routeAddress("ops").link({ actionId: store.applyData.actionId })}>
          Open family receipt
        </a>
      )}
      <FamiliesReceipts />
    </>
  );
}

function SpecBody({ owner, page }: MountBody<FamiliesPage, FamiliesRouteDocument>) {
  const { store } = useFamiliesWorkspace();
  const pods = readingValue<PodList["pods"]>(store.scope, "pods") ?? [];
  const rows = pods.flatMap((pod) =>
    pod.members
      .filter((member) => FAMILIES_SPEC_SCHEMAS.some((schema) => isSpecOf(member.schema, schema)))
      .map((member) => ({ ...member, pod: pod.id })),
  );
  const list = useList({
    items: rows,
    keyOf: (row) => `${row.pod}/${row.path}`,
    search: (row) => ({ text: [row.pod, row.path] }),
    select: "single",
    onPick: (row) => owner.view.setPage({ pod: row.pod, path: row.path }),
  });
  if (!rows.length)
    return (
      <EmptyState story="scope" exit="Capture families or save a draft into a pod">
        No saved family specs
      </EmptyState>
    );
  return (
    <ListView
      list={list}
      aria-label="Family specs"
      row={(row) => ({
        label: row.path,
        sub: row.pod,
        active: row.pod === page.pod && row.path === page.path,
        actions: (
          <a href={routeAddress("pods").link({ pod: row.pod, path: row.path })}>Open in Pods</a>
        ),
      })}
      empty={{ message: "No family specs", exit: "Capture families into a pod" }}
    />
  );
}

export const familiesAdapters: RouteAdapters<FamiliesPage, FamiliesRouteDocument> = {
  sources: familiesSources(),
  binding: familiesBinding,
  cell: (row, scope) => {
    const value = row as { segment?: string | null; key?: string } | undefined;
    if (!value?.key || !scope.work || familiesWorkRefusal(scope)) return null;
    if (value.segment === "cells" && !familiesEditRefusal(scope))
      return {
        type: "cell:cells",
        id: value.key,
        work: scope.work.handle.key,
        path: ["cells", value.key],
      };
    if (value.segment === null && ["scope", "patch"].includes(value.key))
      return {
        type: `cell:${value.key}`,
        id: value.key,
        work: scope.work.handle.key,
        path: [value.key],
      };
    return null;
  },
  subjects: {},
  verbReadings: {},
  verbDepends: { apply: ["matrix"] },
  receiptPaths: (receipt) => (receipt.key === "families.apply" ? [[]] : []),
  wrap: (owner, children) => (
    <RegistryContext value={owner.registry}>
      <FamiliesProvider owner={owner}>{children}</FamiliesProvider>
    </RegistryContext>
  ),
  bodies: {
    scope: (body) => <ScopeBody {...body} />,
    matrix: () => <MatrixBody />,
    work: (body) => <WorkBody {...body} />,
    spec: (body) => <SpecBody {...body} />,
    history: (body) => <ScopeBody {...body} />,
  },
};
export const familiesRoute = routeFromGraph(familiesGraph, familiesAdapters, "/families");
