// Builtin closures are untracked build output of scripts/route-graphs.ts: typed here so a clean
// checkout type-checks before any producer run. Runtime parsing (registry.ts) stays strict.
declare module "*/source-closure.generated.json" {
  // A JSON import is mutable, like the type TS infers when the file exists.
  type Json<T> = T extends readonly (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Json<T[K]> }
      : T;
  const closure: Json<{
    fingerprint: string;
    envelope: import("../../../../packages/agent-contracts/src/route-module.ts").BuiltinClosure;
  }>;
  export default closure;
}
