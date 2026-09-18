import type { ReactNode } from "react";
import type { ParameterReference } from "@pe/agent-contracts";
import { type FieldOption } from "#/host/field-options";
import { ListPopup } from "#/components/lang/list-popup";

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
    <ListPopup<T>
      anchor="trigger"
      face="fill"
      disabled={disabled}
      trigger={value}
      aria-label="options"
      region="profile field"
      items={options}
      keyOf={(option) => option}
      labelOf={(option) => option}
      select="single"
      selected={[value]}
      empty="no options"
      onPick={onChange}
      row={(option) => ({ label: option })}
    />
  );
}
