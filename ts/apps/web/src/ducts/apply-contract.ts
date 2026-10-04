/**
 * The `ducts.apply` answer, as W3's native op will return it.
 * SHIM: replace with the generated DuctsApply types (`@pe/host-contracts/generated`) once
 * `ducts.apply` is in host-ops.generated.ts. The request is `DuctsApplyInput` (agent-contracts),
 * plus the verb's `previewOnly`.
 */
export type DuctWriteOutcome = "planned" | "written" | "refused" | "unchanged";

export interface DuctsApplyResponse {
  previewOnly: boolean;
  writes: {
    /** fitting, terminal, component, equipment, engine, store */
    kind: string;
    outcome: DuctWriteOutcome;
    id?: number | null;
    reason?: string | null;
    /** Display text. */
    before?: string | null;
    after?: string | null;
  }[];
  counts: Record<DuctWriteOutcome, number>;
  systemsAfter?: unknown[] | null;
  /** The store's work revision after the call; unchanged on a preview. */
  storeRevision: number;
}
