import type { CellLike } from "@pe/agent-contracts";
import { cellFromDraft, StateCell, type CellTransition } from "@pe/kit/lang/cell";
import { previousOf, useFieldOptionsReading } from "#/shell/readings-hooks";

/** The slot contract consumes a parameter name, not the catalog's identity/scope key. */
export function EspParameter({
  target,
  units,
  cell,
  model,
  transitions,
  commit,
}: {
  target: { session: string; openId: string } | null;
  units: readonly string[];
  cell: CellLike;
  model: string;
  transitions: CellTransition[];
  commit: (name: string) => Promise<string | undefined>;
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
  const current = String(cell.edit?.value ?? model);
  const options = (data?.items ?? []).flatMap((item) =>
    item.metadata?.name
      ? [
          {
            key: item.value,
            label: item.label,
            description: [item.metadata.kind, item.metadata.storageType, item.metadata.dataTypeId]
              .filter(Boolean)
              .join(" · "),
            name: item.metadata.name,
          },
        ]
      : [],
  );
  const reason = !target
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
              : null;
  return (
    <StateCell
      {...cellFromDraft(cell, {
        value: current,
        modelValue: model,
        ...(!reason && !options.some((option) => option.name === current)
          ? { damage: "Parameter not offered by these units" }
          : {}),
        ...(reason ? { cap: "locked", capReason: reason } : {}),
      })}
      scale="row"
      choice={{
        options,
        current: options.find((option) => option.name === current)?.key ?? null,
        pick: (key) => {
          const option = options.find((option) => option.key === key);
          return option ? commit(option.name) : undefined;
        },
      }}
      transitions={transitions}
    />
  );
}
