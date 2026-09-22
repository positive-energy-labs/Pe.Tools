import { useMemo } from "react";

import { ListChips, ListPopup } from "#/components/lang/list-popup";
import { useHostOp } from "#/readings";
import type { ParameterReference } from "@pe/agent-contracts";

export type FieldOption = {
  value: string;
  label: string;
  description?: string | null;
  metadata?: Record<string, string> | null;
};

export function parameterReferenceFromOption(option: FieldOption): ParameterReference {
  const metadata = option.metadata;
  if (!metadata?.key || !metadata.kind || !metadata.name) {
    throw new Error(`Parameter option '${option.value}' is missing canonical identity metadata`);
  }
  return {
    identity: {
      key: metadata.key,
      kind: metadata.kind as NonNullable<ParameterReference["identity"]>["kind"],
      name: metadata.name,
      builtInParameterId: numberOrNull(metadata.builtInParameterId),
      sharedGuid: metadata.sharedGuid ?? null,
      parameterElementId: numberOrNull(metadata.parameterElementId),
    },
  };
}

function numberOrNull(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useFieldOptions(
  sourceKey: string,
  contextValues: Record<string, string> = {},
  bridgeSessionId?: string,
  enabled = true,
  openDocumentId?: string,
) {
  const query = useHostOp(
    "revit.catalog.field-options",
    { sourceKey, contextValues },
    { bridgeSessionId, openDocumentId, enabled },
  );
  const items = (query.data?.items ?? []).filter(
    (item) => typeof item.value === "string" && typeof item.label === "string",
  );
  // Pending and failed are states of the list, never an empty list (R7).
  const status = query.pending ? "pending" : query.error ? "failed" : "ready";
  return { ...query, items, status } as const;
}

export type FieldOptionStatus = "ready" | "pending" | "failed";

const optionRow = (option: FieldOption & { stale?: boolean }) => ({
  label: option.label,
  sub: option.description ?? undefined,
  lines: option.description ? (2 as const) : (1 as const),
  refusal: option.stale ? "not in the model now" : null,
});

export function FieldOptionSelect({
  items,
  value,
  fallbackLabel,
  placeholder,
  disabled,
  status,
  onChange,
}: {
  items: FieldOption[];
  value?: string;
  fallbackLabel?: string;
  placeholder: string;
  disabled?: boolean;
  status?: FieldOptionStatus;
  onChange: (option: FieldOption) => void;
}) {
  // A value the live document no longer offers stays visible, stated stale, never silently lost.
  const choices = useMemo(() => {
    if (!value || items.some((item) => item.value === value)) return items;
    return [
      {
        value,
        label: fallbackLabel ? `${fallbackLabel} (unavailable)` : `${value} (unavailable)`,
        stale: true,
      },
      ...items,
    ];
  }, [fallbackLabel, items, value]);
  const selected = choices.find((item) => item.value === value);

  return (
    <ListPopup<FieldOption & { stale?: boolean }>
      anchor="trigger"
      face="field"
      disabled={disabled}
      triggerLabel={placeholder}
      trigger={selected?.label ?? <span className="text-ink-2">{placeholder}</span>}
      aria-label={placeholder}
      items={choices}
      keyOf={(option) => option.value}
      labelOf={(option) => option.label}
      filter="substring"
      searchAbove={8}
      status={status}
      select="single"
      selected={value ? [value] : []}
      empty="the live document offers no values"
      noMatch="no matching live document values"
      onPick={onChange}
      row={optionRow}
    />
  );
}

export function FieldOptionPicker({
  items,
  values,
  disabled,
  status,
  onChange,
}: {
  items: FieldOption[];
  values: string[];
  disabled?: boolean;
  status?: FieldOptionStatus;
  onChange: (values: string[]) => void;
}) {
  const choices = useMemo(() => {
    const missing = values
      .filter((value) => !items.some((item) => item.value === value))
      .map((value) => ({ value, label: `${value} (unavailable)`, stale: true }));
    return [...missing, ...items];
  }, [items, values]);
  const labels = choices.filter((item) => values.includes(item.value)).map((item) => item.label);

  return (
    <ListPopup<FieldOption & { stale?: boolean }>
      anchor="trigger"
      face="field"
      disabled={disabled}
      triggerLabel="Source elements"
      trigger={<ListChips labels={labels} none="All elements in the category" />}
      aria-label="Source elements"
      items={choices}
      keyOf={(option) => option.value}
      labelOf={(option) => option.label}
      filter="substring"
      status={status}
      select="multi"
      selected={values}
      onSelectedChange={onChange}
      empty="the live document has no elements in the category"
      noMatch="no matching live document elements"
      footer={
        <span className="t-small text-ink-2">
          {values.length === 0
            ? "All elements in the category"
            : `${values.length} specific element(s)`}
        </span>
      }
      row={optionRow}
    />
  );
}
