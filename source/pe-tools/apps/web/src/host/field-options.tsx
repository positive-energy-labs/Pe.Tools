import { useMemo } from "react";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/ui/combobox";
import { useHostOpDynamic } from "#/host/queries";
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
) {
  const query = useHostOpDynamic(
    "revit.catalog.field-options",
    { sourceKey, contextValues },
    { bridgeSessionId, enabled, staleTime: 30_000 },
  );
  const items = ((query.data as { items?: FieldOption[] } | undefined)?.items ?? []).filter(
    (item) => typeof item.value === "string" && typeof item.label === "string",
  );
  return { ...query, items };
}

export function FieldOptionSelect({
  items,
  value,
  fallbackLabel,
  placeholder,
  disabled,
  onChange,
}: {
  items: FieldOption[];
  value?: string;
  fallbackLabel?: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (option: FieldOption) => void;
}) {
  const choices = useMemo(() => {
    if (!value || items.some((item) => item.value === value)) return items;
    return [
      { value, label: fallbackLabel ? `${fallbackLabel} (unavailable)` : `${value} (unavailable)` },
      ...items,
    ];
  }, [fallbackLabel, items, value]);
  const selected = choices.find((item) => item.value === value) ?? null;

  return (
    <Combobox
      items={choices}
      value={selected}
      disabled={disabled}
      onValueChange={(option: FieldOption | null) => option && onChange(option)}
      itemToStringLabel={(option: FieldOption) => option.label}
    >
      <ComboboxInput placeholder={placeholder} className="w-full" showClear={false} />
      <ComboboxContent>
        <ComboboxEmpty>No matching live document values</ComboboxEmpty>
        <ComboboxList>
          {(option: FieldOption) => (
            <ComboboxItem key={option.value} value={option} className="flex-col items-start pr-7">
              <span>{option.label}</span>
              {option.description ? (
                <span className="text-[10px] text-muted-foreground">{option.description}</span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function FieldOptionMultiSelect({
  items,
  values,
  disabled,
  onChange,
}: {
  items: FieldOption[];
  values: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const anchor = useComboboxAnchor();
  const choices = useMemo(() => {
    const missing = values
      .filter((value) => !items.some((item) => item.value === value))
      .map((value) => ({ value, label: `${value} (unavailable)` }));
    return [...missing, ...items];
  }, [items, values]);
  const selected = choices.filter((item) => values.includes(item.value));

  return (
    <>
      <Combobox
        items={choices}
        multiple
        value={selected}
        disabled={disabled}
        onValueChange={(next: FieldOption[]) => onChange(next.map((option) => option.value))}
        itemToStringLabel={(option: FieldOption) => option.label}
      >
        <ComboboxChips ref={anchor}>
          {selected.map((option) => (
            <ComboboxChip key={option.value}>{option.label}</ComboboxChip>
          ))}
          <ComboboxChipsInput
            aria-label="Source elements"
            placeholder={selected.length === 0 ? "All elements in the category" : "Add elements…"}
          />
          <ComboboxTrigger />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No matching live document elements</ComboboxEmpty>
          <ComboboxList>
            {(option: FieldOption) => (
              <ComboboxItem key={option.value} value={option} className="flex-col items-start pr-7">
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-[10px] text-muted-foreground">{option.description}</span>
                ) : null}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <span className="text-[10px] text-[var(--lichen)]">
        {values.length === 0
          ? "All elements in the category"
          : `${values.length} specific element(s)`}
      </span>
    </>
  );
}
