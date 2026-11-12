import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { OutcomeLine } from "@pe/kit/lang/outcome";

/** The cut sheet's source and its attach verb. A refused verb says why on the page, not only in its description. */
export function AttachPdf({ open, onAttach }: { open: boolean; onAttach(source: string): void }) {
  const [source, setSource] = useState("");
  const refusal = !open ? "Choose a saved family" : !source ? "Enter a PDF path or URL" : null;
  return (
    <>
      <label>
        PDF path or URL
        <Input
          aria-label="PDF path or URL"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      <Button label="Attach PDF path or URL" refusal={refusal} onClick={() => onAttach(source)}>
        Attach PDF
      </Button>
      {refusal && <OutcomeLine kind="refused" label={refusal} />}
    </>
  );
}
