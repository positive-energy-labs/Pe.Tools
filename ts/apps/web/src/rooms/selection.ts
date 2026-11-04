/** One Page selection projects to regions and a card, with no writable projection. */
export function roomSelection(
  value: readonly string[] | "all",
  cards: readonly { id: string; guids: readonly string[] }[],
  roster?: readonly string[],
) {
  const ids = value === "all" ? [...new Set(roster ?? cards.flatMap(card => [...card.guids]))] : value;
  const card =
    cards.find((card) => ids.includes(`card:${card.id}`)) ??
    cards.find((card) => card.guids.some((guid) => ids.includes(guid)));
  return {
    pinned: card?.id ?? null,
    guids: ids.flatMap((id) =>
      id.startsWith("card:") ? (cards.find((card) => card.id === id.slice(5))?.guids ?? []) : [id],
    ),
  };
}
