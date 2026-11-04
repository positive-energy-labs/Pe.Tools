import { useEffect, useReducer } from "react";

/**
 * Whole seconds until a host consent deadline (`run-consent.ts`, the one deadline source), from
 * the clock read now. Never from a clock captured at mount: a head mounted minutes before a window
 * opened drew 193 s for a 60 s window until a throttled interval caught up (D8).
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
