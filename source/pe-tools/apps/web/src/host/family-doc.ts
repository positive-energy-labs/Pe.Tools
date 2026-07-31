/**
 * Family-document read/apply over the typed `family.editor.snapshot` and
 * `family.editor.apply` bridge ops (FamilyOnly document kind). The hooks keep
 * the flat shapes the /family-doc audit route renders.
 */
import { useMutation, useQuery } from "@tanstack/react-query";

import { callHostRpc } from "#/host/client";

export interface FamilyDocParameter {
  name: string;
  isInstance: boolean;
  formula: string;
  storageType: string;
  isReadOnly: boolean;
  /** typeName -> display value */
  values: Record<string, string>;
}

export interface FamilyDocSnapshot {
  familyName: string;
  types: string[];
  parameters: FamilyDocParameter[];
}

export interface FamilyDocEdit {
  paramName: string;
  typeName: string;
  value: string;
}

export interface FamilyDocApplyResult {
  applied: number;
  failures: string[];
}

export function useFamilyDocSnapshotQuery(bridgeSessionId?: string) {
  return useQuery({
    queryKey: ["pe-host", bridgeSessionId ?? "", "family-doc-snapshot"],
    queryFn: async (): Promise<FamilyDocSnapshot> => {
      const snapshot = await callHostRpc(
        "family.editor.snapshot",
        {},
        bridgeSessionId ? { bridgeSessionId } : undefined,
      );
      return {
        familyName: snapshot.familyName,
        types: [...snapshot.typeNames],
        parameters: snapshot.parameters.map((param) => ({
          name: param.name,
          isInstance: param.isInstance,
          formula: param.formula ?? "",
          storageType: param.storageType,
          isReadOnly: param.isReadOnly,
          values: param.valuesPerType,
        })),
      };
    },
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });
}

export function useFamilyDocApplyMutation(bridgeSessionId?: string) {
  return useMutation({
    mutationFn: async (edits: FamilyDocEdit[]): Promise<FamilyDocApplyResult> => {
      const result = await callHostRpc(
        "family.editor.apply",
        { edits },
        bridgeSessionId ? { bridgeSessionId } : undefined,
      );
      const failures = result.results
        .filter((edit) => !edit.ok)
        .map((edit) => {
          const source = edits[edit.index];
          const label = source ? `${source.paramName} (${source.typeName})` : `edit ${edit.index}`;
          return `${label}: ${edit.error ?? "failed"}`;
        });
      return { applied: result.applied, failures };
    },
  });
}
