import type {
  Immutable,
  LayoutJson,
  RouteGraphWire as RouteGraphJson,
  RouteStatePatch,
  RouteStateSpec,
} from "@pe/agent-contracts";
import type { CommandHandle } from "@pe/agent-contracts/command-handle";
import type { Goal, PictureScope, PictureSlot, SheetSlot } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "@pe/agent-contracts/subject-ref";
import type { Publication } from "@pe/agent-contracts/value";
import type { z } from "zod";
import type { Body, BodyKind } from "./body.ts";
import type { HostRead } from "./host-read.ts";
import type {
  DrawContext,
  Fields,
  Page,
  PaneBindings,
  PlannedVerb,
  QueryFields,
  ReadData,
  RunVerb,
  VerbDecl,
} from "./typed-route.ts";

export type RoleFields<F extends Fields, R extends Fields[string]["role"]> = {
  [K in keyof F]: R extends F[K]["role"] ? K : never;
}[keyof F];

type HandlesOf<V> = {
  readonly [K in keyof V]: V[K] extends { plan: object } ? PlannedVerb : RunVerb;
};

type Owner = { state: RouteStateSpec<z.ZodObject>; value?: string };
export type Owners = Readonly<Record<string, Owner>>;

/** Layout is data (ADR 0035 rule 5, `route/body.ts`): a pane declares its body kind and `draw`
 * returns that kind's branded `Body`, so the declaration and the drawing cannot disagree. */
type PaneBody<C> = { [B in BodyKind]: { body: B; draw(ctx: C): Body<B> } }[BodyKind];
export type Specification<
  D,
  F extends Fields,
  W extends z.ZodObject,
  Edit extends z.ZodType,
  Reads extends Readonly<Record<string, HostRead>> = Readonly<Record<string, HostRead>>,
  SubjectRead extends HostRead = HostRead,
  Q extends QueryFields = {},
  V extends Readonly<Record<string, CommandHandle>> = Readonly<Record<string, CommandHandle>>,
> = {
  key: string;
  /** Saved Page vocabulary that this product explicitly retired, without aliases. */
  retiredPage?: {
    readonly fields?: readonly string[];
    readonly values?: Readonly<Record<string, readonly string[]>>;
  };
  address?: string;
  name: string;
  /** Person-only surfaces opt out of both builtin and admitted Page leases. */
  agent?: false;
  directory: RouteGraphJson["directory"];
  needs?: "project" | "family" | "document" | "host" | "browser";
  optionalTarget?: "document" | "project" | "family" | "session";
  /** `./host.ts`, the route directory's reads; only the generated host registry imports it. */
  host?: string;
  subject?: {
    field: RoleFields<F & NoInfer<Q>, "subject"> & string;
    noun: string;
    multiple?: boolean;
    pane: string;
    read?: SubjectRead;
    options(
      data: Immutable<ReadData<SubjectRead>>,
    ): readonly { id: SubjectRefCode; label: string }[];
  };
  core?: HostRead & {
    output: z.ZodType<Publication<D>>;
    args(page: Page<F & NoInfer<Q>>): unknown;
  };
  /*
   * ADR 0035 rule 1: the five slots are `subject` (above), `sheet`, `picture`, `goal` and `layout`
   * (below), plus `query` and `title(ctx)`. Types are inferred from the declaration, never
   * generated (rule 4). The kernel seams that fill each slot live in `./slots/<slot>/`; until a
   * slice lands, a seam throws `not implemented: slice N`. `fields` stands until slice 10 moves the
   * subject into `subject`, the pose into `picture` and the rest into `query`.
   */
  /** Slice 7: bindings by cell name, three closed kinds; the kernel draws a StateCell per binding per row. */
  sheet?: SheetSlot;
  /** Slice 8: a scope (SubjectRef set, box, or prism with a frame) and marks from the closed set; the kernel draws
   * them in its picture pane. `overlay` is the one hook for what the closed marks cannot express: a builtin
   * loads it with `overlay()` (`slots/picture/overlay.tsx`, which types its parts); a Pod declares none. */
  picture?: PictureSlot<
    DrawContext<
      NoInfer<D>,
      NoInfer<F & NoInfer<Q>>,
      z.output<W>,
      z.output<Edit>,
      HandlesOf<NoInfer<V>>
    >
  > & {
    overlay?(props: {
      ctx: DrawContext<
        NoInfer<D>,
        NoInfer<F & NoInfer<Q>>,
        z.output<W>,
        z.output<Edit>,
        HandlesOf<NoInfer<V>>
      >;
      scope: PictureScope;
      picture(parts: any): any;
    }): unknown;
  };
  /** Slice 7: one host Read whose data is the Goal; the kernel draws its unresolved list first. */
  goal?: HostRead & {
    output: z.ZodType<Publication<Goal>>;
    args(page: Page<NoInfer<F & NoInfer<Q>>>): unknown;
  };
  /** Route-owned Page fields no slot holds; folded into `fields` for projection until slice 10 retires `fields`. */
  query?: Q;
  /** The pane head's title (ADR 0035 rule 5): the kernel draws it in the head of the first pane, in layout
   * order, that is not the subject list. Null draws nothing. */
  title?(
    ctx: DrawContext<
      NoInfer<D>,
      NoInfer<F & NoInfer<Q>>,
      z.output<W>,
      z.output<Edit>,
      HandlesOf<NoInfer<V>>
    >,
  ): string | null;
  fields: F;
  reads?: Readonly<Record<string, HostRead & { args(page: Page<F & NoInfer<Q>>): unknown }>>;
  panes: {
    readonly [K in keyof Reads]: {
      title: string;
      purpose: string;
      subjectList?: true;
      /** A pane the shell draws from a filled slot (`typed-shell.tsx`); the route names and places it, and its `draw` is unused. */
      kernel?: "sheet" | "goal" | "picture";
      /** The pane's ground (kit `Pane`): `artifact` lets support heads inside it recede (L4). */
      ground?: "artifact";
      read?: Reads[K];
      /** The verbs this pane's body draws. A verb is on the band or in exactly one pane. */
      verbs?: readonly (keyof NoInfer<V> & string)[];
      bindings?(
        ctx: DrawContext<
          ReadData<Reads[K]>,
          F & NoInfer<Q>,
          z.output<W>,
          z.output<Edit>,
          HandlesOf<NoInfer<V>>
        >,
      ): PaneBindings;
    } & PaneBody<
      DrawContext<
        ReadData<Reads[K]>,
        F & NoInfer<Q>,
        z.output<W>,
        z.output<Edit>,
        HandlesOf<NoInfer<V>>
      >
    >;
  };
  edits?: {
    work: W | RouteStateSpec<W>;
    key?(page: Page<F & NoInfer<Q>>): string | null;
    seed?(
      page: Page<F & NoInfer<Q>>,
      target: import("@pe/agent-contracts").ExecutionTarget | null,
    ): z.output<W>;
    value?: keyof D & string;
    owners: Owners;
    input: Edit;
    patches(input: z.output<Edit>, data: Immutable<D>): readonly RouteStatePatch[];
    history: z.ZodType;
    describe(history: any): { label: string; meta?: unknown };
  };
  /** Keyed by verb id, which is not the catalog key: two verbs may share one handle. */
  verbs?: {
    readonly [K in keyof V]: VerbDecl<
      { page: Page<F & NoInfer<Q>>; value: Immutable<D>; doc: Immutable<z.output<W>> },
      V[K]
    >;
  };
  /** The verbs the shell draws on the band, the first primary. */
  band?: readonly (keyof NoInfer<V> & string)[];
  layout: LayoutJson;
};
