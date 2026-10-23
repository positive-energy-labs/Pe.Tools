import { useState } from "react";
import type { EndpointFailure } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { Code } from "@pe/kit/lang/code";
import { OutcomeLine } from "@pe/kit/lang/outcome";

export function EndpointError({
  message,
  failure,
  detail = failure?.raw,
}: {
  message: string;
  failure?: EndpointFailure;
  detail?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <OutcomeLine kind="error" label={message} />
      {detail ? (
        <>
          <Button label="Raw error" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide raw error" : "Raw error"}
          </Button>
          {open ? (
            <Code code={detail} lang="text" head="copy" copyLabel="Copy the details" />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
