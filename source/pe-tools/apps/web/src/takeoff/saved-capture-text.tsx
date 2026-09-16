import { useState } from "react";

import { Code } from "#/components/lang/code";
import { readSavedTakeoffText } from "../../../../packages/mcps/src/shared/takeoff-capture-client";
import { useHostCall } from "#/readings";

/**
 * The capture file's own stored text, read once by its already-validated ID when a reader opens it.
 * Read-only: Code highlights the supplied string with no parse and no write callback, so
 * whitespace and malformed JSON survive exactly. Expanding never adopts, writes, or refetches.
 */
export function SavedCaptureText({ id, base = "" }: { id: string; base?: string }) {
  // Disclosure mechanics; collapse/unmount is its only reset boundary.
  const [open, setOpen] = useState(false);
  const text = useHostCall(
    (signal) => readSavedTakeoffText(id, base, signal),
    ["takeoffs", "saved", "text", base, id],
    open,
  );
  return (
    <details className="p-2" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label="saved capture file text">Saved capture · file text as stored</summary>
      {text.error ? (
        <p role="alert">Could not read this capture's file text: {text.error.message}</p>
      ) : text.data ? (
        <>
          <p>{text.data.path}</p>
          <div className="max-h-64 overflow-auto" data-testid="saved-capture-text">
            <Code code={text.data.text} lang="json" title="file text" />
          </div>
        </>
      ) : (
        <p>{open ? "Reading file text…" : "Not read yet"}</p>
      )}
    </details>
  );
}
