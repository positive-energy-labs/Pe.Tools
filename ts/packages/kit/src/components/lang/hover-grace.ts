import { useEffect, useMemo } from "react";

/** One travel window for hover surfaces and the subjects they light. */
export const HOVER_GRACE = 700;
export function useHoverGrace<T>(close: (value: T) => void) {
  const grace = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: { value: T } | undefined;
    const cancel = () => {
      clearTimeout(timer);
      pending = undefined;
    };
    const leave = (value: T) => {
      cancel();
      pending = { value };
      timer = setTimeout(() => {
        pending = undefined;
        close(value);
      }, HOVER_GRACE);
    };
    return {
      cancel,
      leave,
      hold: () => {
        if (pending) leave(pending.value);
      },
    };
  }, [close]);
  useEffect(() => grace.cancel, [grace]);
  return grace;
}
