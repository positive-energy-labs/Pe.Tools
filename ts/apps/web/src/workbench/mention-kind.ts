import {
  AppWindow,
  Cog,
  FileCode,
  FileJson,
  FileText,
  History,
  PanelsTopLeft,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { CapabilityKind } from "@pe/agent-contracts";

/** Menu order, group heads, the kind word (chips) and the row's glyph: the one kind map. */
export const MENTION_KINDS: Record<
  CapabilityKind,
  { group: string; word: string; icon: LucideIcon }
> = {
  document: { group: "Documents", word: "document", icon: FileText },
  recent: { group: "Recent", word: "recent", icon: History },
  skill: { group: "Skills", word: "skill", icon: Sparkles },
  page: { group: "Pages", word: "page", icon: AppWindow },
  route: { group: "Pod routes", word: "route", icon: PanelsTopLeft },
  "route-doc": { group: "Route plugins", word: "route", icon: PanelsTopLeft },
  "route-command": { group: "Commands", word: "command", icon: SquareTerminal },
  op: { group: "Ops", word: "op", icon: Cog },
  script: { group: "Scripts", word: "script", icon: FileCode },
  member: { group: "Pod members", word: "member", icon: FileJson },
};
/** A mention's kind word; a kind this build does not know says itself. */
export const mentionWord = (kind: string) => MENTION_KINDS[kind as CapabilityKind]?.word ?? kind;

