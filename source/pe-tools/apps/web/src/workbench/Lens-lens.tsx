import { token } from "#/lib/token";
import { ThreadPrimitive } from "@assistant-ui/react";
import { modeDepth } from "./depth";
import { Moments } from "./aui";
import { RouteChatPluginDock } from "./route-chat-plugins";
import { WorldLane } from "./world";
import { SidePane } from "#/components/ui/side-pane";
import { EmptyState } from "#/components/lang/empty";
import { TargetWorld } from "#/components/chat-target";
import { chipDescriptor, laneVar } from "#/host/target-ui";
import { Press } from "#/components/lang/press";
import {
  ContextStrip,
  ToolCellBody,
  TraceCellView,
  formatTime,
  ticksForMoment,
} from "./Lens-context-strip";
import { useLensModel } from "./Lens-model";
import type { Mode } from "./depth";
import type { ChatState } from "./chat-state";

export function Lens({
  state,
  mode,
  initialTurn,
  scrollKey = "",
  onTurnChange,
  sideHead,
  threadList,
  onSideResize,
  sideOpen = true,
  onSideOpenChange,
}: {
  state: ChatState;
  mode: Mode;
  initialTurn?: number;
  scrollKey?: string;
  onTurnChange?: (turn: number | undefined) => void;
  sideHead?: React.ReactNode;
  threadList?: React.ReactNode;
  onSideResize?: (px: number) => void;
  sideOpen?: boolean;
  onSideOpenChange?: (open: boolean) => void;
}) {
  const {
    moments,
    traceCells,
    breakdown,
    userTurns,
    cache,
    chatTarget,
    targetTone,
    targetRailColor,
    frameRef,
    scrollerRef,
    chatRef,
    traceInnerRef,
    stripRef,
    wickRef,
    capTopRef,
    capBotRef,
    csFocalRef,
    caretRef,
    bandRefs,
    cardRefs,
    inspectKey,
    following,
    registerMoment,
    onPointerDown,
    scrollToTail,
  } = useLensModel({ state, mode, initialTurn, scrollKey, onTurnChange, sideOpen }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lens-frame" ref={frameRef} data-mode={mode}>
      <div className="lens-scroller" ref={scrollerRef}>
        <div className="lens-grid">
          <div className="mapdial" onPointerDown={onPointerDown} aria-label="Timeline">
            <div
              aria-hidden="true"
              title={`target: ${chipDescriptor(chatTarget.resolution).text}`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 2,
                backgroundColor: targetRailColor,
                opacity: targetTone === "muted" ? 0.25 : 0.55,
                zIndex: 1,
              }}
            />
            <div className="mapdial-strip" ref={stripRef}>
              {moments.map((moment, index) => (
                <div
                  key={moment.id}
                  data-key={moment.id}
                  className={`mapdial-band ${moment.role}${
                    cache.changed.size > 0 && index === moments.length - 1 ? " delta" : ""
                  }`}
                  ref={(el) => {
                    if (el) bandRefs.current.set(moment.id, el);
                    else bandRefs.current.delete(moment.id);
                  }}
                >
                  <span className="num" title={formatTime(moment.createdAt)}>
                    #{moment.turn}
                  </span>

                  {ticksForMoment(chatTarget.worldLog, moments, index).map((event, k) => (
                    <span
                      key={`${event.atMs}-${k}`}
                      title={event.label}
                      style={{
                        position: "absolute",
                        left: -32,
                        top: -1 + k * 3,
                        width: 6,
                        height: 2,
                        backgroundColor:
                          event.kind === "session-gone"
                            ? token("caution")
                            : laneVar(
                                chatTarget.sessions.find((s) => s.sessionId === event.sessionId)
                                  ?.lane ?? "installed",
                              ),
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="cs-wick" ref={wickRef} />
            <div className="cs-cap" ref={capTopRef} />
            <div className="cs-cap" ref={capBotRef} />
            <div className="cs-focal" ref={csFocalRef} />
            <div className="caret" ref={caretRef} />
            {!following && moments.length > 0 ? (
              <span className="mapdial-tail">
                <Press
                  type="button"
                  tone="quiet"
                  size="icon"
                  title="Jump to latest"
                  aria-label="Jump to latest"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={scrollToTail}
                >
                  ↓
                </Press>
              </span>
            ) : null}
          </div>

          <ThreadPrimitive.Root style={{ display: "contents" }}>
            <div className="lens-chat" ref={chatRef}>
              {moments.length === 0 ? (
                <div className="grid min-h-[60vh] place-content-center justify-items-center gap-1.5 px-6 text-center">
                  <h1 className="m-0 t-head face-display text-pea">Pea</h1>
                  <EmptyState story="scope" exit="ask anything below, or pick a thread on the left">
                    no messages in this thread yet
                  </EmptyState>
                </div>
              ) : null}
              <ContextStrip state={state} depth={modeDepth(mode)} />
              <Moments register={registerMoment} />
              <RouteChatPluginDock />
            </div>
          </ThreadPrimitive.Root>

          <SidePane
            side="left"
            storageKey="pe.sideWidth"
            minWidth={240}
            defaultWidth={300}
            open={sideOpen}
            onOpenChange={onSideOpenChange}
            onWidthChange={onSideResize}
            header={sideHead}
            className="lens-side-pane col-start-1 sticky top-0 border-r-[0.5px] on-artifact"
          >
            {mode === "trace" ? (
              <div className="lens-trace-frame">
                <div className="lens-pin" ref={traceInnerRef}>
                  {traceCells.map((cell) => (
                    <TraceCellView
                      key={cell.key}
                      cell={cell}
                      registerRef={(el) => {
                        if (el) cardRefs.current.set(cell.key, el);
                        else cardRefs.current.delete(cell.key);
                      }}
                    />
                  ))}
                </div>

                {(() => {
                  const cell = traceCells.find((c) => c.key === inspectKey);
                  return cell ? (
                    <div className="lens-inspect">
                      <ToolCellBody call={cell.call} />
                    </div>
                  ) : null;
                })()}
              </div>
            ) : mode === "world" ? (
              <>
                <TargetWorld />
                <WorldLane breakdown={breakdown} cache={cache} sendNumber={userTurns} />
              </>
            ) : (
              threadList
            )}
          </SidePane>
        </div>
      </div>
      {moments.length > 0 ? <div className="lens-scrim" aria-hidden="true" /> : null}
    </div>
  );
}
