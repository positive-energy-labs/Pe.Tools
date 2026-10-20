/** THROWAWAY protoui T2 "Rich": markdown final response, composer reply, exact tool args, change summary. */
import { useState } from "react";
import type { VariantMeta } from "./lineup";
import { Button } from "#/components/lang/button";
import { Textarea } from "#/components/lang/textarea";
import { ComposerBox, ComposerRow } from "#/components/lang/conversation";
import { Markdown } from "#/workbench/prose";
import { APPROVAL_ARGS, FINAL_MD, PROPOSAL_LINES, Win, Who } from "./variant-T.shared";

export const meta: VariantMeta = {
  id: "T2",
  label: "Rich toasts",
  width: 420,
  height: 700,
  kind: "toasts",
};

export default function Variant() {
  const [open, setOpen] = useState({ a: true, b: true, c: true });
  const [reply, setReply] = useState("");
  const hide = (k: "a" | "b" | "c") => setOpen((o) => ({ ...o, [k]: false }));
  const hC = 232;
  const hB = 262;
  const gap = 8;
  return (
    <>
      {open.c && (
        <Win width={420} bottom={12}>
          <div className="flex flex-col gap-2 p-3" style={{ height: hC }}>
            <Who what="proposal ready" onClose={() => hide("c")} />
            <div className="t-prose">
              HCB-48 family <span className="face-mono text-ink-2">22 changes</span>
            </div>
            <div
              data-surface="recess"
              className="t-small face-mono flex flex-col gap-0.5 rounded-control p-2"
            >
              {PROPOSAL_LINES.map((l) => (
                <div key={l} className="truncate">
                  {l}
                </div>
              ))}
            </div>
            <div className="mt-auto flex gap-1.5">
              <Button kind="commit" label="Review" onClick={() => hide("c")}>
                Review
              </Button>
              <Button kind="framed" label="Accept all">
                Accept all
              </Button>
              <Button label="Dismiss" onClick={() => hide("c")}>
                Dismiss
              </Button>
            </div>
          </div>
        </Win>
      )}
      {open.b && (
        <Win width={420} bottom={12 + (open.c ? hC + gap : 0)}>
          <div className="flex flex-col gap-2 p-3" style={{ height: hB }}>
            <Who what="approval requested" onClose={() => hide("b")} />
            <div className="t-prose">Pea wants to write 3 schedules.</div>
            <pre
              data-surface="recess"
              className="t-small face-mono overflow-auto rounded-control p-2"
            >
              {APPROVAL_ARGS}
            </pre>
            <div className="mt-auto flex gap-1.5">
              <Button kind="commit" label="Allow once" onClick={() => hide("b")}>
                Allow once
              </Button>
              <Button kind="framed" label="Always" onClick={() => hide("b")}>
                Always
              </Button>
              <Button label="Deny" onClick={() => hide("b")}>
                Deny
              </Button>
            </div>
          </div>
        </Win>
      )}
      {open.a && (
        <Win width={420} bottom={12 + (open.c ? hC + gap : 0) + (open.b ? hB + gap : 0)}>
          <div className="flex flex-col gap-2 p-3">
            <Who what="Retag level 2 diffusers · finished" onClose={() => hide("a")} />
            <div className="max-h-[200px] overflow-auto">
              <Markdown text={FINAL_MD} />
            </div>
            <ComposerBox>
              <Textarea
                surface="embedded"
                size="compact"
                aria-label="reply to Pea"
                placeholder="Reply to Pea"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <ComposerRow
                lead={<span className="t-small text-ink-2">continues this thread</span>}
                trail={
                  <Button kind="commit" label="Send" onClick={() => setReply("")}>
                    Send
                  </Button>
                }
              />
            </ComposerBox>
          </div>
        </Win>
      )}
    </>
  );
}
