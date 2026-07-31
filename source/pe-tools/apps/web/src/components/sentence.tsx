/**
 * Sentence — THE targeting surface. Every surface that talks to Revit (chat,
 * chat plugins, plugin routes) targets through this one grammar: an optional
 * document slot and the world clause slot, both clickable. Targeting is the
 * CORE; status is an EXTENSION — callers inject a status prefix (pea's live
 * activity in chat, staged-proposal counts in plugins) and the nouns stay
 * clickable underneath whatever the prefix says.
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

export interface SentenceProps {
  /** Status prefix — the extension point. Chat injects pea's testimony; plugins inject staged counts. */
  prefix: string;
  prefixTone?: SentenceTone;
  /** Document slot renders only when `documents` is provided (plugin surfaces). */
  documentLabel?: string | null;
  documents?: string[];
  onPickDocument?: (path: string) => void;
  /** Bound target selector ("" = unbound/implicit) and the bind writer. null = unbind. */
  target: string;
  onBind: (selector: string | null) => void;
  busy?: boolean;
}

function Slot({
  text,
  placeholder,
  onClick,
  open,
}: {
  text: string | null;
  placeholder: string;
  onClick: () => void;
  open: boolean;
}) {
  return (
    <button
      type="button"
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
  target,
  onBind,
  busy,
}: SentenceProps) {
  const [openSlot, setOpenSlot] = useState<"doc" | "world" | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const { worlds, sessions } = useFleet();

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

  return (
    <div ref={rootRef} className="relative inline-block min-w-0 flex-1">
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
              <span className="tele" style={{ fontSize: 11, color: TONE_COLOR[prefixTone], transition: "color 0.6s" }}>
                {prefix}{" "}
              </span>
              {hasDocSlot ? (
                <Slot
                  text={documentLabel ?? null}
                  placeholder="pick a document"
                  open={openSlot === "doc"}
                  onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")}
                />
              ) : null}
            </>
          )}
          <button
            type="button"
            className="tele"
            title="which world this surface speaks to — click to bind"
            style={{
              fontSize: 11,
              padding: 0,
              cursor: "pointer",
              background: openSlot === "world" ? "color-mix(in srgb, var(--pe-blue) 7%, transparent)" : "transparent",
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
              no documents yet
            </div>
          ) : null}
        </Popover>
      ) : null}

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
            <div key={world.id} className="py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
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
