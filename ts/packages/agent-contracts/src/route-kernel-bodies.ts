import type { z } from "zod";
import type { CatalogAxes } from "./catalog.ts";
import type { Immutable, RouteGraphJson } from "./route-kernel-data.ts";
import type {
  DecodeResult,
  InvocationToken,
  MoveOrigin,
  MoveResult,
  PageOf,
  PagePatch,
  PagePort,
  RoleKeys,
  SchemaTable,
  SchemaValue,
  WorkOf,
} from "./route-kernel-page.ts";
import type { RouteStateSpec } from "./route-state.ts";
import type { WorkSchema } from "./route-kernel-page.ts";
import type { ExecutionTarget } from "./target.ts";
import type { JournalSubmission, Observation, WorkWriteOutcome } from "./work-journal-door.ts";

/** Projection of the linked catalog, never a route-authored replacement for its axes. */
export interface EntryContract {
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  readonly axes: CatalogAxes;
}
export type EntryTable = Readonly<Record<string, EntryContract>>;
type Input<E extends EntryTable, K> = K extends keyof E ? z.output<E[K]["input"]> : never;
/** ModelWrite intent cannot supply Work identity; the mount binds accepted Work. */
type IntentForEffect<I, Effect> = Effect extends "ModelWrite"
  ? Omit<I, "work"> & { readonly work?: never }
  : I;
type CommandIntent<E extends EntryTable, K> = K extends keyof E
  ? IntentForEffect<Input<E, K>, E[K]["axes"]["effect"]>
  : never;
type Output<E extends EntryTable, K> = K extends keyof E ? z.output<E[K]["output"]> : never;
export type ReadingValue<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  K,
> = K extends keyof G["readings"]
  ? G["readings"][K] extends { output: infer O }
    ? SchemaValue<S, O>
    : G["readings"][K] extends { entry: infer C }
      ? G["readings"][K] extends { geometry: object }
        ? import("./route-kernel-environment.ts").GeometryOutcome<Output<E, C>>
        : Output<E, C>
      : never
  : never;
/** Journal evidence stays attached even when preview decoding or host execution refuses. */
type ReadingEvidence = {
  readonly receipt?: import("./action-receipts.ts").ActionReceipt;
  readonly refusal?: import("./command.ts").CommandRefusal | import("./caller.ts").Refusal;
};
export type ReadingSnapshot<T> = ReadingEvidence &
  (
    | {
        readonly status: "ready";
        readonly current: true;
        readonly value: Immutable<T>;
        readonly hash: string;
      }
    | {
        readonly status: "pending" | "unavailable" | "failed";
        readonly current: false;
        readonly value?: Immutable<T>;
        readonly reason: string;
      }
  );
type Reads<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable, K> = {
  readonly [R in Extract<K, keyof G["readings"]>]: ReadingSnapshot<ReadingValue<G, S, E, R>>;
};
type DepKeys<D, K extends "page" | "work" | "readings"> = D extends {
  deps: { [P in K]: readonly (infer R)[] };
}
  ? R
  : never;
/** The linker validates finite top-level keys. The runtime constructs these projections;
 * it must never pass a full Page/Work object behind a narrowed static type. */
export interface BodyContext<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  D,
> {
  readonly page: Pick<PageOf<G, S>, Extract<DepKeys<D, "page">, keyof PageOf<G, S>>>;
  readonly work: Immutable<Pick<WorkOf<G, S>, Extract<DepKeys<D, "work">, keyof WorkOf<G, S>>>>;
  readonly readings: Reads<G, S, E, DepKeys<D, "readings">>;
}
/** Predicates/salvage are global observers: invalidate on every Page/Work/reading
 * publication. They are never scheduled under a reading's narrower dependency declaration. */
export interface GlobalBodyContext<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
> {
  readonly page: PageOf<G, S>;
  readonly work: Immutable<WorkOf<G, S>> | null;
  readonly readings: Reads<G, S, E, keyof G["readings"]>;
}
type InvocationContext<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  D,
> = BodyContext<G, S, E, D> & {
  /** Mount-issued basis of the accepted Work used by this invocation.
   * Work writes carry it unchanged; routes cannot mint or rebase it. */
  readonly workBasis: InvocationToken | null;
  /** Frozen at invocation capture, separate from invalidating dependencies. */
  readonly captures: Reads<G, S, E, D extends { captures: readonly (infer K)[] } ? K : never>;
};
/** Match route-field.bare: wrappers do not change record/object path eligibility. */
type BareSchema<S> = S extends {
  def: {
    type: "default" | "optional" | "nullable" | "readonly" | "catch" | "prefault";
    innerType: infer I;
  };
}
  ? BareSchema<I>
  : S;
type EntryPatch<K extends string, Key extends string, V extends z.core.SomeType> =
  | { readonly path: readonly [K, Key]; readonly value: z.output<V>; readonly op?: never }
  | { readonly path: readonly [K, Key]; readonly op: "delete"; readonly value?: never }
  | (BareSchema<V> extends z.ZodObject<infer Shape>
      ? {
          [L in keyof Shape & string]: {
            readonly path: readonly [K, Key, L];
            readonly value: z.output<Shape[L]>;
            readonly op?: never;
          };
        }[keyof Shape & string]
      : never);
/** Eligibility comes from ZodRecord, never the structurally identical object output.
 * Paths stay bounded to a root, record entry, or object field within that entry. */
export type WorkPatch<S extends z.ZodType> =
  BareSchema<S> extends z.ZodObject<infer Shape>
    ? {
        [K in keyof Shape & string]:
          | { readonly path: readonly [K]; readonly value: z.output<Shape[K]>; readonly op?: never }
          | (BareSchema<Shape[K]> extends z.ZodRecord<infer Key, infer Value>
              ? EntryPatch<K, Extract<z.output<Key>, string>, Value>
              : never);
      }[keyof Shape & string]
    : never;
export type WorkPatches<G extends RouteGraphJson, S extends SchemaTable> = readonly WorkPatch<
  WorkSchema<G, S>
>[];

type PageVerbPatch<G extends RouteGraphJson, S extends SchemaTable, V> = V extends {
  fields: readonly (infer K)[];
}
  ? Partial<Pick<PageOf<G, S>, Extract<K, RoleKeys<G, "query" | "draft">>>>
  : never;
type VerbInput<
  G extends RouteGraphJson,
  S extends SchemaTable,
  V extends keyof G["verbs"],
> = SchemaValue<S, G["verbs"][V]["input"]>;
/** A description failure refuses before patches or journal submission. */
export type WorkDescriptionRefusal = {
  readonly kind: "refused";
  readonly reason: "describe-threw";
};
/** Preserve the mount's existing outcome, including review preparation before dispatch. */
type VerbOutcome<V> = V extends { kind: "work"; describe: string }
  ? WorkDescriptionRefusal | WorkVerbOutcome<V>
  : WorkVerbOutcome<V>;
type WorkVerbOutcome<V> = V extends { review: "none" }
  ? V extends { kind: "work" }
    ? Observation<WorkWriteOutcome>
    : V extends { kind: "page" }
      ? MoveResult
      : V extends { kind: "command" }
        ? JournalSubmission
        : void
  : V extends { review: "shown" }
    ?
        | { readonly kind: "review"; readonly preview: unknown }
        | (V extends { kind: "command" } ? { readonly kind: "preview" } : never)
    : V extends { kind: "work" }
      ? Observation<WorkWriteOutcome> | { readonly kind: "review"; readonly preview: unknown }
      : unknown;

type Allowed<P> = P extends readonly string[]
  ? P[number]
  : P extends { allowed: readonly string[] }
    ? P["allowed"][number]
    : never;
/** Mount-owned Work history; routes never supply replay callbacks or inverse authority. */
export type HistoryMeta<G extends RouteGraphJson, S extends SchemaTable> = G extends {
  historyDetail: infer K;
}
  ? SchemaValue<S, K>
  : never;
export type WorkHistoryEntry<Meta> = {
  readonly internal?: true;
  readonly id: string;
  readonly press: string;
  readonly label: string;
  readonly by: "human" | "pea";
  readonly at: number;
  readonly state: "applied" | "undone";
} & (
  | { readonly detail: "available"; readonly meta: Immutable<Meta> }
  | { readonly detail: "unavailable" | "none"; readonly meta?: never }
);
export interface WorkHistoryPort<Meta = import("./route-graph.ts").GraphJsonValue> {
  readonly entries: readonly WorkHistoryEntry<Meta>[];
  undo(press?: string): unknown;
  redo(press?: string): unknown;
  revert(press?: string): unknown;
}
/** Recovery is composed by the mount. Routes never receive a raw reset or Work key. */
export interface WorkRecoveryPort {
  state(): Readonly<{
    sentence: string | null;
    startFresh: boolean;
    carryOver: boolean;
    busy: boolean;
    problem: string | null;
  }>;
  startFresh(): Promise<unknown>;
  carryOver(): Promise<unknown>;
}
export type PaneContext<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  P extends keyof G["panes"],
> = {
  readonly page: PagePort<G, S>;
  /** Cell edits share mount custody, captured dependencies and the Work journal. */
  readonly cells: {
    readonly [Kind in "take" | "unsuggest" | "clear"]: <C extends keyof G["cells"] & string>(
      cell: C,
      key: CellKey<S, G["cells"][C]>,
    ) => Observation<WorkWriteOutcome>;
  };
  readonly history?: "work" extends keyof G ? WorkHistoryPort<HistoryMeta<G, S>> : never;
  readonly recovery?: "work" extends keyof G ? WorkRecoveryPort : never;
  readonly work: Immutable<WorkOf<G, S>> | null;
  /** Issued with this rendered Work value. Its token.scope.identity.work is the handle
   * and workRevision is the accepted revision. Kernel membership rejects copied bases. */
  readonly workBasis: InvocationToken | null;
  readonly readings: Reads<G, S, E, G["panes"][P]["draws"][number]>;
  /** Declared explicit geometry readings only. The mount owns invocation and refresh. */
  readonly readingActions?: {
    readonly [K in Extract<
      G["panes"][P]["draws"][number],
      keyof G["readings"]
    > as G["readings"][K] extends { geometry: { representation: "detailed" } } ? K : never]: {
      readDetailed(): void;
      refresh(): void;
    };
  };
  /** Event-only row placement; the mount refuses dispatch during pane draw. */
  readonly place?: G["panes"][P]["verbs"] extends { row: infer R; allowed: readonly (infer V)[] }
    ? (
        row: Immutable<SchemaValue<S, R>>,
        input: unknown,
      ) => Readonly<Partial<Record<Extract<V, string>, () => unknown>>>
    : never;
  readonly readCosts?: Readonly<Record<string, import("./native-read-door.ts").ReadCost>>;
  readonly visible: boolean;
  readonly verbs: {
    readonly [V in Extract<Allowed<G["panes"][P]["verbs"]>, keyof G["verbs"]>]: (
      input: VerbInput<G, S, V>,
      ...basis: G["verbs"][V] extends { kind: "work" } ? [basis: InvocationToken] : []
    ) => VerbOutcome<G["verbs"][V]>;
  };
};
type Slot<Id, Path extends string, Kind extends string, Fn> = Id extends string
  ? { readonly id: Id; readonly slot: Path; readonly kind: Kind; readonly run: Fn }
  : never;
type At<T, K extends PropertyKey> = K extends keyof T ? T[K] : never;
/** Nonempty Work dependencies gate invocation until that Work is loaded. Roster-only
 * bodies can run before Work resolves; panes always account for unavailable Work. */
type Ctx<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable, D> = BodyContext<
  G,
  S,
  E,
  D
>;
type ReadingSlots<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable> = {
  [K in keyof G["readings"] & string]:
    | Slot<
        At<G["readings"][K], "args">,
        `readings.${K}.args`,
        "args",
        (ctx: Ctx<G, S, E, G["readings"][K]>) => Input<E, At<G["readings"][K], "entry">> | null
      >
    | Slot<
        At<G["readings"][K], "derive">,
        `readings.${K}.derive`,
        "derive",
        (ctx: Ctx<G, S, E, G["readings"][K]>) => Immutable<ReadingValue<G, S, E, K>>
      >
    | Slot<
        At<G["readings"][K], "adapter">,
        `readings.${K}.adapter`,
        "adapter",
        (ctx: Ctx<G, S, E, G["readings"][K]>) => Input<E, At<G["readings"][K], "entry">> | null
      >;
}[keyof G["readings"] & string];
type PickerSlots<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable> = {
  [K in keyof G["fields"] & string]: G["fields"][K] extends {
    picker: { reading: infer R; options: infer B };
  }
    ? Slot<
        B,
        `fields.${K}.picker.options`,
        "picker",
        (reading: ReadingSnapshot<ReadingValue<G, S, E, R>>) => readonly {
          readonly id: Exclude<PageOf<G, S>[K], null> extends
            | { kind: "ids"; ids: readonly (infer I)[] }
            | { kind: "all" }
            ? I
            : Exclude<PageOf<G, S>[K], null>;
          readonly label: string;
        }[]
      >
    : never;
}[keyof G["fields"] & string];
type VerbSlots<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable> = {
  [K in keyof G["verbs"] & string]:
    | Slot<
        At<G["verbs"][K], "patches">,
        `verbs.${K}.patches`,
        "work",
        (
          ctx: InvocationContext<G, S, E, G["verbs"][K]>,
          input: VerbInput<G, S, K>,
        ) => WorkPatches<G, S>
      >
    | Slot<
        At<G["verbs"][K], "describe">,
        `verbs.${K}.describe`,
        "describe",
        /** Pure, synchronous presentation, evaluated once from accepted input and declared evidence.
         * No captures, invocation authority, ports or implicit dependencies are provided. */
        (
          input: VerbInput<G, S, K>,
          ctx: BodyContext<G, S, E, G["verbs"][K]>,
        ) => {
          readonly label: string;
          readonly meta?: HistoryMeta<G, S> & import("./route-graph.ts").GraphJsonValue;
        }
      >
    | Slot<
        At<G["verbs"][K], "patch">,
        `verbs.${K}.patch`,
        "page",
        (
          ctx: InvocationContext<G, S, E, G["verbs"][K]>,
          input: VerbInput<G, S, K>,
        ) => PageVerbPatch<G, S, G["verbs"][K]>
      >
    | Slot<
        At<G["verbs"][K], "intent">,
        `verbs.${K}.intent`,
        "intent",
        (
          ctx: InvocationContext<G, S, E, G["verbs"][K]>,
          input: VerbInput<G, S, K>,
        ) => CommandIntent<E, At<G["verbs"][K], "entry">>
      >
    | Slot<
        At<G["verbs"][K], "args">,
        `verbs.${K}.args`,
        "args",
        (
          ctx: InvocationContext<G, S, E, G["verbs"][K]>,
          input: VerbInput<G, S, K>,
        ) => Input<E, At<G["verbs"][K], "entry">>
      >
    | Slot<
        At<G["verbs"][K], "ready">,
        `verbs.${K}.ready`,
        "ready",
        (ctx: InvocationContext<G, S, E, G["verbs"][K]>, input: VerbInput<G, S, K>) => true | string
      >
    | Slot<
        At<G["verbs"][K], "lands">,
        `verbs.${K}.lands`,
        "lands",
        /** Run only on a decoded authoritative committed command result or a successful
         * current query reading, while the invocation
         * remains current. B/C accepts the patch; departure retains the receipt and
         * leaves the replacement Page untouched. Never run on preview, pending, stale, superseded or failed readings. */
        (result: Output<E, At<G["verbs"][K], "entry">>, page: PageOf<G, S>) => PagePatch<G, S>
      >
    | Slot<
        At<G["verbs"][K], "present">,
        `verbs.${K}.present`,
        "present",
        /** Pure synchronous presentation of the sealed preview and invocation-captured display
         * evidence. Freshness follows the invocation; the host seal binds only the write.
         * No ports, captures or invocation authority are exposed. */
        (
          result:
            | Output<E, `${Extract<At<G["verbs"][K], "entry">, string>}.preview`>
            | Output<E, At<G["verbs"][K], "entry">>,
          evidence: Immutable<BodyContext<G, S, E, G["verbs"][K]>>,
        ) => string | { readonly sentence: string; readonly rows: readonly string[] }
      >;
}[keyof G["verbs"] & string];
type PaneSlots<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable, Render> = {
  [K in keyof G["panes"] & string]:
    | Slot<
        At<G["panes"][K], "body">,
        `panes.${K}.body`,
        "pane",
        (ctx: PaneContext<G, S, E, K>) => Render
      >
    | (G["panes"][K]["verbs"] extends {
        choose: infer B;
        row: infer R;
        allowed: readonly (infer V)[];
      }
        ? Slot<
            B,
            `panes.${K}.verbs.choose`,
            "placement",
            (row: Immutable<SchemaValue<S, R>>) => readonly V[]
          >
        : never);
}[keyof G["panes"] & string];
type CellKey<S extends SchemaTable, C> = C extends { key: infer K } ? SchemaValue<S, K> : string;
type CellSlots<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable> = {
  [K in keyof G["cells"] & string]:
    | Slot<
        G["cells"][K]["groupOf"],
        `cells.${K}.groupOf`,
        "group",
        (key: CellKey<S, G["cells"][K]>) => readonly string[]
      >
    | Slot<
        At<G["cells"][K], "show">,
        `cells.${K}.show`,
        "show",
        (value: Immutable<SchemaValue<S, G["cells"][K]["value"]>>) => string
      >
    | Slot<At<G["cells"][K], "label">, `cells.${K}.label`, "label", (group: string) => string>
    | Slot<
        At<G["cells"][K], "focus">,
        `cells.${K}.focus`,
        "focus",
        (key: CellKey<S, G["cells"][K]>) => PagePatch<G, S>
      >
    | Slot<
        At<G["cells"][K], "take">,
        `cells.${K}.take`,
        "take",
        (ctx: Ctx<G, S, E, G["cells"][K]>, key: CellKey<S, G["cells"][K]>) => WorkPatches<G, S>
      >
    | Slot<
        At<G["cells"][K], "admit">,
        `cells.${K}.admit`,
        "admit",
        (
          work: BodyContext<G, S, E, G["cells"][K]>["work"],
          patches: WorkPatches<G, S>,
        ) => DecodeResult<WorkPatches<G, S>>
      >;
}[keyof G["cells"] & string];
/** Pure packaged seed data. D owns acquisition and isolated Work; missing entries stay
 * unavailable rather than falling back to a native source. Seeds grant no write capability. */
export interface RouteSeed<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable> {
  readonly page?: PagePatch<G, S>;
  readonly work?: WorkOf<G, S>;
  readonly works?: Readonly<Record<string, WorkOf<G, S>>>;
  readonly target?: Immutable<ExecutionTarget>;
  readonly readings: { readonly [K in keyof G["readings"]]?: ReadingValue<G, S, E, K> };
  readonly queries?: {
    readonly [K in keyof G["verbs"] as G["verbs"][K] extends { kind: "query" }
      ? K
      : never]?: Output<E, At<G["verbs"][K], "entry">>;
  };
}
/** One id per slot. Admission refuses reuse even when two signatures happen to match.
 * Share implementations by assigning a function to two bindings, never by aliasing a slot id.
 * Render is supplied by the client binding helper; contracts never import React. */
export type BodySlots<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  Render = unknown,
> =
  | (G extends { work: { migrations: infer M } }
      ? {
          [K in keyof M & string]: Slot<
            M[K],
            `work.migrations.${K}`,
            "migration",
            NonNullable<RouteStateSpec<z.ZodType>["migrations"]>[number]
          >;
        }[keyof M & string]
      : never)
  | ReadingSlots<G, S, E>
  | PickerSlots<G, S, E>
  | VerbSlots<G, S, E>
  | PaneSlots<G, S, E, Render>
  | CellSlots<G, S, E>
  | {
      [K in keyof G["predicates"] & string]: Slot<
        G["predicates"][K],
        `predicates.${K}`,
        "predicate",
        (ctx: GlobalBodyContext<G, S, E>) => boolean
      >;
    }[keyof G["predicates"] & string]
  | {
      [K in keyof G["seeds"] & string]: Slot<
        G["seeds"][K]["load"],
        `seeds.${K}.load`,
        "seed",
        () => RouteSeed<G, S, E>
      >;
    }[keyof G["seeds"] & string]
  | Slot<
      At<G["subject"], "show">,
      "subject.show",
      "show",
      (subject: PageOf<G, S>[RoleKeys<G, "subject">]) => string
    >
  | Slot<
      At<G, "subjectText">,
      "subjectText",
      "subject",
      (ctx: GlobalBodyContext<G, S, E>) => string
    >
  | Slot<
      At<G, "transition">,
      "transition",
      "transition",
      (
        current: PageOf<G, S>,
        patch: PagePatch<G, S>,
        origin: MoveOrigin,
        /** Only declared transitionDeps, immutable and current at acceptance. */
        ctx: BodyContext<G, S, E, { deps: At<G, "transitionDeps"> }>,
      ) => DecodeResult<PagePatch<G, S>>
    >
  | Slot<
      At<G, "salvagePresent">,
      "salvagePresent",
      "present",
      (
        result: WorkPatches<G, S>,
        evidence: Immutable<BodyContext<G, S, E, { deps: At<G, "salvageDeps"> }>>,
      ) => string | { readonly sentence: string; readonly rows: readonly string[] }
    >
  | Slot<
      At<G, "salvage">,
      "salvage",
      "salvage",
      (old: unknown, ctx: GlobalBodyContext<G, S, E>) => DecodeResult<WorkPatches<G, S>>
    >;
export type BodyBindings<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  Render = unknown,
> = {
  readonly [B in BodySlots<G, S, E, Render> as B["id"]]: Omit<B, "id"> & {
    readonly source: { readonly module: string; readonly export: string };
  };
};
export type CodecBindings<G extends RouteGraphJson, S extends SchemaTable> = {
  readonly [K in keyof G["fields"] as G["fields"][K] extends { codec: infer C extends string }
    ? C
    : never]: {
    encode(value: PageOf<G, S>[K]): string;
    decode(text: string): DecodeResult<PageOf<G, S>[K]>;
  };
};
