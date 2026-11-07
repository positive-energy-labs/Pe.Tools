import { inputKinds, type InputKind, type SourceProvenance } from "@pe/agent-contracts";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { Context, Layer } from "effect";
import { InvalidRead } from "./native-reads.ts";
import type { HostInputLane } from "./native-recording.ts";

/** One thing a request is about to use; policy derives its safety from catalogs, never the client. */
export type InputUse =
  | { readonly kind: "input"; readonly input: InputKind }
  | { readonly kind: "native"; readonly key: string }
  | { readonly kind: "command"; readonly key: string }
  | {
      readonly kind: "work";
      readonly verb: "edit" | "undo" | "redo" | "publish" | "retire";
    }
  | { readonly kind: "recording"; readonly verb: "bind-point" | "write-metadata" | "append" };

/** A native bundle records native takings only; every other input kind is outside its coverage. */
const NATIVE_BUNDLE: readonly InputKind[] = ["native"];
const refused = (problem: string, message: string) =>
  new InvalidRead({ message, status: 409, problem });
const historical = (what: string) =>
  refused("recording.historical", `A recording is read-only: ${what} is refused`);
const uncovered = (coverage: readonly InputKind[], needs: readonly InputKind[], what: string) => {
  const missing = needs.filter((kind) => !coverage.includes(kind));
  return missing.length
    ? refused(
        "recording.coverage",
        `This recording does not include the ${missing.join(", ")} inputs ${what} needs`,
      )
    : null;
};

/** The one historical access decision, synchronous so Effect and Promise owners share it. */
function check(lane: HostInputLane, use: InputUse): InvalidRead | null {
  if (lane.kind === "live") return null;
  if (lane.kind === "fixture")
    return refused("recording.fixture", `Host fixture '${lane.name}' has no input source`);
  switch (use.kind) {
    case "input":
      return uncovered(lane.recordingStore.coverage(), [use.input], "this view");
    case "native": {
      const operation = hostOpCatalog.find((entry) => entry.key === use.key);
      if (!operation) return refused("read.contract", `${use.key} has no generated contract`);
      // Catalog-declared rollback inspections replay their kept output and never open a transaction.
      return operation.intent === "Read" &&
        (operation.effect === "Read" ||
          (operation.effect === "TransactRead" && operation.rollsBack))
        ? uncovered(NATIVE_BUNDLE, ["native"], use.key)
        : historical(`${use.key} (${operation.effect})`);
    }
    case "command": {
      const axes = linkedCatalog().entries.get(`command:${use.key}`);
      if (!axes) return refused("read.contract", `${use.key} is not a catalog command`);
      if (axes.effect !== "Read") return historical(`${use.key} (${axes.effect})`);
      // A plan computes from every input it reads; until a bundle covers them all it refuses, and
      // a historical plan never arms Apply because every write above is refused.
      return uncovered(NATIVE_BUNDLE, inputKinds, use.key);
    }
    case "work":
      return historical(`Work ${use.verb}`);
    case "recording":
      return historical(`recording ${use.verb}`);
  }
}

/** Read on every projection: capture can stop while the host runs, and provenance must say so. */
const provenance = (lane: HostInputLane): SourceProvenance => {
  if (lane.kind === "fixture") return { kind: "fixture", name: lane.name };
  if (lane.kind === "live") {
    const truncated = lane.captureStore?.capture.truncated() ?? lane.captureSetup ?? null;
    return {
      kind: "live",
      capturing: lane.captureStore !== undefined && truncated === null,
      ...(truncated ? { truncated } : {}),
    };
  }
  const truncated = lane.recordingStore.truncation;
  return {
    kind: "recording",
    at: lane.at,
    build: lane.recordingStore.identity.build,
    catalog: lane.recordingStore.identity.catalog,
    coverage: [...lane.recordingStore.coverage()],
    ...(truncated ? { truncated } : {}),
  };
};

/** The root-fixed lane of one host runtime, its provenance and its historical access policy. */
export class HostInputContext extends Context.Service<
  HostInputContext,
  {
    readonly lane: HostInputLane;
    readonly source: SourceProvenance;
    readonly check: (use: InputUse) => InvalidRead | null;
  }
>()("pe/HostInputContext") {
  static layer(lane: HostInputLane) {
    return Layer.succeed(HostInputContext, {
      lane,
      get source() {
        return provenance(lane);
      },
      check: (use) => check(lane, use),
    });
  }
}
