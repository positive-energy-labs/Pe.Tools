import { Dialog, DialogContent } from "./dialog";
import { Popover } from "@base-ui/react/popover";
import { List } from "./list-popup";

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
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={anchor}
            side="bottom"
            align="start"
            sideOffset={sideOffset}
            collisionPadding={8}
            className="isolate z-popup"
          >
            <Popover.Popup
              initialFocus={false}
              finalFocus={false}
              aria-label={list["aria-label"]}
              data-surface="page"
              data-command-palette="anchored"
              className="float-surface block overflow-hidden p-1"
              style={{
                width: "min(max(24rem, var(--anchor-width)), calc(100vw - 16px))",
                maxHeight: "var(--available-height)",
              }}
            >
              {open ? body : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    ) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent pad="none" showCloseButton={false} aria-label={list["aria-label"]}>
        {body}
      </DialogContent>
    </Dialog>
  );
}
