import { useEffect, useRef } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { useWorkbench } from "#/workbench/provider";
import { annotation } from "#/components/anatomy";
import { Moments } from "../moments";
import { EmptyState, emptyMark } from "@pe/kit/lang/empty";
import { formatTime } from "./moments";
import { useLensModel } from "./model";
import type { ChatState } from "@pe/agent-contracts/chat-state";

export function Lens({ state }: { state: ChatState }) {
  const {
    messages,
    moments,
    showEmpty,
    cache,
    frameRef,
    scrollerRef,
    chatRef,
    stripRef,
    wickRef,
    capTopRef,
    capBotRef,
    csFocalRef,
    caretRef,
    bandRefs,
    registerMoment,
    onBandClick,
    awayFromTail,
  } = useLensModel({ state });
  const previewRef = useRef<HTMLSpanElement>(null);
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
        <div {...annotation("grid")}>
          <div
            {...annotation("dial")}
            onClick={onBandClick}
            onMouseOver={(event) => {
              // One floating label outside the bands: a band's own opacity would dim it.
              const label = previewRef.current;
              const band = (event.target as HTMLElement).closest<HTMLElement>(
                '[data-annotation="dial-band"]',
              );
              const moment = band && moments.find((m) => m.id === band.dataset.key);
              if (!label) return;
              label.hidden = !moment;
              if (!band || !moment) return;
              const box = band.getBoundingClientRect();
              label.textContent = `#${moment.turn}${moment.preview ? `  ${moment.preview}` : ""}`;
              label.style.top = `${box.top + box.height / 2 - event.currentTarget.getBoundingClientRect().top}px`;
            }}
            onMouseLeave={() => {
              if (previewRef.current) previewRef.current.hidden = true;
            }}
            aria-label="Timeline"
          >
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
            <span {...annotation("dial-preview")} ref={previewRef} hidden />
            {awayFromTail ? (
              <div className="chat-tail-rail">
                <Button
                  icon={ArrowDown}
                  label="Jump to latest turn in timeline"
                  onClick={() => window.dispatchEvent(new Event("pe:focus-tail"))}
                />
              </div>
            ) : null}
          </div>

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
      </div>
      {moments.length > 0 ? <div {...annotation("scrim")} aria-hidden="true" /> : null}
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
