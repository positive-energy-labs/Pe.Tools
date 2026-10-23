import { Dialog, DialogContent } from "./dialog";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";
import { List } from "@pe/kit/lang/list-popup";

/** One destination-picker body; callers supply the catalogue, row anatomy and verbs. */
export function CommandPalette<T>({
  open,
  onOpenChange,
  presentation = "dialog",
  anchor,
  sideOffset = 4,
  ...list
}: Parameters<typeof List<T>>[0] & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentation?: "dialog" | "anchored";
  anchor?: HTMLElement | null;
  sideOffset?: number;
}) {
  const body = (
    <List<T>
      {...list}
      owner={presentation === "anchored" ? (list.owner ?? anchor ?? undefined) : list.owner}
      onPick={(item, path) => {
        list.onPick?.(item, path);
        onOpenChange(false);
      }}
      onEscape={() => {
        list.onEscape?.();
        onOpenChange(false);
      }}
    />
  );
  if (presentation === "anchored")
    return anchor ? (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverContent
          anchor={anchor}
          sideOffset={sideOffset}
          initialFocus={false}
          finalFocus={false}
          aria-label={list["aria-label"]}
          data-surface="page"
          data-command-palette="anchored"
          className="block w-auto max-w-none overflow-hidden p-1"
          style={{ width: "min(max(24rem, var(--anchor-width)), calc(100vw - 16px))" }}
        >
          {open ? body : null}
        </PopoverContent>
      </Popover>
    ) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent pad="none" showCloseButton={false} aria-label={list["aria-label"]}>
        {body}
      </DialogContent>
    </Dialog>
  );
}
