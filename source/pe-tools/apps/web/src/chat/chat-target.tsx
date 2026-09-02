import { chatStyles } from "#/components/lang/chat-appearance";
import { getRouteApi } from "@tanstack/react-router";

import { EmptyState } from "#/components/lang/empty";
import { useFleet } from "#/host/fleet";
import { useBridgeSessionsListQuery } from "#/host/queries";
import { fromBridgeSessions, resolveTarget, type TargetSelector } from "#/host/target";
import { chipDescriptor, resolutionReadout } from "#/host/target-ui";
import { useWorldLog, type WorldEvent } from "#/host/use-target";
import { worldTrunk } from "#/targeting/world";
import { useWorkbench } from "#/workbench/provider";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";
import { cn } from "#/lib/utils";

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
  const { revit } = useWorkbench();
  const query = useBridgeSessionsListQuery({ enabled: revit === true });
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
  const { revit } = useWorkbench();
  const fleet = useFleet({ enabled: revit === true });
  const chip = chipDescriptor(resolution);
  const options = worldTrunk.feed(fleet).options ?? [];
  return (
    <div className={cn(chatStyles.chatTarget0(), "border-b-0 py-2.5")}>
      <div className={cn(chatStyles.chatTarget1(), "mb-1")}>
        <span className={cn(chatStyles.chatTarget2(), "text-ink")}>World target</span>
        <span className={chatStyles.chatTarget3()}>{chip.tone}</span>
      </div>

      {/* raw resolution — provenance, not decoration */}
      <div className={cn(chatStyles.chatTarget4(), "mb-1.5")}>{resolutionReadout(resolution)}</div>

      {options.map((option) => {
        const optionResolution = resolveTarget(sessions, option.id);
        const isResolved =
          resolution.kind === "resolved" &&
          optionResolution.kind === "resolved" &&
          resolution.session.sessionId === optionResolution.session.sessionId;
        return (
          <Press
            key={option.id}
            type="button"
            onClick={() => pin(option.id)}
            // The resolved session is a SELECTION — the selection fill, never a hue.
            tone="neutral"
            state={isResolved ? "selected" : "rest"}
            title="pin the chat here"
          >
            <PressContent geometry="row">
              <span className={chatStyles.chatTarget5()}>{option.label}</span>
              <span className={chatStyles.chatTarget6()}>{option.sub}</span>
            </PressContent>
          </Press>
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
        <div className={chatStyles.chatTarget7()}>
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
    <div className={chatStyles.chatTarget8()}>
      <span className={chatStyles.chatTarget9()}>{time}</span>
      <span className={chatStyles.chatTarget10()}>{event.label}</span>
    </div>
  );
}
