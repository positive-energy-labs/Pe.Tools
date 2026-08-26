import { getRouteApi } from "@tanstack/react-router";

import { EmptyState } from "#/components/lang/empty";
import { useFleet } from "#/host/fleet";
import { useBridgeSessionsListQuery } from "#/host/queries";
import { fromBridgeSessions, resolveTarget, type TargetSelector } from "#/host/target";
import { chipDescriptor, resolutionReadout } from "#/host/target-ui";
import { useWorldLog, type WorldEvent } from "#/host/use-target";
import { worldTrunk } from "#/targeting/world";

/**
 * Chat-wired target surfaces. The pin is the `target` search param (a selector, retained like
 * `thread`); resolution is live against the broker session list. One hook, three reflections:
 * the composer chip, the world-lane section, and the mapdial rail/ticks in the Lens.
 *
 * The chat target persists in the `?target` URL param.
 */

const chatRoute = getRouteApi("/chat");

export function useChatTarget() {
  const { target } = chatRoute.useSearch();
  const navigate = chatRoute.useNavigate();
  const selector: TargetSelector = target ?? "";
  const query = useBridgeSessionsListQuery();
  const sessions = fromBridgeSessions(query.data?.sessions ?? []);
  const resolution = resolveTarget(sessions, selector);
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
  const { resolution, sessions, worldLog, pin } = useChatTarget();
  const fleet = useFleet();
  const chip = chipDescriptor(resolution);
  const options = worldTrunk.feed(fleet).options ?? [];
  return (
    <div className="border-b-[0.5px] border-[var(--r-line)] px-3 py-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="t-label t-upper text-[var(--r-ink-2)]">Target</span>
        <span className="t-caption face-mono text-[var(--r-ink-2)]">{chip.tone}</span>
      </div>

      {/* raw resolution — provenance, not decoration */}
      <div className="mb-2 break-all t-caption face-mono leading-[1.5] text-[var(--r-ink-2)]">
        {resolutionReadout(resolution)}
      </div>

      {options.map((option) => {
        const optionResolution = resolveTarget(sessions, option.id);
        const isResolved =
          resolution.kind === "resolved" &&
          optionResolution.kind === "resolved" &&
          resolution.session.sessionId === optionResolution.session.sessionId;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => pin(option.id)}
            // The resolved session is a SELECTION — the selection fill, never a hue.
            className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-left hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))] ${
              isResolved ? "bg-[var(--r-select)] [--r-on:var(--r-select)]" : ""
            }`}
            title="pin the chat here"
          >
            <span className="truncate t-value text-[var(--r-ink)]">{option.label}</span>
            <span className="whitespace-nowrap t-caption face-mono text-[var(--r-ink-2)]">
              {option.sub}
            </span>
          </button>
        );
      })}
      {options.length === 0 ? (
        <EmptyState
          story="scope"
          exit="start Revit with the Pe add-in, or start a session from /instances"
        >
          no sessions connected
        </EmptyState>
      ) : null}

      {worldLog.length > 0 ? (
        <div className="mt-2 border-t-[0.5px] border-[var(--r-line)] pt-1.5">
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
    <div className="flex items-baseline gap-2 py-0.5 t-caption face-mono text-[var(--r-ink-2)]">
      <span className="opacity-70">{time}</span>
      <span className="truncate">{event.label}</span>
    </div>
  );
}
