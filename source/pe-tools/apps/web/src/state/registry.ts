import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

export const appAtomRegistry = AtomRegistry.make({ defaultIdleTTL: 400 });
