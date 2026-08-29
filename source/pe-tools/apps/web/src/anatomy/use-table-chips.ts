export interface TableChip {
  label: string;
  onClear: () => void;
}

export function useTableChips(tableState: Record<string, TableChip | false | null | undefined>) {
  return Object.values(tableState).filter((chip): chip is TableChip => Boolean(chip));
}
