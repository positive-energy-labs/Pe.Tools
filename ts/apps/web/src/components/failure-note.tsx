/**
 * The one way a failure reads (tray notice card; the ledger row uses the same summary and door):
 * one human line, the one door that fixes it when one exists, and the raw text folded behind
 * Details with copy. The words come from `summarizeFailure` in host-contracts, never from here.
 */
import { summarizeFailure } from "@pe/host-contracts/failure-summary";
import { Button } from "@pe/kit/lang/button";
import { Code } from "@pe/kit/lang/code";

export function FailureNote({ text, onDoor }: { text: string; onDoor: (href: string) => void }) {
  const failure = summarizeFailure(text);
  return (
    <div className="flex min-h-0 flex-col items-start gap-1">
      <p className="m-0">{failure.summary}</p>
      {failure.door && (
        <Button kind="framed" label={failure.door.label} onClick={() => onDoor(failure.door!.href)}>
          {failure.door.label}
        </Button>
      )}
      {failure.detail && (
        <details className="w-full min-h-0">
          <summary className="t-small text-ink-2">Details</summary>
          <div className="max-h-40 overflow-auto">
            <Code code={failure.detail} lang="plaintext" tone="error" wrap />
          </div>
        </details>
      )}
    </div>
  );
}
