/** Facts consumed by shared presentation instruments; no route declaration or executor. */
export type TargetNeed = "host" | "session" | "document" | "project" | "family";
export interface ActionFacts {
  says: string;
  needs: TargetNeed;
  effect?: "query" | "command";
}
export interface PresentationFacts<R extends string = string> {
  key: string;
  inspectables?: Readonly<Record<string, import("./inspect").Inspectable>>;
  readings?: Readonly<Partial<Record<R, unknown>>>;
  actions?: Readonly<Record<string, { dirties?: readonly R[]; rereads?: R | "work" }>>;
}
