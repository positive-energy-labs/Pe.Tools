/** THROWAWAY protoui T3 "Stacked into one": one paged notification, N need you. */
import { useState } from "react";
import type { VariantMeta } from "./lineup";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { Markdown } from "#/workbench/prose";
import { APPROVAL_ARGS, FINAL_MD, PROPOSAL_LINES, Win } from "./variant-T.shared";

export const meta: VariantMeta = {
  id: "T3",
  label: "One paged card",
  width: 420,
  height: 420,
  kind: "toasts",
};

const PAGES = ["Final response", "Approval", "Proposal"] as const;

export default function Variant() {
  const [done, setDone] = useState<boolean[]>([false, false, false]);
  const [i, setI] = useState(0);
  const left = done.filter((d) => !d).length;
  if (left === 0) return null;
  const finish = () => {
    const next = done.map((d, k) => d || k === i);
    setDone(next);
    const n = next.findIndex((d) => !d);
    if (n >= 0) setI(n);
  };
  const step = (s: number) => {
    for (let k = 1; k <= 3; k++) {
      const n = (i + s * k + 9) % 3;
      if (!done[n]) return setI(n);
    }
  };
  return (
    <Win width={420} bottom={12}>
      <div className="flex flex-col gap-2 p-3" style={{ height: 330 }}>
        <div className="flex items-center gap-1.5">
          <span data-tone="pea" className="t-small t-upper">
            Pea
          </span>
          <span className="t-prose">{left} need you</span>
          <span className="grow" />
          <Button kind="nav" direction="back" label="previous" onClick={() => step(-1)} />
          <span className="t-small face-mono text-ink-2">{PAGES[i]}</span>
          <Button kind="nav" direction="forward" label="next" onClick={() => step(1)} />
        </div>
        <div className="min-h-0 grow overflow-auto">
          {i === 0 && (
            <>
              <div className="t-small face-mono mb-1 text-ink-2">
                Retag level 2 diffusers · finished
              </div>
              <Markdown text={FINAL_MD} />
            </>
          )}
          {i === 1 && (
            <>
              <div className="t-prose mb-1">Write 3 schedules in HCB-48 Mechanical</div>
              <pre
                data-surface="recess"
                className="t-small face-mono overflow-auto rounded-control p-2"
              >
                {APPROVAL_ARGS}
              </pre>
            </>
          )}
          {i === 2 && (
            <>
              <div className="t-prose mb-1">
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
            </>
          )}
        </div>
        <div className="flex gap-1.5">
          {i === 0 && (
            <>
              <Input aria-label="reply to Pea" placeholder="Reply to Pea" />
              <Button kind="commit" label="Send" onClick={finish}>
                Send
              </Button>
            </>
          )}
          {i === 1 && (
            <>
              <Button kind="commit" label="Allow once" onClick={finish}>
                Allow once
              </Button>
              <Button kind="framed" label="Always" onClick={finish}>
                Always
              </Button>
              <Button label="Deny" onClick={finish}>
                Deny
              </Button>
            </>
          )}
          {i === 2 && (
            <>
              <Button kind="commit" label="Review" onClick={finish}>
                Review
              </Button>
              <Button kind="framed" label="Accept all" onClick={finish}>
                Accept all
              </Button>
              <Button label="Dismiss" onClick={finish}>
                Dismiss
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line pt-1.5">
          <span className="flex gap-1">
            {PAGES.map((p, k) => (
              <span
                key={p}
                className="size-1.5 rounded-full"
                style={{
                  background: k === i ? "var(--pe-ink)" : "var(--pe-line)",
                  opacity: done[k] ? 0.3 : 1,
                }}
              />
            ))}
          </span>
          <Button label="Open tray">Open tray</Button>
        </div>
      </div>
    </Win>
  );
}
