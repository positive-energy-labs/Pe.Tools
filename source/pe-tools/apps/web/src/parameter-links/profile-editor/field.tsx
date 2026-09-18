import type { ReactNode } from "react";
import type { ParameterReference } from "@pe/agent-contracts";
import { type FieldOption } from "#/host/field-options";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "#/components/lang/combobox";

export function findParameterOption(items: FieldOption[], reference: ParameterReference) {
  return items.find(
    (item) =>
      (reference.identity?.key && item.metadata?.key === reference.identity.key) ||
      (reference.sharedGuid && item.metadata?.sharedGuid === reference.sharedGuid) ||
      (reference.name && item.metadata?.name.toLowerCase() === reference.name.toLowerCase()),
  );
}

export function parameterOptionValue(reference: ParameterReference, scope: string) {
  if (reference.identity?.key)
    return `${reference.identity.key}|${scope === "type" ? "type" : "instance"}`;
  return reference.sharedGuid
    ? `shared:${reference.sharedGuid}|${scope}`
    : reference.name
      ? `name:${reference.name}|${scope}`
      : undefined;
}

export function parameterLabel(reference: ParameterReference) {
  return reference.identity?.name ?? reference.name ?? reference.sharedGuid ?? undefined;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="">{label}</span>
      {children}
    </label>
  );
}

export function Enum<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: readonly T[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Combobox
      items={[...options]}
      value={value}
      disabled={disabled}
      onValueChange={(option: T | null) => option && onChange(option)}
      itemToStringLabel={(option: T) => option}
    >
      <ComboboxTrigger fill>{value}</ComboboxTrigger>
      <ComboboxContent>
        <ComboboxList>
          {(option: T) => (
            <ComboboxItem key={option} value={option}>
              {option}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
