import { getRouteApi } from "@tanstack/react-router";

import { TargetChip } from "#/components/target-chip";
import { mintSelector, sessionLabel, type TargetSelector } from "#/host/target";
import { CHAT_CONSUMER, readScoped, scopeKey, type TargetScope } from "#/host/target-scope";
import { chipDescriptor, LaneBadge, LiveDot, resolutionReadout, toneColor } from "#/host/target-ui";
import { useTarget, useWorldLog, type WorldEvent } from "#/host/use-target";

/**
 * Chat-wired target surfaces. The pin is the `target` search param (a selector, retained like
 * `thread`); resolution is live against the broker session list. One hook, three reflections:
 * the composer chip, the world-lane section, and the mapdial rail/ticks in the Lens.
 *
 * The chat is one SCOPE — (thread, _chat) — read through host/target-scope.ts. Today its selector
 * persists in the `?target` URL param: a one-entry TargetBook. When cross-tab sync / multi-plugin
 * tenancy / per-thread persistence land, a synced thread-keyed book replaces this backend and
 * scope callers here don't change. ponytail: single-scope URL backend until a second tab/plugin exists.
 */

const chatRoute = getRouteApi("/chat");

export function useChatTarget() {
  const { thread, target } = chatRoute.useSearch();
  const navigate = chatRoute.useNavigate();
  const scope: TargetScope = { threadId: thread ?? "", consumerId: CHAT_CONSUMER };
  const book = target ? { [scopeKey(scope)]: target } : {};
  const selector: TargetSelector = readScoped(book, scope);
  const { resolution, sessions } = useTarget(selector);
  const worldLog = useWorldLog(sessions);
  const pin = (next: TargetSelector) =>
    void navigate({
      search: (prev) => ({ ...prev, target: next === "" ? undefined : next }),
      replace: true,
    });
  return { selector, resolution, sessions, worldLog, pin };
}

/** The composer control-row chip. */
export function ChatTargetChip() {
  const { selector, sessions, pin } = useChatTarget();
  return <TargetChip selector={selector} sessions={sessions} onPin={pin} dropUp />;
}

/**
 * The world-lane target section — the state inspector grown up: what the chat's actions land on,
 * as raw resolution plus the client-observed world log. Sits above the context layers because
 * "against what world" precedes "with what context".
 */
export function TargetWorld() {
  const { selector, resolution, sessions, worldLog, pin } = useChatTarget();
  const chip = chipDescriptor(resolution);
  return (
    <div className="px-3 py-3" style={{ borderBottom: "0.5px solid var(--line)" }}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--foreground)" }}
        >
          TARGET
        </span>
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, color: toneColor(chip.tone) }}
        >
          {chip.tone.toUpperCase()}
        </span>
      </div>

      {/* raw resolution — provenance, not decoration */}
      <div
        className="mb-2 break-all font-[var(--font-pe-mono)]"
        style={{ fontSize: 10, lineHeight: 1.5, color: "var(--muted-foreground)" }}
      >
        {resolutionReadout(resolution)}
      </div>

      {sessions.map((s) => {
        const isResolved =
          resolution.kind === "resolved" && resolution.session.sessionId === s.sessionId;
        return (
          <button
            key={s.sessionId}
            type="button"
            onClick={() => pin(mintSelector(s, sessions))}
            className="flex w-full items-center justify-between gap-2 py-1 text-left"
            style={{
              borderLeft: isResolved ? "2px solid var(--pe-blue)" : "2px solid transparent",
              paddingLeft: 6,
              cursor: "pointer",
            }}
            title="pin the chat here"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <LiveDot
                tone={isResolved ? (selector === "" ? "implicit" : "pinned") : "muted"}
                lane={s.lane}
              />
              <span className="truncate text-[12px]" style={{ color: "var(--foreground)" }}>
                {sessionLabel(s)}
              </span>
              <LaneBadge lane={s.lane} />
            </span>
            <span
              className="whitespace-nowrap font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, color: "var(--muted-foreground)" }}
            >
              pid {s.processId}
            </span>
          </button>
        );
      })}
      {sessions.length === 0 ? (
        <div className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          no sessions connected
        </div>
      ) : null}

      {worldLog.length > 0 ? (
        <div className="mt-2" style={{ borderTop: "0.5px solid var(--line-soft)", paddingTop: 6 }}>
          {worldLog.slice(-5).map((event, i) => (
            <WorldLogLine key={`${event.atMs}-${i}`} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorldLogLine({ event }: { event: WorldEvent }) {
  const time = new Date(event.atMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div
      className="flex items-baseline gap-2 py-0.5 font-[var(--font-pe-mono)]"
      style={{ fontSize: 9.5, color: "var(--muted-foreground)" }}
    >
      <span style={{ opacity: 0.7 }}>{time}</span>
      <span className="truncate">{event.label}</span>
    </div>
  );
}
