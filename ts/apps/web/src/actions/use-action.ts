import { useCallback, useState } from "react";
import { useWork } from "@pe/kit/lang/work";
import { HostCallError } from "@pe/host-contracts/operation-types";

/** The sentence a person reads: a host refusal's own title, never `HostCallError: <op key>: …`. */
const failure = (error: unknown) =>
  Error(
    error instanceof HostCallError
      ? typeof error.problem?.title === "string"
        ? error.problem.title
        : error.message
      : error instanceof Error
        ? error.message
        : String(error),
  );

/* -- Host RPC: a call, not a subject ------------------------------------------------------ */

/**
 * An Action's run, as a component holds it: at most one in flight, its refusal kept, and its
 * success dirtying whatever Readings it names. Not a cache and not a queue.
 */
export function useAction<I, T>(
  run: (input: I) => Promise<T>,
  onSuccess?: (value: T, input: I) => void,
) {
  const [state, setState] = useState<{ pending: boolean; error?: Error }>({ pending: false });
  const mutateAsync = useCallback(
    async (input: I) => {
      setState({ pending: true });
      try {
        const value = await run(input);
        setState({ pending: false });
        onSuccess?.(value, input);
        return value;
      } catch (error) {
        setState({ pending: false, error: failure(error) });
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, onSuccess],
  );
  useWork(state.pending, "saving…");
  return {
    mutate: (input: I) => void mutateAsync(input).catch((error) => { console.error("use-action: asynchronous operation failed", error); }),
    mutateAsync,
    isPending: state.pending,
    error: state.error,
  };
}
