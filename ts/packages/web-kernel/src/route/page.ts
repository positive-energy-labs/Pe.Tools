import { focusSelectionSchema, type Immutable } from "@pe/agent-contracts";
import type { FieldHistory, FieldRole, TargetField, TargetFocus } from "@pe/agent-contracts/route";
import type { z } from "zod";
import { decodeField, type FieldCodec } from "./field-codec.ts";
import type { RoleFields } from "./specification.ts";

type Field = {
  schema: z.ZodType;
  initial: unknown;
  url: FieldHistory;
  share?: false;
  codec?: FieldCodec;
} & (
  | { role: FieldRole; target?: undefined }
  | { role: "query"; target: Exclude<TargetField, "subject"> }
  | { role: "subject"; target: "subject" }
);

export type Fields = Readonly<Record<string, Field>>;
/** Route-owned Page fields no slot holds (ADR 0035 rule 1). */
export type QueryFields = Readonly<Record<string, Field & { role: "query" }>>;
type FieldValues<F extends Fields> = {
  readonly [K in keyof F]: Immutable<z.output<F[K]["schema"]>>;
};
export type Page<F extends Fields> = FieldValues<F> & {
  readonly selected: readonly { kind: "focus"; id: string }[];
};
declare const admittedPage: unique symbol;
export type AdmittedPage<F extends Fields = Fields> = Page<F> & {
  readonly [admittedPage]: true;
};
export type DrawPage<F extends Fields> = {
  read(): Page<F>;
  pose(
    patch: Partial<Pick<FieldValues<F>, RoleFields<F, "pose" | "stage">>>,
    intent?: "gesture" | "named",
  ): unknown;
  query(patch: Partial<Pick<FieldValues<F>, RoleFields<F, "query">>>): unknown;
  select(value: Page<F>["selected"]): unknown;
};

export const focusField = { schema: focusSelectionSchema, initial: [] };

/** Only the local part of a remembered Page may accompany a new model binding. */
export function localPage(
  spec: {
    fields: Fields;
    focus?: TargetFocus | null;
  },
  memory: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const local = Object.fromEntries(
    Object.entries(memory).filter(([key]) => !spec.fields[key]?.target),
  );
  const { focus } = spec;
  if (focus && local.selected !== undefined) {
    const selected = focusSelectionSchema
      .parse(decodeField(focusField, local.selected))
      .filter(({ id }) => !focus.owns(id));
    if (selected.length) local.selected = selected;
    else delete local.selected;
  }
  return local;
}
