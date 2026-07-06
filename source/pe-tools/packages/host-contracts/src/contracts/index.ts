// Hand-authored wire/product contracts: the bridge frame protocol, product
// identity constants, and the runtime op-catalog vocabulary. Op keys and
// request/response types live in ../generated/host-ops.generated.ts (emitted by
// host-typegen from a live session and checked in like a lockfile).
export * from "./product.js";
export * from "./bridge-protocol.js";
export * from "./operation-vocabulary.js";
