import { getRouteApi } from "@tanstack/react-router";

import { EmptyState } from "#/components/lang/empty";
import { Verb } from "#/components/lang/verb";
import { mintSelector, sessionLabel, type TargetSelector } from "#/host/target";
import { CHAT_CONSUMER, readScoped, scopeKey, type TargetScope } from "#/host/target-scope";
import { chipDescriptor, LaneBadge, LiveDot, resolutionReadout } from "#/host/target-ui";
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

/**
 * The world-lane target section — the state inspector grown up: what the chat's actions land on,
 * as raw resolution plus the client-observed world log. Sits above the context layers because
 * "against what world" precedes "with what context".
 */
export function TargetWorld() {
  const { selector, resolution, sessions, worldLog, pin } = useChatTarget();
  const chip = chipDescriptor(resolution);
  return (
    <div className="border-b-[0.5px] border-line px-3 py-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="t-label t-upper text-ink-2">Target</span>
        <span className="t-caption face-mono text-ink-2">{chip.tone}</span>
      </div>

      {/* raw resolution — provenance, not decoration */}
      <div className="mb-2 break-all t-caption face-mono leading-[1.5] text-ink-2">
        {resolutionReadout(resolution)}
      </div>

      {sessions.map((s) => {
        const isResolved =
          resolution.kind === "resolved" && resolution.session.sessionId === s.sessionId;
        return (
          <Verb
            label={sessionLabel(s)}
            reason="Pin the chat to this session."
            key={s.sessionId}
            onClick={() => pin(mintSelector(s, sessions))}
            // The resolved session is a SELECTION — the selection fill, never a hue.
            className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-left hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))] ${
              isResolved ? "bg-select [--r-on:var(--r-select)]" : ""
            }`}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <LiveDot
                tone={isResolved ? (selector === "" ? "implicit" : "pinned") : "muted"}
                lane={s.lane}
              />
              <span className="truncate t-value text-ink">{sessionLabel(s)}</span>
              {/* A session that reported no lane gets no badge — "not reported" rendered honestly. */}
              {s.lane ? <LaneBadge lane={s.lane} /> : null}
            </span>
            <span className="whitespace-nowrap t-caption face-mono text-ink-2">
              pid {s.processId}
            </span>
          </Verb>
        );
      })}
      {sessions.length === 0 ? (
        <EmptyState
          story="scope"
          exit="start Revit with the Pe add-in, or start a session from /instances"
        >
          no sessions connected
        </EmptyState>
      ) : null}

      {worldLog.length > 0 ? (
        <div className="mt-2 border-t-[0.5px] border-line pt-1.5">
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
    <div className="flex items-baseline gap-2 py-0.5 t-caption face-mono text-ink-2">
      <span className="opacity-70">{time}</span>
      <span className="truncate">{event.label}</span>
    </div>
  );
}
