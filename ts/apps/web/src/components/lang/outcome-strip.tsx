/**
 * THE OUTCOME STRIP — one rendering of the `busy`/`failure` pair every route owner carries.
 * Busy wins, then the refusal, then anything standing. The owner's own two values ARE the source;
 * nothing here keeps a second copy, and nothing here reads an atom.
 */
import type { ReactNode } from "react";

import { OutcomeLine } from "#/components/lang/outcome";
import type { Refusal } from "#/route";

/** What a route card reports about the last thing it ran. */
interface OutcomeFailure {
  kind: "error" | "refused" | "advisory" | "partial";
  action: string;
  message: string;
}

export function OutcomeStrip({
  busy,
  failure,
  standing,
}: {
  /** The running action, already worded by its owner (`"push · 3s"`). */
  busy?: string | null;
  failure?: Refusal | OutcomeFailure | null;
  standing?: ReactNode;
}) {
  if (busy) return <OutcomeLine kind="busy" label={busy} />;
  if (failure) {
    // A store refusal names a `code`; a route handle's failure names a `kind`. Same word.
    const code = "code" in failure ? failure.code : failure.kind;
    return (
      <OutcomeLine
        kind={code === "partial" ? "error" : "refused"}
        label={`${code} refusal`}
        says={failure.message}
      />
    );
  }
  return standing ? <>{standing}</> : null;
}
