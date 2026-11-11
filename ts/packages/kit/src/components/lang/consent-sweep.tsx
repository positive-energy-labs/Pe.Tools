/**
 * The consent sweep (ADR 0035 rule 6): consent is drawn in two places only, the write button that
 * asked and this sweep. One component, mounted in the topbar on web and as the card in the tray
 * shell. Each open window is one row: the thread, the verb that will write, the seconds left, and
 * Reject (the host's `stop_writes` answer, the same `thread.permission` door the write button
 * answers). Auto-approve off is a row with no deadline and no sweep, where Allow is the way on.
 *
 * The sweep "goes down": a bar that empties downward as the window closes. It is the one hue on
 * the row (`caution`, on the timer alone, I3); everything else stays monotone.
 */
import { useEffect, useReducer, type ReactNode } from "react";

import { tv } from "../../lib/tv";

import { Button } from "./button";

import "./lang.css";

export interface ConsentWindow {
  readonly requestId: string;
  readonly threadId: string;
  /** The thread's title, never its id (I1). The card's own head names it, so `card` omits it. */
  readonly thread: string;
  /** What will write when the window closes: the tool's title, or "Pea writes" for run consent. */
  readonly verb: string;
  /** ISO instant the host auto-approves at; absent while auto-approve is off. */
  readonly deadline?: string;
  /** Null when the window offers no reject option, so the row says why. */
  readonly reject: { readonly optionId: string } | null;
  /** The ask's allow option: answers now instead of waiting the window out. */
  readonly allow?: { readonly optionId: string };
}

export interface ConsentSweepProps {
  readonly windows: readonly ConsentWindow[];
  /** Answers the host once per press (a refusal shows on the button); the row leaves when the feed drops the window. */
  readonly onReject: (window: ConsentWindow) => void | Promise<void>;
  /** Without it the row draws no Allow: the deadline or the write button settles it. */
  readonly onAllow?: (window: ConsentWindow) => void | Promise<void>;
  /** `topbar` is one line; `card` is the tray's stacked card under the card's own head. */
  readonly shell: "topbar" | "card";
}

// ponytail: the host's one window length (`run-consent.ts` WRITE_COUNTDOWN_MS); a longer window
// draws full until it is inside the last minute. Carry the opened instant if lengths ever vary.
const SPAN_S = 60;

/**
 * Whole seconds until a host consent deadline, from the clock read now. Never from a clock
 * captured at mount: a head mounted minutes before a window opened drew 193 s for a 60 s window
 * until a throttled interval caught up (D8).
 */
export const secondsLeft = (deadline: string, now = Date.now()) =>
  Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));

/** Redraw once a second while a countdown shows; the value itself is read at render. */
export function useSecondTick(active: boolean) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active]);
}

export const consentSweepRecipe = tv({
  slots: {
    base: "flex min-w-0",
    row: "flex min-w-0 items-stretch gap-2",
    bar: "relative w-1 shrink-0 self-stretch bg-line",
    fill: "absolute inset-x-0 bottom-0",
    words: "flex min-w-0 flex-wrap items-baseline gap-x-2 t-small",
    thread: "min-w-0 truncate text-ink",
    verb: "min-w-0 truncate text-ink-2",
    timer: "face-mono tabular-nums",
    controls: "flex shrink-0 items-center gap-1.5",
  },
  variants: {
    shell: {
      topbar: { base: "items-center gap-3", words: "flex-nowrap" },
      card: { base: "flex-col gap-1.5" },
    },
  },
});

export function ConsentSweep({ windows, onReject, onAllow, shell }: ConsentSweepProps): ReactNode {
  useSecondTick(windows.some((w) => w.deadline));
  if (!windows.length) return null;
  const slots = consentSweepRecipe({ shell });
  return (
    <div className={slots.base()} role="group" aria-label="Consent" data-slot="consent-sweep">
      {windows.map((window) => {
        const left = window.deadline ? secondsLeft(window.deadline) : null;
        return (
          <div key={window.requestId} className={slots.row()} data-slot="consent-window">
            {left !== null && (
              <span aria-hidden className={slots.bar()}>
                <span
                  data-tone="caution"
                  data-fill="tone"
                  data-slot="sweep"
                  className={slots.fill()}
                  style={{ height: `${Math.min(1, left / SPAN_S) * 100}%` }}
                />
              </span>
            )}
            <span className={slots.words()}>
              {shell === "topbar" && <span className={slots.thread()}>{window.thread}</span>}
              <span className={slots.verb()}>{window.verb}</span>
              {left === null ? (
                <span className="text-ink-2">Auto-approve is off</span>
              ) : (
                <span
                  role="timer"
                  aria-label={`${window.verb} applies in`}
                  data-tone="caution"
                  className={slots.timer()}
                >
                  {left}s
                </span>
              )}
            </span>
            <span className={slots.controls()}>
              <Button
                kind="framed"
                label={`Reject ${window.verb}`}
                refusal={window.reject ? null : "This consent window offers no reject option"}
                onPress={() => onReject(window)}
              >
                Reject?
              </Button>
              {onAllow && window.allow && (
                <Button
                  kind={left === null ? "commit" : "quiet"}
                  label={left === null ? `Allow ${window.verb}` : `Allow ${window.verb} now`}
                  onPress={() => onAllow(window)}
                >
                  {left === null ? "Allow" : "Allow now"}
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
