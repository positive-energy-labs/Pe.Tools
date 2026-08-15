/** The verb bracket — one in-flight host operation at a time (the host owns one transaction;
 * interleaving reads mid-write would render a half-true world).
 *
 * One hook replaces the three hand-rolled busy/error idioms the routes grew independently —
 * including the one where `setBusy(null)` sat outside `finally`, so a thrown verb wedged the
 * route busy forever.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** What the Sentence's receipt slot eats: what happened, and when it happened. */
export interface VerbReceipt {
  text: string;
  atMs: number;
}

export function useVerb() {
  const [busy, setBusy] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<VerbReceipt | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  /** Serialized: a verb fired while another runs is dropped, not queued. A string returned by
   * `work` becomes the receipt; errors surface as "<label> failed — <message>". `setError`
   * stays exposed for verbs whose SUCCESS path still has something to say (refusals, empty
   * results). */
  const run = useCallback(async (label: string, work: () => Promise<string | void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setSeconds(0);
    setError(null);
    try {
      const text = await work();
      if (typeof text === "string") setReceipt({ text, atMs: Date.now() });
    } catch (cause) {
      setError(`${label} failed — ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }, []);

  return { busy, seconds, error, setError, receipt, run };
}
