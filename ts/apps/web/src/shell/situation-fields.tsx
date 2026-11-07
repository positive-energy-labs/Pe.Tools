import { PageControl } from "./page-control";
import { useEffect, useMemo } from "react";
import type { RouteGraph } from "@pe/agent-contracts";
import { graphFields, type GraphMount } from "./mount-owner";

/** Pane queries and selection stay with their panes; only subject/draft or explicitly placed fields belong here. */
export function SituationFields<P, W>({
  graph,
  owner,
  enabled,
}: {
  graph: RouteGraph<P, W>;
  owner: GraphMount<P, W>;
  enabled: boolean;
}) {
  const fields = graphFields(graph).filter(
    ([, field]) =>
      field.editor !== "pane" &&
      (field.editor === "situation" ||
        field.editor === "text" ||
        field.picker ||
        ["subject", "draft"].includes(field.role)),
  );
  const draws = useMemo(
    () => [...new Set(fields.flatMap(([, field]) => (field.picker ? [field.picker.reading] : [])))],
    [graph],
  );
  useEffect(() => (enabled ? owner.readings.mount(draws) : undefined), [owner, draws, enabled]);
  return fields.map(([id, field]) => (
    <PageControl
      key={id}
      id={id}
      field={field}
      value={owner.view.read().page[id as keyof P]}
      enabled={enabled}
      options={
        field.picker
          ? field.picker.options(owner.readings.get(field.picker.reading).value)
          : undefined
      }
      set={(value) => {
        const parsed = field.schema.safeParse(value);
        if (parsed.success) owner.view.setPage({ [id]: parsed.data } as Partial<P>);
      }}
    />
  ));
}
