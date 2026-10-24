import { createContext, type FocusEvent, type PointerEvent } from "react";
/** Names and navigation belong to a surface; attention belongs to the app registry. */
export type SubjectTextScope = {
  doc: string;
  nameOf: (id: number) => string | null;
  go?: (id: number) => void;
  refProps?: (id: number) => Record<string, string | undefined>;
};
export const SubjectTextContext = createContext<SubjectTextScope | null>(null);
export const REACH_RUNGS = ["rest", "reach", "hover", "focus"] as const;
export type ReachRung = "rest" | "reach" | "hover" | "focus";
/** Local control contact. Subject identity is painted by useAttentionScope instead. */
export function reachProps(rung: ReachRung = "rest") {
  const paint = (el: Element, over: boolean, focused = el.matches(":focus-within")) => {
    if (!el.hasAttribute("data-subject"))
      el.setAttribute("data-reach", focused ? "focus" : over ? "hover" : rung);
  };
  return {
    onPointerEnter: (event: PointerEvent<Element>) => paint(event.currentTarget, true),
    onPointerOver: (event: PointerEvent<Element>) => paint(event.currentTarget, true),
    onPointerOut: (event: PointerEvent<Element>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        paint(event.currentTarget, false);
    },
    onFocus: (event: FocusEvent<Element>) => paint(event.currentTarget, false, true),
    onBlur: (event: FocusEvent<Element>) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        paint(event.currentTarget, event.currentTarget.matches(":hover"), false);
    },
  };
}
