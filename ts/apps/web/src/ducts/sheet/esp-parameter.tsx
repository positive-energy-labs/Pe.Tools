import { StateCell, type CellHandle } from "@pe/kit/lang/cell";
import type { ValueHandle } from "@pe/kit/lang/collection";
import { previousOf, useFieldOptionsReading } from "#/shell/readings-hooks";

/** The slot contract consumes a parameter name, not the catalog's identity/scope key. */
export function EspParameter({
  target,
  units,
  cell,
  value,
  model,
}: {
  target: { session: string; openId: string } | null;
  units: readonly string[];
  cell: CellHandle;
  value?: ValueHandle<unknown>;
  model: string;
}) {
  const reading = useFieldOptionsReading(
    target,
    units.length ? "parameter-identities" : undefined,
    {
      ElementUniqueIds: units.join(","),
      ParameterScope: "instanceThenType",
      StorageType: "Double",
    },
  );
  const data = previousOf(reading);
  const current = String(cell.value.edit?.value ?? model);
  const options = (data?.items ?? []).flatMap((item) =>
    item.metadata?.name
      ? [
          {
            key: item.value,
            label: item.label,
            description: [item.metadata.kind, item.metadata.storageType, item.metadata.dataTypeId]
              .filter(Boolean)
              .join(" · "),
            value: item.metadata.name,
          },
        ]
      : [],
  );
  const reason = cell.refusal ?? (!target
    ? "Choose a document for parameter options"
    : !units.length
      ? "No unit identities in this fan scope"
      : reading.state === "failed"
        ? reading.message
        : reading.state !== "ready"
          ? "Reading unit parameters"
          : data?.result.kind !== "Success"
            ? (data?.result.message ?? "Parameter options unavailable")
            : !options.length
              ? "No numeric parameters on these units"
              : null);
  return (
    <StateCell
      cell={cell}
      value={value}
      label="Unit ESP"
      model={model}
      current={options.find((option) => option.value === current)?.key ?? null}
      damage={!reason && !options.some((option) => option.value === current)
        ? "Parameter not offered by these units" : undefined}
      capReason={reason ?? undefined}
      options={options}
    />
  );
}
