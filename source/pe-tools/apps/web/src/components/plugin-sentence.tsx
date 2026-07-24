/**
 * PluginSentence — posture 2 of the sentence grammar: the interactive header a
 * collaborative route mounts. Same grammar the chat sentence speaks, but the
 * nouns stay clickable: the document slot opens the route's own pick list, the
 * world clause opens a bind picker over live sessions. Plugins are human
 * surfaces; choosing happens here, never in the chat lane.
 */
import { useEffect, useRef, useState } from "react";
import type { CellSummary } from "@pe/agent-contracts";

import { useFleet } from "#/host/fleet";
import { mintSelector, resolveTarget, sessionLabel } from "#/host/target";

export interface PluginSentenceProps {
  /** Resting verb, e.g. "editing". */
  verb: string;
  /** Selected document label; null renders the placeholder slot. */
  documentLabel: string | null;
  /** Pick list for the document slot (route-owned vocabulary, e.g. relative paths). */
  documents: string[];
  onPickDocument: (path: string) => void;
  /** Bound target selector ("" = unbound/implicit) and the bind writer. */
  target: string;
  onBind: (selector: string | null) => void;
  staged: CellSummary;
  busy?: boolean;
}

function Slot({
  text,
  placeholder,
  open,
  onClick,
}: {
  text: string | null;
  placeholder: string;
  open: boolean;
  onClick: () => void;
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

export function PluginSentence({
  verb,
  documentLabel,
  documents,
  onPickDocument,
  target,
  onBind,
  staged,
  busy,
}: PluginSentenceProps) {
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

  const resolution = resolveTarget(sessions, target);
  const prefix =
    staged.proposals > 0
      ? `reviewing ${staged.proposals} proposal${staged.proposals === 1 ? "" : "s"} on`
      : verb;
  const prefixColor = staged.proposals > 0 ? "var(--pe-blue)" : "var(--muted-foreground)";

  const clauseText =
    resolution.kind === "resolved"
      ? ` in ${resolution.session.lane === "sandbox" ? `a live world (${resolution.session.sandboxId})` : "your Revit"}`
      : resolution.kind === "ambiguous"
        ? " in … several worlds — pick one"
        : sessions.length === 0
          ? " — no world is running"
          : " — pick a world";

  const bootingWorlds = worlds.filter((world) => world.phase === "booting");

  return (
    <div ref={rootRef} className="relative inline-block min-w-0 flex-1">
      <div
        className="flex h-7 items-center overflow-hidden px-2"
        style={{ border: "0.5px solid var(--line-2)", borderRadius: 2, opacity: busy ? 0.6 : 1 }}
      >
        <span className="flex items-baseline gap-1 truncate" style={{ whiteSpace: "nowrap" }}>
          <span className="tele" style={{ fontSize: 11, color: prefixColor }}>
            {prefix}{" "}
          </span>
          <Slot
            text={documentLabel}
            placeholder="pick a document"
            open={openSlot === "doc"}
            onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")}
          />
          <button
            type="button"
            className="tele"
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
            title="which Revit world this workspace speaks to — click to re-bind"
            onClick={(event) => {
              event.stopPropagation();
              setOpenSlot(openSlot === "world" ? null : "world");
            }}
          >
            {clauseText}
          </button>
        </span>
      </div>

      {openSlot === "doc" ? (
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
              <div
                key={path}
                className="truncate py-1"
                style={{
                  cursor: "pointer",
                  borderBottom: "0.5px solid var(--line-soft)",
                  fontSize: 11.5,
                  color: "var(--foreground)",
                  background:
                    path === documentLabel
                      ? "color-mix(in srgb, var(--pe-blue) 5%, transparent)"
                      : undefined,
                }}
                onClick={() => {
                  onPickDocument(path);
                  setOpenSlot(null);
                }}
              >
                {path}
              </div>
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
            BIND — which world this workspace speaks to
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
                {session.lane === "sandbox" ? (session.sandboxId ?? session.sessionId) : "your Revit"}
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
