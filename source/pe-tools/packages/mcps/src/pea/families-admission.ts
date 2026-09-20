import {
  addressSchema,
  familiesRouteState,
  familyCellAddress,
  familyCellKey,
  FAMILY_CATALOG_LIMIT,
  message,
  refuse,
  sameAddress,
  type Address,
  type AppliedFilter,
  type RouteWriteAdmission,
} from "@pe/agent-contracts";

import { resolveHostBaseUrl } from "../shared/host-config.ts";
import { HostRpcCaller } from "../shared/host-rpc-caller.ts";

/** The families loaded in the Work's document, narrowed by its scope. */
export type LoadedFamilies = (
  target: Address | null,
  scope: AppliedFilter | null,
) => Promise<readonly { familyName: string; types: readonly { typeName: string }[] }[]>;

/**
 * The Families door. An exclusion is stamped with its writer: every one a write adds or changes
 * says `by` the writer, and Pea never changes or lifts the person's. F-J1-7: a written cell whose
 * key names no type of a family loaded in the Work's scope is refused, whoever writes it. Clearing
 * a cell never asks Revit, so a bad key can always be withdrawn, denied or unstaged.
 */
export function familiesAdmission(loadedFamilies: LoadedFamilies): RouteWriteAdmission {
  return async (doc, patches, { scope: work, actor, prior }) => {
    const { cells, scope, excluded } = familiesRouteState.schema.parse(doc);
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
    let families: Awaited<ReturnType<LoadedFamilies>>;
    try {
      families = await loadedFamilies(work.target, scope);
    } catch (error) {
      return refuse(
        "refused",
        `Family cell keys cannot be checked against Revit: ${message(error)}`,
        "Nothing was written. Open the Work's document in Revit, then write again.",
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

/** Loopback to the host: the one Revit session holding the Work's document, then its catalog. */
export const hostLoadedFamilies =
  (host?: string): LoadedFamilies =>
  async (target, scope) => {
    if (!target) throw Error("this Families Work names no document");
    const hostBaseUrl = resolveHostBaseUrl(host);
    const { sessions } = await new HostRpcCaller({ hostBaseUrl, timeoutMs: 30_000 }).call(
      "bridge.sessions.list",
    );
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
    const catalog = await new HostRpcCaller({ hostBaseUrl, timeoutMs: 30_000, ...open[0] }).call(
      "revit.catalog.loaded-families",
      { ...(scope ? { filter: scope } : {}), budget: { maxEntries: FAMILY_CATALOG_LIMIT } },
    );
    if (catalog.summary.truncated)
      throw Error(`the scope resolves more than ${FAMILY_CATALOG_LIMIT} families; narrow it`);
    return catalog.families;
  };
