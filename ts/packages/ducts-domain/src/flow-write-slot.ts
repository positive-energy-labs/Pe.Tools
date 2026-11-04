import { resolveValue } from "@pe/agent-contracts";

/** An explicit missing slot blocks fallback. The observed slot belongs to this element. */
export function flowWriteSlot(id: number, observed: string | null | undefined, authored?: string) {
  const slot = resolveValue<string>(
    { Work: { value: authored }, model: { value: observed } },
    null,
    (value) => !!observed && value === observed,
  );
  if (slot.status !== "valid")
    throw Error(
      `Element ${id} has no observed airflow parameter '${authored ?? observed ?? ""}'; refresh its flow slot before preview`,
    );
  return slot.value!;
}
