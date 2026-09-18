/** Throwaway interaction model. No host calls; completed sentences retain their original target. */
export interface PrototypeTarget {
  id: string;
  kind: "revit" | "file";
  path: string[];
}
export interface PrototypeReceipt {
  target: PrototypeTarget;
  changes: string[];
}
export interface PrototypeWork {
  target: PrototypeTarget | null;
  changes: string[];
  reviewed: boolean;
  receipts: PrototypeReceipt[];
}
export const emptyPrototypeWork = (): PrototypeWork => ({
  target: null,
  changes: [],
  reviewed: false,
  receipts: [],
});
export type PrototypeEdit =
  | { type: "target"; target: PrototypeTarget | null }
  | { type: "stage"; changes: string[] }
  | { type: "review" }
  | { type: "apply" };
export function editPrototypeWork(state: PrototypeWork, edit: PrototypeEdit): PrototypeWork {
  switch (edit.type) {
    case "target":
      return { ...state, target: edit.target, reviewed: false };
    case "stage":
      return { ...state, changes: [...edit.changes], reviewed: false };
    case "review":
      return state.target && state.changes.length ? { ...state, reviewed: true } : state;
    case "apply":
      if (!state.reviewed || !state.target || !state.changes.length) return state;
      return {
        ...state,
        changes: [],
        reviewed: false,
        receipts: [
          ...state.receipts,
          {
            target: { ...state.target, path: [...state.target.path] },
            changes: [...state.changes],
          },
        ],
      };
  }
}
