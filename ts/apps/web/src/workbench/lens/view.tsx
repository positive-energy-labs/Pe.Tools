import { useEffect, useRef } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { useWorkbench } from "#/workbench/provider";
import { annotation } from "#/components/anatomy";
import { Moments } from "../moments";
import { EmptyState, emptyMark } from "@pe/kit/lang/empty";
import { toTurns } from "./moments";
import { TurnPeek } from "./peek";
import { useLensModel } from "./model";
import { cycleLensVariant, useLensVariant } from "./variant";
import type { ChatState } from "@pe/agent-contracts/chat-state";

/** TEMPORARY (protoui wave 10): Alt+L cycles the slot-sizing variants; the pill names the one on
 *  screen. Shown only once a variant was picked (`?lens=` or Alt+L); the default screen is clean. */
function LensVariantSwitch() {
  const variant = useLensVariant();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== "l") return;
      event.preventDefault();
      cycleLensVariant();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!variant) return null;
  return (
    <div data-lens-variant="" role="status">
      lens: {variant} · Alt+L
    </div>
  );
}

export function Lens({ state }: { state: ChatState }) {
  const {
    messages,
    moments,
    showEmpty,
    cache,
    frameRef,
    scrollerRef,
    chatRef,
    dialRef,
    thumbRef,
    bandRefs,
    tickRefs,
    registerMoment,
    goTo,
    awayFromTail,
  } = useLensModel({ state });
  const laneRef = useRef<HTMLDivElement>(null);
  const turns = toTurns(moments);
  const { updateThread, threads } = useWorkbench();
  const updateRead = useRef(updateThread);
  updateRead.current = updateThread;
  const observedRevision = useRef<number | undefined>(undefined);
  let seenSeq = 0;
  for (let index = state.events.length - 1; index >= 0; index--) {
    const event = state.events[index]!;
    if (
      event.kind === "turn_end" ||
      event.kind === "error" ||
      event.kind === "permission_request" ||
      event.kind === "question_request"
    ) {
      seenSeq = event.seq;
      break;
    }
  }
  const summary = threads.find(
    (thread) => thread.id === state.id && thread.activity.lastSeq >= seenSeq,
  );
  const observed = summary ?? (state.activity.lastSeq >= seenSeq ? state : undefined);
  observedRevision.current = observed?.lifecycle.revision;
  const readReady = observed !== undefined;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !state.id || !readReady) return;
    const expectedRevision = observedRevision.current;
    let acknowledged = false;
    const read = () => {
      if (
        acknowledged ||
        document.visibilityState !== "visible" ||
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 40
      )
        return;
      acknowledged = true;
      void updateRead.current(state.id, { expectedRevision, readSeq: seenSeq });
    };
    const timer = setTimeout(read, 300);
    scroller.addEventListener("scroll", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      clearTimeout(timer);
      scroller.removeEventListener("scroll", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [readReady, scrollerRef, seenSeq, state.id]);

  return (
    <div {...annotation("frame")} ref={frameRef}>
      <div {...annotation("scroller")} ref={scrollerRef}>
        <div {...annotation("chat")} ref={chatRef}>
          {showEmpty ? (
            <div className="grid min-h-[60vh] place-content-center justify-items-center gap-1.5 px-6 text-center">
              <h1 className={emptyMark()} data-tone="pea">
                Pea
              </h1>
              <EmptyState story="scope" exit="ask anything below, or pick a thread on the left">
                no messages in this thread yet
              </EmptyState>
            </div>
          ) : null}
          <Moments messages={messages} register={registerMoment} harness={state.harness} />
        </div>
      </div>
      {/* The lane: outside the scroller, so only the transcript scrolls. It spans the chat's
          measure + side lane like the composer frame, so the rail rides the composer's right
          lane, centred between the pane head and the composer. A wheel over it still scrolls
          the transcript. */}
      <div
        {...annotation("lane")}
        ref={laneRef}
        onWheel={(event) => scrollerRef.current?.scrollBy({ top: event.deltaY })}
      >
        <div {...annotation("dial")} ref={dialRef} aria-label="Timeline">
          <div {...annotation("thumb")} ref={thumbRef} />
          {turns.map((turn, index) => (
            <div
              key={turn.first}
              data-key={turn.first}
              data-index={index}
              {...annotation("dial-band")}
              data-delta={cache.changed.size > 0 && index === turns.length - 1 ? "" : undefined}
              ref={(el) => {
                if (el) bandRefs.current.set(turn.first, el);
                else bandRefs.current.delete(turn.first);
              }}
            />
          ))}
          {turns.map((turn, index) => (
            <div
              key={turn.turn}
              data-index={index}
              {...annotation("dial-tick")}
              ref={(el) => {
                if (el) tickRefs.current.set(turn.turn, el);
                else tickRefs.current.delete(turn.turn);
              }}
            />
          ))}
        </div>
        <TurnPeek turns={turns} laneRef={laneRef} dialRef={dialRef} goTo={goTo} />
      </div>
      <LensVariantSwitch />
      {awayFromTail ? (
        <div className="chat-tail-floater">
          <Button
            icon={ArrowDown}
            label="Jump to latest turn"
            kind="framed"
            onClick={() => window.dispatchEvent(new Event("pe:focus-tail"))}
          />
        </div>
      ) : null}
    </div>
  );
}
