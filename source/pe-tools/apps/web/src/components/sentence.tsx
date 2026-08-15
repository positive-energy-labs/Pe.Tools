/**
 * Sentence — THE targeting surface. Every surface that talks to Revit (chat,
 * chat plugins, plugin routes) targets through this one grammar: an optional
 * document slot, route-declared noun slots (profile, family, …), and the world
 * clause slot, all clickable. LAW: the sentence carries targeting NOUNS only —
 * the one exception is pea's live loop state as the status prefix. Scope and
 * filter state live in table chips, never here. A fresh commit briefly replaces
 * the whole sentence with its receipt ("committed <change> on <doc> · just
 * now"), then relaxes back to the nouns.
 *
 * Layout law: the sentence claims a real basis (`basis-72`) inside its wrapping toolbar, so a
 * crowded row WRAPS rather than shrinking the sentence to a sliver. The targeting surface must
 * stay readable; the buttons are the ones that move.
 */
import { useEffect, useRef, useState } from "react";

import { DocRow, extOf } from "#/components/doc-picker";
import { useFleet, worldClause, worldName } from "#/host/fleet";
import { mintSelector, resolveTarget, sessionLabel } from "#/host/target";

export type SentenceTone = "rest" | "active" | "awaiting" | "committed" | "failed";

export const TONE_COLOR: Record<SentenceTone, string> = {
  rest: "var(--muted-foreground)",
  active: "var(--cat-kiln)",
  awaiting: "var(--pe-blue)",
  committed: "var(--pe-blue)",
  failed: "var(--cat-clay)",
};

/** One option in a generic noun slot's picker. `sub` narrates observed cost/state, never a guess. */
export interface SlotOption {
  id: string;
  label: string;
  sub?: string;
  /** Unpickable, with the reason shown — e.g. a stale-schema profile listing its diagnostics. */
  disabledReason?: string;
}

/**
 * A generic noun slot — the sentence carries targeting NOUNS only (world, document,
 * profile, family). Routes declare which slots exist; a slot with `options: null`
 * renders as flat text (known noun, nothing to pick yet).
 */
export interface SlotSpec {
  key: string;
  /** Prose joining this slot to the sentence, e.g. "against" or "from". */
  joiner?: string;
  text: string | null;
  placeholder: string;
  options: SlotOption[] | null;
  onPick?: (id: string) => void;
  /** Tooltip — say what binding this noun DOES, not what the noun is called. */
  title?: string;
  /** Shown when the picker has nothing to offer. Say where the options come from. */
  empty?: string;
}

export interface SentenceProps {
  /** Status prefix — the extension point. Pea's live loop state is the ONE non-noun allowed here. */
  prefix: string;
  prefixTone?: SentenceTone;
  /** Document slot renders only when `documents` is provided (plugin surfaces). */
  documentLabel?: string | null;
  documents?: string[];
  onPickDocument?: (path: string) => void;
  /** Shown when the document list is empty. Say how the surface gets its first document. */
  documentsEmpty?: string;
  /** Extra noun slots, rendered between the document slot and the world clause. */
  slots?: SlotSpec[];
  /** Bound target selector ("" = unbound/implicit) and the bind writer. null = unbind. */
  target: string;
  onBind: (selector: string | null) => void;
  busy?: boolean;
  /** Commit receipt — while fresh (&lt;4s) the whole sentence becomes the receipt, then relaxes. */
  receipt?: { text: string; atMs: number } | null;
}

const RECEIPT_RELAX_MS = 4000;

function Slot({
  text,
  placeholder,
  onClick,
  open,
  title,
}: {
  text: string | null;
  placeholder: string;
  onClick: () => void;
  open: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="tele"
      style={{
        fontSize: 11,
        padding: 0,
        cursor: "pointer",
        background: open ? "color-mix(in srgb, var(--pe-blue) 7%, transparent)" : "transparent",
        border: "none",
        borderBottom: `0.5px solid ${text ? "var(--foreground)" : "var(--pe-blue)"}`,
        borderRadius: 0,
        color: text ? "var(--foreground)" : "var(--pe-blue)",
        whiteSpace: "nowrap",
      }}
    >
      {text ?? placeholder}
    </button>
  );
}

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute left-0 top-full z-30 mt-1 max-h-72 w-80 overflow-y-auto px-2 py-1"
      style={{
        border: "0.5px solid var(--line-2)",
        background: "var(--background)",
        borderRadius: 2,
        boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

export function Sentence({
  prefix,
  prefixTone = "rest",
  documentLabel,
  documents,
  onPickDocument,
  documentsEmpty,
  slots,
  target,
  onBind,
  busy,
  receipt,
}: SentenceProps) {
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const { worlds, sessions } = useFleet();

  // Receipt relax: tick once past the window so the sentence returns to its nouns.
  const receiptFresh = receipt != null && Date.now() - receipt.atMs < RECEIPT_RELAX_MS;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!receiptFresh || !receipt) return;
    const remaining = RECEIPT_RELAX_MS - (Date.now() - receipt.atMs);
    const timer = setTimeout(() => forceTick((n) => n + 1), Math.max(remaining, 0) + 16);
    return () => clearTimeout(timer);
  }, [receiptFresh, receipt]);

  useEffect(() => {
    if (!openSlot) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenSlot(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openSlot]);

  const hasDocSlot = documents !== undefined;
  const resolution = resolveTarget(sessions, target);
  const clauseText = worldClause(worlds, target);
  const bootingWorlds = worlds.filter((world) => world.phase === "booting");

  // Sentence-as-receipt: a fresh commit replaces the nouns entirely, then relaxes back.
  if (receiptFresh && receipt) {
    return (
      <div className="relative inline-block min-w-0 flex-1 basis-72">
        <div
          className="flex h-7 items-center overflow-hidden px-2"
          style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}
        >
          <span className="tele truncate" style={{ fontSize: 11, color: TONE_COLOR.committed }}>
            {receipt.text} · just now
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block min-w-0 flex-1 basis-72">
      <div
        className="flex h-7 items-center overflow-hidden px-2"
        style={{ border: "0.5px solid var(--line-2)", borderRadius: 2, opacity: busy ? 0.6 : 1 }}
      >
        <span className="flex items-baseline gap-1 truncate" style={{ whiteSpace: "nowrap" }}>
          {hasDocSlot && !documentLabel ? (
            <>
              <span className="tele" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                nothing open —{" "}
              </span>
              <Slot
                text={null}
                placeholder="pick a document"
                title="The document this surface is bound to. Picking one here is what chooses what you are editing — there is no separate mode switch."
                open={openSlot === "doc"}
                onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")}
              />
              <span className="tele" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {" "}
                to begin
              </span>
            </>
          ) : (
            <>
              <span
                className="tele"
                style={{ fontSize: 11, color: TONE_COLOR[prefixTone], transition: "color 0.6s" }}
              >
                {prefix}{" "}
              </span>
              {hasDocSlot ? (
                <Slot
                  text={documentLabel ?? null}
                  placeholder="pick a document"
                  title="The document this surface is bound to. Picking one here is what chooses what you are editing — there is no separate mode switch."
                  open={openSlot === "doc"}
                  onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")}
                />
              ) : null}
            </>
          )}
          {slots?.map((slot) => (
            <span
              key={slot.key}
              className="flex items-baseline gap-1"
              style={{ whiteSpace: "nowrap" }}
            >
              {slot.joiner ? (
                <span className="tele" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                  {slot.joiner}
                </span>
              ) : null}
              {slot.options ? (
                <Slot
                  text={slot.text}
                  placeholder={slot.placeholder}
                  title={slot.title}
                  open={openSlot === slot.key}
                  onClick={() => setOpenSlot(openSlot === slot.key ? null : slot.key)}
                />
              ) : (
                <span
                  className="tele"
                  title={slot.title}
                  style={{ fontSize: 11, color: "var(--foreground)" }}
                >
                  {slot.text ?? slot.placeholder}
                </span>
              )}
            </span>
          ))}
          <button
            type="button"
            className="tele"
            title="The Revit world every call from this surface is sent to. Click to bind a different session, or to unbind and follow whichever session is the only one running."
            style={{
              fontSize: 11,
              padding: 0,
              cursor: "pointer",
              background:
                openSlot === "world"
                  ? "color-mix(in srgb, var(--pe-blue) 7%, transparent)"
                  : "transparent",
              border: "none",
              borderRadius: 0,
              color: resolution.kind === "resolved" ? "var(--muted-foreground)" : "var(--pe-blue)",
              whiteSpace: "nowrap",
            }}
            onClick={(event) => {
              event.stopPropagation();
              setOpenSlot(openSlot === "world" ? null : "world");
            }}
          >
            {clauseText}
          </button>
        </span>
      </div>

      {openSlot === "doc" && documents !== undefined ? (
        <Popover>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="filter documents"
            className="tele mt-1 w-full px-1.5 py-0.5"
            style={{
              fontSize: 10,
              borderRadius: 2,
              border: "0.5px solid var(--line-2)",
              background: "transparent",
              color: "var(--foreground)",
              outline: "none",
            }}
          />
          {documents
            .filter((path) => path.toLowerCase().includes(query.toLowerCase()))
            .map((path) => (
              <DocRow
                key={path}
                ext={extOf(path)}
                label={path}
                selected={path === documentLabel}
                onPick={() => {
                  onPickDocument?.(path);
                  setOpenSlot(null);
                }}
              />
            ))}
          {documents.length === 0 ? (
            <div className="tele py-1" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              {documentsEmpty ??
                "No documents yet — create one to give this surface something to edit."}
            </div>
          ) : null}
        </Popover>
      ) : null}

      {slots?.map((slot) =>
        openSlot === slot.key && slot.options ? (
          <Popover key={slot.key}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`filter ${slot.key}s`}
              className="tele mt-1 w-full px-1.5 py-0.5"
              style={{
                fontSize: 10,
                borderRadius: 2,
                border: "0.5px solid var(--line-2)",
                background: "transparent",
                color: "var(--foreground)",
                outline: "none",
              }}
            />
            {slot.options
              .filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
              .map((option) => (
                <DocRow
                  key={option.id}
                  label={option.label}
                  sub={option.disabledReason ?? option.sub}
                  selected={option.label === slot.text}
                  disabled={option.disabledReason != null}
                  onPick={() => {
                    slot.onPick?.(option.id);
                    setOpenSlot(null);
                  }}
                />
              ))}
            {slot.options.length === 0 ? (
              <div className="tele py-1" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                {slot.empty ??
                  `No ${slot.key} to bind yet — nothing in the bound world offers one.`}
              </div>
            ) : null}
          </Popover>
        ) : null,
      )}

      {openSlot === "world" ? (
        <Popover>
          <div className="tele pb-0.5" style={{ fontSize: 8, color: "var(--muted-foreground)" }}>
            BIND — which world this surface speaks to
          </div>
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className="py-1"
              style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
              onClick={() => {
                onBind(mintSelector(session, sessions));
                setOpenSlot(null);
              }}
            >
              <span className="tele" style={{ fontSize: 10, color: "var(--foreground)" }}>
                {worldName(session)}
              </span>{" "}
              <span className="tele" style={{ fontSize: 9, color: "var(--muted-foreground)" }}>
                {sessionLabel(session)} · pid {session.processId}
              </span>
            </div>
          ))}
          {bootingWorlds.map((world) => (
            <div
              key={world.id}
              className="py-1"
              style={{ borderTop: "0.5px solid var(--line-soft)" }}
            >
              <span className="tele" style={{ fontSize: 10, color: "var(--cat-kiln)" }}>
                {world.id} — still booting
              </span>
            </div>
          ))}
          {sessions.length === 0 && bootingWorlds.length === 0 ? (
            <div className="tele py-1" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              no live worlds — start one from /instances
            </div>
          ) : null}
          {target ? (
            <div
              className="py-1"
              style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
              onClick={() => {
                onBind(null);
                setOpenSlot(null);
              }}
            >
              <span className="tele" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                unbind — follow the sole session
              </span>
            </div>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}
