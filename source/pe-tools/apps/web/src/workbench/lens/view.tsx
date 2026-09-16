import { annotation } from "#/components/anatomy";
import { modeDepth } from "../depth";
import { Moments } from "../moments";
import { RouteChatPluginDock } from "../route-chat-plugins";
import { SessionStrip } from "../world";
import { SidePane } from "#/components/lang/side-pane";
import { EmptyState, emptyMark } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
import { ContextStrip, ToolCellBody, TraceCellView, formatTime } from "./context-strip";
import { useLensModel } from "./model";
import type { Mode } from "../depth";
import type { ChatState } from "../chat-state";

export function Lens({
  state,
  mode,
  sideHead,
  threadList,
  onSideResize,
  sideOpen = true,
  onSideOpenChange,
  pinKey = null,
  onPinChange,
}: {
  state: ChatState;
  mode: Mode;
  sideHead?: React.ReactNode;
  threadList?: React.ReactNode;
  onSideResize?: (px: number) => void;
  sideOpen?: boolean;
  onSideOpenChange?: (open: boolean) => void;
  /** The tool call pinned open in the transcript — it owns the inspect window while set. */
  pinKey?: string | null;
  onPinChange?: (key: string | null) => void;
}) {
  const {
    messages,
    moments,
    traceCells,
    breakdown,
    userTurns,
    cache,
    threadScope,
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
  } = useLensModel({ state, mode, sideOpen }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div {...annotation("frame")} ref={frameRef} data-mode={mode}>
      <div {...annotation("scroller")} ref={scrollerRef}>
        <div {...annotation("grid")}>
          <div {...annotation("dial")} onPointerDown={onPointerDown} aria-label="Timeline">
            <div
              aria-hidden="true"
              title={`to: ${threadScope.defaultTarget === null ? "none" : threadScope.defaultTarget.kind === "named" ? threadScope.defaultTarget.address : threadScope.defaultTarget.ref.openId} r${threadScope.revision}`}
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
            <div {...annotation("dial-strip")} ref={stripRef}>
              {moments.map((moment, index) => (
                <div
                  key={moment.id}
                  data-key={moment.id}
                  {...annotation("dial-band")}
                  data-role={moment.role}
                  data-delta={
                    cache.changed.size > 0 && index === moments.length - 1 ? "" : undefined
                  }
                  ref={(el) => {
                    if (el) bandRefs.current.set(moment.id, el);
                    else bandRefs.current.delete(moment.id);
                  }}
                >
                  <span {...annotation("dial-number")} title={formatTime(moment.createdAt)}>
                    #{moment.turn}
                  </span>
                </div>
              ))}
            </div>
            <div {...annotation("reticle-wick")} ref={wickRef} />
            <div {...annotation("reticle-cap")} ref={capTopRef} />
            <div {...annotation("reticle-cap")} ref={capBotRef} />
            <div {...annotation("reticle-focal")} ref={csFocalRef} />
            <div {...annotation("caret")} ref={caretRef} />
            {!following && moments.length > 0 ? (
              <span {...annotation("tail")}>
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

          <div {...annotation("chat")} ref={chatRef}>
            {moments.length === 0 ? (
              <div className="grid min-h-[60vh] place-content-center justify-items-center gap-1.5 px-6 text-center">
                <h1 className={emptyMark()} data-tone="pea">
                  Pea
                </h1>
                <EmptyState story="scope" exit="ask anything below, or pick a thread on the left">
                  no messages in this thread yet
                </EmptyState>
              </div>
            ) : null}
            <ContextStrip state={state} depth={modeDepth(mode)} />
            <Moments messages={messages} register={registerMoment} />
            <RouteChatPluginDock />
          </div>

          <div className="col-start-1 sticky top-0 flex" {...annotation("side-pane")}>
            <SidePane
              side="left"
              storageKey="pe.sideWidth"
              minWidth={240}
              defaultWidth={300}
              open={sideOpen}
              onOpenChange={onSideOpenChange}
              onWidthChange={onSideResize}
              header={sideHead}
            >
              {mode === "trace" ? (
                <div {...annotation("trace-frame")}>
                  <div {...annotation("trace-pin")} ref={traceInnerRef}>
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
                    // A pin outranks hover and focal: the inspect window holds what you clicked
                    // until you unpin it, so it can be read and scrolled.
                    const cell = traceCells.find((c) => c.key === (pinKey ?? inspectKey));
                    return cell ? (
                      <div {...annotation("inspect")} data-pinned={pinKey ? "" : undefined}>
                        {pinKey ? (
                          <Press
                            type="button"
                            tone="quiet"
                            size="caption"
                            title="Unpin this call"
                            onClick={() => onPinChange?.(null)}
                          >
                            unpin
                          </Press>
                        ) : null}
                        <ToolCellBody call={cell.call} />
                      </div>
                    ) : null;
                  })()}
                </div>
              ) : mode === "world" ? (
                <SessionStrip breakdown={breakdown} cache={cache} sendNumber={userTurns} />
              ) : (
                threadList
              )}
            </SidePane>
          </div>
        </div>
      </div>
      {moments.length > 0 ? <div {...annotation("scrim")} aria-hidden="true" /> : null}
    </div>
  );
}
