import { type AppliedFilter, type DocumentRef, type WorkKey } from "@pe/agent-contracts";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";

import { callHostRpc, hostUrl } from "#/host/client";
import { readReading, type FieldOptionsData } from "#/readings";

export type FamiliesDraft = {
  placement: AppliedFilter["placementScope"];
  categories: string[];
  families: string[] | null;
};

export interface FamiliesObservation {
  id: string;
  work: WorkKey;
  document: DocumentRef;
  documentTitle?: string;
  filter: AppliedFilter;
  capturedAt: string;
  completedAt: string;
  readback?: { sourceId: string; verifiedFamilies: { name: string; at: string }[] };
  result: RevitMatrixLoadedFamilies.Res.Response;
}

export type FamiliesObservationSummary = Omit<FamiliesObservation, "result"> & {
  familyCount: number;
  typeCount: number;
  issueCount: number;
};

export async function readFamiliesObservation(
  work: WorkKey,
  document: DocumentRef,
  filter: AppliedFilter,
): Promise<FamiliesObservation> {
  const response = await fetch(hostUrl("/families/readings"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HOST_RPC_BRIDGE_SESSION_HEADER]: document.session,
      [HOST_RPC_DOCUMENT_HEADER]: document.openId,
    },
    body: JSON.stringify({ work, filter }),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error ?? `Families read failed (${response.status})`);
  return body as FamiliesObservation;
}

export async function latestFamiliesObservation(
  work: WorkKey,
): Promise<FamiliesObservation | null> {
  const response = await fetch(
    hostUrl(`/families/readings?work=${encodeURIComponent(JSON.stringify(work))}`),
  );
  const body = await response.json();
  if (!response.ok) throw Error(body.error ?? `Families observation failed (${response.status})`);
  return body as FamiliesObservation | null;
}

export async function archivedFamiliesObservations(): Promise<FamiliesObservationSummary[]> {
  const response = await fetch(hostUrl("/families/readings"));
  const body = await response.json();
  if (!response.ok) throw Error(body.error ?? `Families archive failed (${response.status})`);
  return body as FamiliesObservationSummary[];
}

export async function archivedFamiliesObservation(id: string): Promise<FamiliesObservation> {
  const response = await fetch(hostUrl(`/families/readings?id=${encodeURIComponent(id)}`));
  const body = await response.json();
  if (!response.ok) throw Error(body.error ?? `Families observation failed (${response.status})`);
  return body as FamiliesObservation;
}

export interface FamiliesHost {
  categories(target: DocumentRef): Promise<string[]>;
  families(
    target: DocumentRef,
    draft: FamiliesDraft,
  ): Promise<{ id: string; label: string; categoryName: string | null }[]>;
  /** Every loaded family's name by its current element id, whatever the scope. */
  namesById(target: DocumentRef): Promise<Map<number, string>>;
}

export function createLiveFamiliesHost(): FamiliesHost {
  return {
    // The filter DTO's `[FieldOptions("category-names")]` domain, read through the form's Reading.
    async categories(target) {
      const result = (await readReading({
        kind: "field-options",
        target,
        key: "category-names",
      })) as FieldOptionsData;
      return result.items.map((item) => item.value).sort((a, b) => a.localeCompare(b));
    },
    async families(target, draft) {
      const result = await callHostRpc(
        "revit.catalog.loaded-families",
        {
          filter: {
            categoryNames: draft.categories,
            placementScope: draft.placement,
          },
          budget: { maxEntries: 5000 },
        },
        { bridgeSessionId: target.session, openDocumentId: target.openId },
      );
      return result.families
        .filter((family) => family.familyName.trim())
        .map((family) => ({
          id: family.familyName,
          label: family.familyName,
          categoryName: family.categoryName ?? null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    async namesById(target) {
      const result = await callHostRpc(
        "revit.catalog.loaded-families",
        { filter: {}, budget: { maxEntries: 5000 } },
        { bridgeSessionId: target.session, openDocumentId: target.openId },
      );
      return new Map(result.families.map((family) => [family.familyId, family.familyName]));
    },
  };
}
