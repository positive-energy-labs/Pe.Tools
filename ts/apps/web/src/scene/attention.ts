import { inkOf } from "./ink";

/** F10: the kit owns attention colours, including their theme and mixing ratios. */
export const attentionRoles = { selected: "select", hover: "hover", lit: "indirect" } as const;
export type AttentionMark = keyof typeof attentionRoles;

export function attentionColours(mount: Element) {
  return {
    selected: inkOf(attentionRoles.selected, mount),
    hover: inkOf(attentionRoles.hover, mount),
    lit: inkOf(attentionRoles.lit, mount),
  };
}

export const attentionMark = (selected: boolean, hovered: boolean, lit: boolean): AttentionMark | null =>
  selected ? "selected" : hovered ? "hover" : lit ? "lit" : null;
