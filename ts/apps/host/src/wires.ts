/**
 * THE WIRE MAP: every staged value the web authors, and the native request field it lands on.
 *
 * The generated `HostOps` is the public contract for what crosses the bridge; the host builds those
 * requests untyped (`bridge.invoke(key: string, payload: unknown)`), so nothing said that a family
 * cell became a JSON string before dotnet saw it (crusade review 2026-09-22, signal 4). This table
 * says it. One row per staged-value schema in `@pe/agent-contracts`; the type checker decides the
 * row's shape: when the staged type is assignable to the landing field the row must say
 * `carries: "typed"`, otherwise it must say how the fact is re-encoded and name the hop where it
 * is lost. Fix the wire and the stale `lost` line reddens; add a string hop and `typed` reddens.
 * The check is `vp check` on this file; the failing row names the hop.
 */
import {
  familyCellValueSchema,
  measuredValueSchema,
  parameterLinkProfileSchema,
  stagedRoomEditSchema,
} from "@pe/agent-contracts";
import type { HostOps } from "@pe/host-contracts/generated";

type Request<K extends keyof HostOps> = HostOps[K]["request"];
type Landing<K extends keyof HostOps, F extends keyof Request<K>> = NonNullable<Request<K>[F]>;

type Wire<S, K extends keyof HostOps, F extends keyof Request<K>> = {
  /** A zod schema; `_output` is its parsed type. The host carries no zod dependency, so the shape is structural. */
  readonly staged: { readonly _output: S };
  readonly op: K;
  readonly field: F;
} & ([S] extends [Landing<K, F>]
  ? { readonly carries: "typed" }
  : {
      /** `json-string`: the object is serialized into a string field. `re-encoded`: spread or cast into another shape. `never`: no field of this op receives the value. */
      readonly carries: "json-string" | "re-encoded" | "never";
      /** The hop where a fact is lost, as `path:line what`. */
      readonly lost: string;
    });

const wire = <S, K extends keyof HostOps, F extends keyof Request<K>>(w: Wire<S, K, F>) => w;

export const wires = [
  wire({
    staged: familyCellValueSchema,
    op: "families.plan",
    field: "specJson",
    carries: "json-string",
    lost: "agent-contracts/src/families.ts:249 familyStagedPatch drops storageType and re-encodes the value as a JSON token; apps/host/src/family-actions.ts:593 serializes the patch to specJson",
  }),
  wire({
    staged: familyCellValueSchema,
    op: "families.apply",
    field: "specJson",
    carries: "json-string",
    lost: "same as families.plan; apps/host/src/family-actions.ts:548 forwards the sealed specJson",
  }),
  wire({
    staged: measuredValueSchema,
    op: "schedule.cells.apply",
    field: "edits",
    carries: "re-encoded",
    lost: "apps/host/src/schedule-actions.ts:215 spreads { value, unit } into ScheduleCellEdit.value/unit; :212 casts a z.string() storageType to RequestedParameterStorageType",
  }),
  wire({
    staged: parameterLinkProfileSchema,
    op: "revit.apply.parameter-links",
    field: "profile",
    carries: "typed",
  }),
  wire({
    staged: stagedRoomEditSchema,
    op: "takeoffs.rhvac-links",
    field: "writes",
    carries: "never",
    lost: "apps/host/src/takeoff-actions.ts:448 applyStaged renames seven fields into an RHVAC room and drops `type`; the value reaches a Jet file, never a Revit parameter",
  }),
] as const;
