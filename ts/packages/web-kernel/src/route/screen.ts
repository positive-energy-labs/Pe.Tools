import type { z } from "zod";
import type { CommandHandle } from "@pe/agent-contracts/handle";
import type { NoExtras } from "@pe/agent-contracts/product";
import type { HostRead } from "@pe/agent-contracts/route";
import { route, type Fields, type QueryFields, type Specification } from "./defaults.ts";

type Overlay<S extends { picture?: unknown }> =
  NonNullable<S["picture"]> extends {
    overlay?: infer O;
  }
    ? O
    : never;
/** Per member, so a picture slot with several modes keeps each one's own fields. */
type WithoutOverlay<S> = S extends unknown ? Omit<S, "overlay"> : never;
/**
 * The web half of a product route (ruling 1 of docs/features/routes/MAP.md). The contract declares
 * everything but the drawing; this adds the pane bodies, the layout and the picture overlay, and
 * returns what `route()` returns. A pane the route does not name, or a named pane with no body, is a
 * compile error.
 */
export function screen<
  D,
  const F extends Fields,
  W extends z.ZodObject,
  Edit extends z.ZodType,
  const Reads extends Readonly<Record<string, HostRead>>,
  SubjectRead extends HostRead,
  Pane extends string,
  Drawn extends Readonly<Record<string, unknown>>,
  const Q extends QueryFields = {},
  const V extends Readonly<Record<string, CommandHandle>> = {},
>(
  declared: Omit<
    Specification<D, F, W, Edit, Reads, SubjectRead, Q, V>,
    "panes" | "layout" | "picture"
  > & {
    readonly panes: readonly Pane[];
    readonly picture?: WithoutOverlay<
      NonNullable<Specification<D, F, W, Edit, Reads, SubjectRead, Q, V>["picture"]>
    >;
  },
  parts: Pick<Specification<D, F, W, Edit, Reads, SubjectRead, Q, V>, "panes" | "layout"> & {
    readonly overlay?: Overlay<Specification<D, F, W, Edit, Reads, SubjectRead, Q, V>>;
    // `Reads` widens to every string once one pane names no read, so the drawn keys are inferred apart.
    readonly panes: Drawn &
      Readonly<Record<Pane, unknown>> &
      NoExtras<Drawn, Record<Pane, unknown>>;
  },
) {
  const { overlay, ...drawn } = parts;
  const picture = declared.picture && { ...declared.picture, ...(overlay ? { overlay } : {}) };
  return route<D, F, W, Edit, Reads, SubjectRead, Q, V>({ ...declared, ...drawn, picture });
}
