export interface NoRunReason {
  kind:
    | "open"
    | "capped"
    | "flowless-terminal"
    | "foreign-terminal"
    | "no-fan-path";
  at: number;
  /** The open connector (kind "open"); its text names the element, never `id:index`. */
  connector?: number;
  text: string;
}
export interface NoRunBranch {
  elements: number[];
  reasons: NoRunReason[];
}
