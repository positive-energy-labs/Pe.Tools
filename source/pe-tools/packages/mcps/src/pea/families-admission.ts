import {
  addressSchema,
  familiesRouteState,
  familyCellAddress,
  familyCellKey,
  familyCatalogProblem,
  familyCatalogRequest,
  message,
  refuse,
  sameAddress,
  sameValue,
  stagedScope,
  type Address,
  type AppliedFilter,
  type RouteWriteAdmission,
} from "@pe/agent-contracts";

import type { OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";

import { resolveHostBaseUrl } from "../shared/host-config.ts";
import { HostRpcCaller } from "../shared/host-rpc-caller.ts";

/** The families loaded in the Work's document, narrowed by its scope. */
export type LoadedFamilies = (
  target: Address | null,
  scope: AppliedFilter,
) => Promise<readonly { familyName: string; types: readonly { typeName: string }[] }[]>;

/**
 * The Families door. An exclusion is stamped with its writer: every one a write adds or changes
 * says `by` the writer, and Pea never changes or lifts the person's. F-J1-7: a written cell whose
 * key names no type of a family loaded in the Work's scope is refused, whoever writes it. Clearing
 * a cell never asks Revit, so a bad key can always be withdrawn, denied or unstaged.
 */
export function familiesAdmission(loadedFamilies: LoadedFamilies): RouteWriteAdmission {
  return async (doc, patches, { scope: work, actor, prior }) => {
    const parsed = familiesRouteState.schema.parse(doc);
    const { cells, excluded } = parsed;
    const before = familiesRouteState.schema.parse(prior).excluded;
    const by = actor === "agent" ? "pea" : "person";
    for (const id of new Set([...Object.keys(before), ...Object.keys(excluded)])) {
      // `id` is a family name; it stays the key across reloads, which replace the element id.
      if (before[id]?.by === excluded[id]?.by) continue;
      if (actor === "agent" && before[id]?.by === "person")
        return refuse(
          "refused",
          `family "${id}" was held back by the person; Pea cannot change or lift that exclusion`,
          "Nothing was written. Ask the person to include it again.",
        );
      if (excluded[id] && excluded[id].by !== by)
        return refuse(
          "refused",
          `an exclusion is stamped with its writer: excluded[${JSON.stringify(id)}] must be { by: "${by}" }`,
          "Nothing was written.",
        );
    }
    // F-J1-10: every scope rung a write changes names only families loaded under its own
    // categories and placement; an unknown name refuses by name. M13-1: only the rung(s) this write
    // changes, so a stale rung never blocks its own correction.
    const was = familiesRouteState.schema.parse(prior).scope;
    const scopes = (["proposal", "staged"] as const).flatMap((rung) => {
      const written = parsed.scope[rung];
      return written?.value.familyNames.length && !sameValue(written, was[rung])
        ? [written.value]
        : [];
    });
    for (const written of scopes) {
      let known: Set<string>;
      try {
        const loaded = await loadedFamilies(work.target, { ...written, familyNames: [] });
        known = new Set(loaded.map((family) => family.familyName));
      } catch (error) {
        return refuse(
          "refused",
          `The scope's family names cannot be checked against Revit: ${message(error)}`,
          "Nothing was written. Fix what this names, then write again.",
        );
      }
      const unknown = written.familyNames.filter((name) => !known.has(name));
      if (unknown.length)
        return refuse(
          "refused",
          `the scope names ${unknown.length} famil${unknown.length > 1 ? "ies" : "y"} not loaded under its categories and placement: ${unknown.map((name) => JSON.stringify(name)).join(", ")}`,
          "Nothing was written. A scope names families by their exact loaded name, from revit.catalog.loaded-families.",
        );
    }
    const touched = new Set(
      patches.flatMap((patch) =>
        patch.path.length && patch.path[0] !== "cells"
          ? []
          : patch.path.length >= 2
            ? [String(patch.path[1])]
            : Object.keys(cells),
      ),
    );
    const written = [...touched].filter(
      (key) => cells[key]?.proposal != null || cells[key]?.staged != null,
    );
    if (!written.length) return null;
    // M13-2: a cell belongs to a scope someone named: the staged one, else the proposed one.
    const keyed = stagedScope(parsed) ?? parsed.scope.proposal?.value;
    if (!keyed)
      return refuse(
        "refused",
        "Propose or stage a scope before proposing cells",
        "Nothing was written.",
      );
    let families: Awaited<ReturnType<LoadedFamilies>>;
    try {
      families = await loadedFamilies(work.target, keyed);
    } catch (error) {
      return refuse(
        "refused",
        `Family cell keys cannot be checked against Revit: ${message(error)}`,
        "Nothing was written. Fix what this names (the Work's scope, or its document open in Revit), then write again.",
      );
    }
    // ponytail: a same-name pair unions its types here; plan refuses that name as ambiguous.
    const types = new Map<string, Set<string>>();
    for (const family of families) {
      const known = types.get(family.familyName) ?? new Set<string>();
      for (const type of family.types) known.add(type.typeName);
      types.set(family.familyName, known);
    }
    const bad = written.filter((key) => {
      const { familyName, typeName } = familyCellAddress(key);
      return !types.get(familyName)?.has(typeName);
    });
    if (!bad.length) return null;
    const sample = families.find((family) => family.types.length);
    return refuse(
      "refused",
      `${bad.length} cell key(s) name no type of a family loaded in this Work's scope: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ", ..." : ""}`,
      `Nothing was written. A key is [familyName,typeName,parameter]: familyName is a family's exact name from revit.catalog.loaded-families, never an element id, and typeName is one of that family's types${sample ? `, e.g. ${familyCellKey({ familyName: sample.familyName, typeName: sample.types[0]!.typeName, parameter: "<parameter>" })}` : ""}.`,
    );
  };
}

/** One host op call, at a document when `at` names one. */
export type HostCall = <K extends "bridge.sessions.list" | "revit.catalog.loaded-families">(
  key: K,
  request?: OpRequestOf<K>,
  at?: { bridgeSessionId: string; openDocumentId: string },
) => Promise<OpResponseOf<K>>;

const hostCall =
  (host?: string): HostCall =>
  (key, request, at) =>
    new HostRpcCaller({ hostBaseUrl: resolveHostBaseUrl(host), timeoutMs: 30_000, ...at }).call(
      key,
      request,
    );

/** Loopback to the host: the one Revit session holding the Work's document, then its catalog. */
export const hostLoadedFamilies =
  (host?: string, call: HostCall = hostCall(host)): LoadedFamilies =>
  async (target, scope) => {
    if (!target) throw Error("this Families Work names no document");
    const { sessions } = await call("bridge.sessions.list");
    const open = sessions.flatMap((session) =>
      session.connected
        ? (session.openDocuments ?? []).flatMap((doc) => {
            const at = addressSchema.safeParse(doc.address).data;
            return at && sameAddress(at, target)
              ? [{ bridgeSessionId: session.sessionId, openDocumentId: doc.openId }]
              : [];
          })
        : [],
    );
    if (open.length !== 1)
      throw Error(
        open.length
          ? `${target} is open in ${open.length} Revit sessions`
          : `${target} is not open`,
      );
    const catalog = await call(
      "revit.catalog.loaded-families",
      familyCatalogRequest(scope),
      open[0],
    );
    const problem = familyCatalogProblem(catalog);
    if (problem) throw Error(problem);
    return catalog.families;
  };
