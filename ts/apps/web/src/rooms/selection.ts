/** One Page selection projects to regions and a card, with no writable projection. */
export function roomSelection(
  ids: readonly string[],
  cards: readonly { id: string; guids: readonly string[] }[],
) {
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
