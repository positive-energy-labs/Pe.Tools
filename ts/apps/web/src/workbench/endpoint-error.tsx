import { useState } from "react";
import type { EndpointFailure } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { Code } from "@pe/kit/lang/code";
import { OutcomeLine } from "#/components/lang/outcome";

export function EndpointError({
  message,
  failure,
}: {
  message: string;
  failure?: EndpointFailure;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <OutcomeLine kind="error" label={message} />
      {failure ? (
        <>
          <Button label="Raw error" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide raw error" : "Raw error"}
          </Button>
          {open ? <Code code={failure.raw} lang="text" /> : null}
        </>
      ) : null}
    </div>
  );
}
