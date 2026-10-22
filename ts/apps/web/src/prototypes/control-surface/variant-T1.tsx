/** THROWAWAY protoui T1 "Compact": Windows-toast-sized, one line each, single-input reply. */
import { useState } from "react";
import type { VariantMeta } from "./lineup";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { FINAL_ONE_LINE, Win, Who } from "./variant-T.shared";

export const meta: VariantMeta = {
  id: "T1",
  label: "Compact toasts",
  width: 360,
  height: 300,
  kind: "toasts",
};

function Timer({ s }: { s: number }) {
  return (
    <div className="h-[2px] w-full bg-line/40">
      <div
        className="h-full bg-ink-2"
        style={{ animation: `t1shrink ${s}s linear infinite`, transformOrigin: "left" }}
      />
      <style>{`@keyframes t1shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}`}</style>
    </div>
  );
}

export default function Variant() {
  const [open, setOpen] = useState({ a: true, b: true, c: true });
  const [reply, setReply] = useState("");
  const [focus, setFocus] = useState(false);
  const [sent, setSent] = useState(false);
  const hide = (k: "a" | "b" | "c") => setOpen((o) => ({ ...o, [k]: false }));
  const hA = focus ? 132 : 100;
  const hB = 112;
  const hC = 100;
  const gap = 8;
  return (
    <>
      {open.c && (
        <Win width={360} bottom={12}>
          <div className="flex flex-col gap-1.5 p-3" style={{ height: hC - 2 }}>
            <Who what="proposal ready" onClose={() => hide("c")} />
            <div className="t-prose">HCB-48 family: 22 changes</div>
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
          <Timer s={20} />
        </Win>
      )}
      {open.b && (
        <Win width={360} bottom={12 + (open.c ? hC + gap : 0)}>
          <div className="flex flex-col gap-1.5 p-3" style={{ height: hB - 2 }}>
            <Who what="needs approval" onClose={() => hide("b")} />
            <div className="t-prose truncate">Write 3 schedules in HCB-48 Mechanical</div>
            <div className="t-small face-mono truncate text-ink-2">Diffuser, Air Terminal, AHU</div>
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
          <div data-tone="caution" className="h-[2px] bg-current/70" />
        </Win>
      )}
      {open.a && (
        <Win width={360} bottom={12 + (open.c ? hC + gap : 0) + (open.b ? hB + gap : 0)}>
          <div className="flex flex-col gap-1.5 p-3" style={{ height: hA - 2 }}>
            <Who what="Retag level 2 diffusers" onClose={() => hide("a")} />
            <div className="t-prose truncate">{sent ? "Reply sent." : FINAL_ONE_LINE}</div>
            <div className="mt-auto flex gap-1.5">
              <Input
                aria-label="reply to Pea"
                placeholder="Reply to Pea"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onFocus={() => setFocus(true)}
                onBlur={() => setFocus(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && reply) {
                    setSent(true);
                    setReply("");
                  }
                }}
              />
              {focus ? (
                <Button kind="commit" label="Send">
                  Send
                </Button>
              ) : null}
            </div>
          </div>
          <Timer s={12} />
        </Win>
      )}
    </>
  );
}
