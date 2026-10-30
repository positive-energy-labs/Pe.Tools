import type { DuctsRouteDocument } from "@pe/agent-contracts";

import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";

import { applyRequest, rememberPrice } from "@pe/ducts-domain/pricing";

import { pendingCount, stagedEsp } from "@pe/ducts-domain/staged";

import { healOf, healTarget, fanOf, offeredFan } from "@pe/ducts-domain/action-targets";

import { healRequestGroup } from "@pe/ducts-domain/heal";

import { scopeOf, systemScope } from "@pe/ducts-domain/system-scope";

import { unitFlowsIn } from "@pe/ducts-domain/survey";

import { withStoredRulings } from "@pe/ducts-domain/rulings";

import type { DuctSnapshot } from "@pe/ducts-domain/types";

import type { Grids } from "@pe/ducts-domain/loss-grid";

import type { BindingScope, MountBinding } from "#/shell/mount-owner";

import type { ReadingState } from "#/shell/readings";

import { triage, holding, espWaits } from "./inbox-rows";

import { airflowOptions } from "./airflow";

import { elementNamer } from "./claims";

import { activeSystem } from "./selection";

import type { DuctsPage } from "./graph";

import type { PricingResult } from "./pricing-job";

type Scope = BindingScope<DuctsPage, DuctsRouteDocument>;

function current<T>(scope: Scope, id: string): T {
  const reading = scope.readings[id];

  if (reading?.status === "failed")
    throw Error(`${id} failed: ${reading.error ?? "unknown error"}`);

  if (!reading?.current || reading.value == null) throw Error(`Reading ${id} is refreshing`);

  return reading.value as T;
}

function pricing(scope: Scope) {
  if (!scope.work) throw Error("Read this document's Work before writing");

  const result = current<PricingResult>(scope, "pricing");

  if (scope.readings.pricing!.basis?.workRevision !== scope.work.handle.revision)
    throw Error("Pricing is refreshing; wait for this Work revision before writing");

  const snapshot = current<DuctSnapshot>(scope, "ducts");

  const grids = current<Grids>(scope, "tables");

  const catalogs = current<{ tables: Catalogs }>(scope, "catalogs").tables ?? EMPTY_CATALOGS;

  rememberPrice(snapshot, grids, scope.work.doc, catalogs, result.priced);

  return { result, snapshot, grids, catalogs, doc: scope.work.doc };
}

// One request per immutable reading basis keeps the ticket and every placement's binding identical.

const requests = new WeakMap<ReadingState, Map<string, ReturnType<typeof applyRequest>>>();

export function priceRequest(scope: Scope) {
  const { result, snapshot, doc } = pricing(scope);

  if (!pendingCount(doc, snapshot.store)) throw Error("Nothing edit");

  if (snapshot.storeError)
    throw Error(`Pe's provenance store is unreadable: ${snapshot.storeError}`);

  const active = activeSystem(scope.page);

  const groups = active ? systemScope(snapshot, active).groups : [];

  if (active && !groups.length) throw Error(`No duct network in this snapshot carries ${active}`);

  const state = scope.readings.pricing!;

  let bySystem = requests.get(state);

  if (!bySystem) requests.set(state, (bySystem = new Map()));

  if (bySystem.has(active)) return bySystem.get(active)!;

  let request = {
    ...applyRequest(snapshot, result.priced, new Date().toISOString(), groups),
    slots: snapshot.slots,
  };

  if (stagedEsp(doc)) {
    const priced = result.priced;

    const selected = scopeOf(priced.snapshot, active ? [active] : []);

    const rows = triage({
      snapshot: priced.snapshot,
      scope: selected,
      findings: priced.findings,
      flows: priced.flows,

      equipmentFlows: unitFlowsIn(priced, selected?.groups ?? null),
      doc: withStoredRulings(doc, snapshot.store),

      airflow: airflowOptions(priced.snapshot, selected),
      unitAirflow: airflowOptions(priced.snapshot, selected, "unit"),
      roles: priced.roles,
    });

    const held = espWaits({ fix: holding(rows.fix), set: rows.set.length });

    if (held) {
      if (pendingCount(doc, snapshot.store) === stagedEsp(doc))
        throw Error(`Only the ESP is edit: ${held}`);

      request = { ...request, equipment: [] };
    }
  }

  bySystem.set(active, request);

  return request;
}

/** Bind semantic intent over exactly the reading values the kernel currently admits. */

export function ductsBinding(id: string, row: unknown, scope: Scope): MountBinding {
  id =
    (
      { preview: "price", "heal-preview": "heal", "fan-preview": "assign-fan" } as Record<
        string,
        string
      >
    )[id] ?? id;
  if (id === "refresh") return { subject: null, args: {} };

  if (id === "edit" || id.startsWith("sheet-")) return { subject: null, args: row };

  const named = (row ?? {}) as { group?: string; unitId?: number; systemId?: number };

  try {
    const { snapshot, doc, grids, catalogs } = pricing(scope);

    let request: unknown;

    if (id === "price") request = priceRequest(scope);
    else if (id === "heal") {
      const active = activeSystem(scope.page);

      const group = named.group ?? healTarget(snapshot, doc, active, scope.page.selected, null);

      if (active && !systemScope(snapshot, active).groups.includes(group))
        throw Error(`Open this network's system last to heal it; active system is ${active}`);

      request = { groups: [healRequestGroup(healOf(snapshot, doc, group))] };
    } else if (id === "assign-fan") {
      const pair =
        named.unitId != null && named.systemId != null
          ? { unitId: named.unitId, systemId: named.systemId }
          : offeredFan(
              snapshot,
              doc,
              grids,
              catalogs,
              activeSystem(scope.page),
              scope.page.selected,
              null,
              elementNamer(snapshot, null),
            );

      if (
        snapshot.systems.find((system) => system.id === pair.systemId)?.name !==
        activeSystem(scope.page)
      )
        throw Error("Open this system last to assign its fan");

      fanOf(snapshot, pair);

      request = { unitId: pair.unitId, systemId: pair.systemId };
    }

    return { subject: null, args: { request, refusal: null } };
  } catch (error) {
    return {
      subject: null,
      args: { refusal: error instanceof Error ? error.message : String(error) },
    };
  }
}
