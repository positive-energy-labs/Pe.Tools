import { z } from "zod";
import { listSearchSchema, type FieldDecl } from "@pe/agent-contracts";
import { bare } from "../../../../packages/agent-contracts/src/route-field";
import { Button } from "@pe/kit/lang/button";
import { Input, Label } from "@pe/kit/lang/input";
import { SearchControl } from "@pe/kit/lang/search-control";
import { Ladder } from "../route/ladder";
export function PageControl({
  id,
  field,
  value,
  enabled,
  options,
  set,
}: {
  id: string;
  field: FieldDecl;
  value: unknown;
  enabled: boolean;
  options?: readonly { id: string; label: string }[];
  set(this: void, value: unknown): void;
}) {
  const schema = bare(field.schema);
  const label = field.label ?? id;
  const search = schema.def.type === "object" ? listSearchSchema.safeParse(value) : null;
  if (search?.success)
    return (
      <Label>
        {label}
        <SearchControl
          chips={search.data.pills.map((pill, index) => (
            <Button kind="quiet"
              key={index}
              label={`Remove ${pill.field} filter`}
              refusal={!enabled ? "This route is inactive" : null}
              onClick={() =>
                set({ ...search.data, pills: search.data.pills.filter((_, at) => at !== index) })
              }
            >
              {pill.field} = {pill.value}
            </Button>
          ))}
        >
          <Input
            aria-label={label}
            disabled={!enabled}
            value={search.data.keywords}
            onChange={(event) => set({ ...search.data, keywords: event.target.value })}
          />
        </SearchControl>
      </Label>
    );
  if (field.picker || schema instanceof z.ZodEnum) {
    const choices =
      options ??
      Object.values((schema as z.ZodEnum).enum).map((id) => ({
        id: String(id),
        label: String(id),
      }));
    const multi = field.cardinality === "many" || Array.isArray(value);
    const selected =
      value === "all"
        ? choices.map((choice) => choice.id)
        : multi
          ? (value as string[])
          : [typeof value === "string" ? value : ""];
    return (
      <Ladder
        disabled={!enabled}
        levels={[
          {
            key: label,
            label:
              selected
                .filter(Boolean)
                .map((id) => choices.find((option) => option.id === id)?.label ?? id)
                .join(" + ") || null,
            placeholder: field.picker?.placeholder ?? `choose ${label}`,
            options: choices,
            multi,
            picked: (id) => selected.includes(id),
            pick: (id) =>
              set(
                multi
                  ? selected.includes(id)
                    ? selected.filter((key) => key !== id)
                    : [...selected, id]
                  : id,
              ),
          },
        ]}
      />
    );
  }
  if (schema.def.type === "boolean")
    return (
      <Label>
        {label}
        <input
          type="checkbox"
          aria-label={label}
          disabled={!enabled}
          checked={value === true}
          onChange={(event) => set(event.target.checked)}
        />
      </Label>
    );
  // Free text is declared, never inferred: a bare string has a roster somewhere, and an empty box
  // beside the route's name reads as a question nobody asked. Structured values need a picker.
  if (field.editor !== "text" || !["string", "number"].includes(schema.def.type)) return null;
  return (
    <Label>
      {label}
      <Input
        aria-label={label}
        disabled={!enabled}
        type={schema.def.type === "number" ? "number" : "text"}
        value={field.codec.encode(value)}
        onChange={(event) => set(field.codec.decode(event.target.value))}
      />
    </Label>
  );
}
