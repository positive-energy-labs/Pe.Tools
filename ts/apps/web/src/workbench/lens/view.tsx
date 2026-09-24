import { useRef } from "react";
import { annotation } from "#/components/anatomy";
import { modeDepth } from "../depth";
import { Moments } from "../moments";
import { EmptyState, emptyMark } from "#/components/lang/empty";
import { ContextStrip, formatTime } from "./context-strip";
import { useLensModel } from "./model";
import type { Mode } from "../depth";
import type { ChatState } from "../chat-state";

export function Lens({
  state,
  mode,
  sideOpen = true,
}: {
  state: ChatState;
  mode: Mode;
  sideOpen?: boolean;
  /** The tool call pinned open in the transcript — it owns the inspect window while set. */
}) {
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
  } = useLensModel({ state, mode, sideOpen }); // eslint-disable-line react-hooks/exhaustive-deps
  const previewRef = useRef<HTMLSpanElement>(null);

  return (
    <div {...annotation("frame")} ref={frameRef} data-mode={mode}>
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
            <ContextStrip state={state} depth={modeDepth(mode)} />
            <Moments messages={messages} register={registerMoment} />
          </div>
        </div>
      </div>
      {moments.length > 0 ? <div {...annotation("scrim")} aria-hidden="true" /> : null}
    </div>
  );
}
