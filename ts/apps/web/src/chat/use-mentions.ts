// The composer's `@` menu, headless: the `@query` at the caret, the catalog rows it finds, the pick
// that leaves `@Title ` in the text and the mention in the draft. Keys work like the slash menu.
import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
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
import {
  machineAttachments,
  type Machine,
  documentRows,
  findCapabilities,
  mentionOf,
  mentionToken,
  parseDocumentKey,
  recentKey,
  recentRows,
  recentSegments,
  type Capability,
  type CapabilityCatalog,
  type CapabilityKind,
} from "@pe/agent-contracts";
import type { Collection } from "@pe/kit/lang/collection";
import type { ChatDraft } from "#/workbench/prompt";

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
/** Rows a group shows before its "N more" row. */
export const MENTION_GROUP_CAP = 5;

/** A mention's kind word; a kind this build does not know says itself. */
export const mentionWord = (kind: string) => MENTION_KINDS[kind as CapabilityKind]?.word ?? kind;

/** What one menu row says: a readable title, one short fact on its line (`mono` when it is a
 * key), and the description the footer says for the cursor row. An op whose title is its key's
 * name reads as the first clause of its description; the name moves to the fact. */
export function mentionFace(
  row: Capability,
  catalog: CapabilityCatalog,
): { title: string; fact: string | null; mono: boolean; detail: string } {
  const doc = parseDocumentKey(row.key);
  if (doc) {
    const address = machineAttachments(catalog.machine)
      .find((session) => session.session === doc.session)
      ?.documents?.find((document) => document.openId === doc.openId)?.address;
    const folders = address?.split(/[\\/]/).slice(0, -1).slice(-2).join("\\");
    return {
      title: row.title,
      fact: folders || null,
      mono: false,
      detail: [row.description, address, doc.session].filter(Boolean).join(" · "),
    };
  }
  if (row.kind === "recent") {
    const recent = catalog.recents?.find((entry) => recentKey(entry) === row.key);
    const words = recent ? recentSegments(recent) : [];
    return {
      title: row.title,
      // A cloud model says its project; a local file its last two folders.
      fact: recent?.isCloud
        ? ["cloud", words.at(-2)].filter(Boolean).join(" · ")
        : words.slice(0, -1).slice(-2).join("\\") || null,
      mono: false,
      detail: [row.description, recent?.path].filter(Boolean).join(" · "),
    };
  }
  if (row.kind !== "op")
    return { title: row.title, fact: null, mono: false, detail: row.description };
  // `op:parameter-links.read` → `parameter-links.read`: the group head already says "op".
  const name = row.key.slice(row.key.indexOf(":") + 1);
  const clause = row.description.split(/[.,;:(]|\s(?:and|or|—|-)\s/)[0]!.trim();
  return {
    title: row.title === name && clause ? clause : row.title,
    fact: name,
    mono: true,
    detail: row.description,
  };
}

/** The `@query` the caret sits at the end of: an `@` at the start or after whitespace. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[1]!.length - 1, query: match[1]! } : null;
}

/** The catalog the `@` menu reads: every other row as the catalog read it, the open documents
 * from the live inventory (a closed document is no target, and a catalog may be old), and the
 * recent ones less whatever the inventory says is open now. */
export function liveCatalog(catalog: CapabilityCatalog, machine: Machine): CapabilityCatalog {
  const live = {
    ...catalog,
    at: machine.observedAtUtc,
    machine,
  };
  return {
    ...live,
    capabilities: [
      ...documentRows(live),
      ...recentRows(live),
      ...catalog.capabilities.filter((row) => row.kind !== "document" && row.kind !== "recent"),
    ],
  };
}

/** Every row a query finds, grouped in menu order; the list caps each group on screen. */
export function mentionRows(catalog: CapabilityCatalog, query: string): Capability[] {
  return (Object.keys(MENTION_KINDS) as CapabilityKind[]).flatMap((kind) =>
    findCapabilities(catalog.capabilities, { query, kind, limit: Infinity }),
  );
}

/** The draft after `text` changed: a mention whose `@Title` token is gone goes with it. */
export const withText = (draft: ChatDraft, text: string): ChatDraft => ({
  ...draft,
  text,
  mentions: draft.mentions.filter((mention) => text.includes(mentionToken(mention))),
});

/** The draft without a mention: its chip and its first `@Title` token (and the space a pick left). */
export function dropMention(draft: ChatDraft, key: string): ChatDraft {
  const mention = draft.mentions.find((held) => held.key === key);
  if (!mention) return draft;
  const token = mentionToken(mention);
  const at = draft.text.indexOf(token);
  const end = at + token.length + (draft.text[at + token.length] === " " ? 1 : 0);
  return {
    ...draft,
    text: at < 0 ? draft.text : draft.text.slice(0, at) + draft.text.slice(end),
    mentions: draft.mentions.filter((held) => held.key !== key),
  };
}

/** Pick `row` for the `@query` at `caret`: the token replaces the query, the mention joins once. */
export function pickMention(
  draft: ChatDraft,
  caret: number,
  row: Capability,
  catalog: CapabilityCatalog,
): { draft: ChatDraft; caret: number } {
  const found = mentionQuery(draft.text, caret);
  if (!found) return { draft, caret };
  const mention = mentionOf(row, catalog);
  const token = `${mentionToken(mention)} `;
  return {
    draft: {
      ...draft,
      text: draft.text.slice(0, found.start) + token + draft.text.slice(caret),
      mentions: [...draft.mentions.filter((held) => held.key !== mention.key), mention],
    },
    caret: found.start + token.length,
  };
}

export function useMentions(
  draft: ChatDraft,
  setDraft: Dispatch<SetStateAction<ChatDraft>>,
  catalog: CapabilityCatalog | undefined,
  area: HTMLTextAreaElement | null,
  /** Another menu owns the composer (the slash menu): this one stays shut. */
  blocked: boolean,
) {
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const collection = useRef<Collection<Capability> | null>(null);
  const found = mentionQuery(draft.text, caret);
  const query = found?.query;
  const rows = useMemo(
    () => (catalog && query !== undefined ? mentionRows(catalog, query) : []),
    [catalog, query],
  );
  const open = !dismissed && !blocked && rows.length > 0;

  return {
    open,
    query: query ?? "",
    rows,
    /** The caret moved (typing, a click, an arrow): the menu reads the `@query` before it. */
    onCaret: (at: number) => setCaret(at),
    dismiss: () => setDismissed(true),
    /** The text changed: the menu may open again. */
    reset: () => setDismissed(false),
    /** Pass to the list's `onCollection`. */
    bind: (next: Collection<Capability> | null) => {
      collection.current = next;
    },
    /** True when the menu owns the key (Tab picked, or the open list handles it). */
    onKeyDown: (event: KeyboardEvent): boolean => {
      if (!open) return false;
      const cursor = collection.current?.cursor;
      if (event.key === "Tab" && !event.shiftKey && cursor) {
        event.preventDefault();
        collection.current?.pick(cursor);
      }
      return true;
    },
    pick: (row: Capability) => {
      if (!catalog) return;
      const next = pickMention(draft, caret, row, catalog);
      setDraft(next.draft);
      setCaret(next.caret);
      requestAnimationFrame(() => {
        area?.focus();
        area?.setSelectionRange(next.caret, next.caret);
      });
    },
  };
}
