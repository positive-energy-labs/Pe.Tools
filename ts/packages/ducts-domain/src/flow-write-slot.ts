/** An explicit missing slot blocks fallback. The observed slot belongs to this element. */
export function flowWriteSlot(id: number, observed: string | null | undefined, authored?: string) {
  // The authored slot wins and blocks fallback; either way it must be the slot this element was observed with.
  const slot = authored ?? observed;
  if (!observed || slot !== observed)
    throw Error(
      `Element ${id} has no observed airflow parameter '${authored ?? observed ?? ""}'; refresh its flow slot before preview`,
    );
  return slot;
}
