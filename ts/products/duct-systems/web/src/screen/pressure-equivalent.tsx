/** Quiet companion to an authored pressure drop; Work continues to store in-wg. */
export function PressureEquivalent({ inWg }: { inWg: number | null | undefined }) {
  return inWg == null || !Number.isFinite(inWg) ? null : (
    <span className="t-small text-ink-2 whitespace-nowrap">{(inWg * 249.0889).toFixed(1)} Pa</span>
  );
}
