import { useState, useMemo, useRef, useContext, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useSearchKey } from "./list-view";
import { SubjectTextContext } from "./reach";
import { useReachSetter } from "./reach";
import { ListPopup } from "./list-popup";

/** A named subject; ids remain searchable without becoming its visible name. */
export interface GoToItem {
  key: string;
  name: string;
  detail?: string;
  group?: string;
  meta?: ReactNode;
  id?: number | string | null;
  /** Override for linked or non-native subjects whose numeric id is not a host target. */
  revit?: readonly number[];
}

/** The picture's subject picker. Building the index is work reserved for opening it. */
export function GoToPopup<Item extends GoToItem>({
  items: build,
  onGo,
  hover,
  leadingGroups,
  resolveId,
}: {
  items: () => readonly Item[];
  onGo: (item: Item) => void;
  hover?: (item: Item | null) => void;
  leadingGroups?: readonly string[];
  /** Resolve ids outside the named subset without eagerly naming the whole model. */
  resolveId?: (text: string) => Item | null;
}) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => (open ? build() : []), [open, build]);
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const trigger = useRef<SVGSVGElement>(null);
  const reach = useContext(SubjectTextContext)?.reach;
  const setHovered = useReachSetter("hovered");
  const preview = (item: Item | null) => {
    if (reach && (item === null || typeof item.id === "number")) {
      setHovered(typeof item?.id === "number" ? item.id : null);
    } else hover?.(item);
  };
  useSearchKey({
    region: () =>
      trigger.current?.closest<HTMLElement>("[data-slot=pane]") ??
      trigger.current?.parentElement ??
      null,
    focus: () => setOpen(true),
  });
  const byId = (text: string) =>
    resolveId?.(text) ??
    items.find((item) => item.id != null && String(item.id) === text.trim()) ??
    null;
  return (
    <ListPopup<Item>
      anchor="trigger"
      face="icon"
      trigger={<Search ref={trigger} aria-hidden />}
      triggerLabel="go to a subject"
      title="Go to a subject · /"
      aria-label="go to a subject"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) preview(null);
      }}
      purpose="autocomplete"
      items={items}
      keyOf={(item) => item.key}
      labelOf={(item) => item.name}
      detailOf={(item) => `${item.detail ?? ""} ${item.id ?? ""}`}
      groupOf={(item) => item.group ?? "Subjects"}
      leadingGroups={leadingGroups ? [...leadingGroups] : undefined}
      groupCap={8}
      filter="words"
      select="single"
      searchAbove={0}
      searchPlaceholder="name or id"
      empty="nothing read yet"
      noMatch="no subject matches"
      maxHeight="24rem"
      onCursorChange={(key) => preview(key ? (byKey.get(key) ?? null) : null)}
      onPick={(item) => onGo(item)}
      onCreate={(text) => {
        const item = byId(text);
        if (item) onGo(item);
        setOpen(false);
        preview(null);
      }}
      createLabel={(text) =>
        byId(text) ? "go to matching subject" : `${text.trim()}: no subject by that id`
      }
      row={(item) => ({
        label: item.name,
        meta: item.meta,
        revit: item.revit ?? (typeof item.id === "number" ? [item.id] : undefined),
      })}
    />
  );
}
