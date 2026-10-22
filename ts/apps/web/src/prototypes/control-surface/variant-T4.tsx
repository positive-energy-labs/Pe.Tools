/** THROWAWAY protoui T4 "Paged card r2": T3 + compact composer, draining timer, live append, dense lane. */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { VariantMeta } from "./lineup";
import { Button } from "@pe/kit/lang/button";
import { Composer, ComposerFrame } from "#/components/lang/conversation";
import { Markdown } from "#/workbench/prose";
import { APPROVAL_ARGS, FINAL_MD, PROPOSAL_LINES, Win } from "./variant-T.shared";

export const meta: VariantMeta = {
  id: "T4",
  label: "Paged card r2",
  width: 420,
  height: 420,
  kind: "toasts",
};

type Item = { id: number; kind: "final" | "approval" | "proposal"; title: string };
const SEED: Item[] = [
  { id: 1, kind: "final", title: "Final response" },
  { id: 2, kind: "approval", title: "Approval" },
  { id: 3, kind: "proposal", title: "Proposal" },
];
const LATE: Item[] = [
  { id: 4, kind: "approval", title: "Approval" },
  { id: 5, kind: "proposal", title: "Proposal" },
];
const DRAIN_MS = 8000;

// OWED: Markdown / the conversation lane has no density prop; this wrapper class forces a denser rung.
const DENSE =
  "text-[12.5px] [&_*]:!leading-[1.35] [&_p]:!my-0.5 [&_ul]:!my-0.5 [&_li]:!my-0 [&_table]:!my-1 [&_th]:!py-0 [&_td]:!py-0 [&_h1]:!my-1 [&_h2]:!my-1";

export default function Variant() {
  const [items, setItems] = useState<Item[]>(SEED);
  const [i, setI] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [alive, setAlive] = useState(true);
  const [gone, setGone] = useState(false);
  const [hold, setHold] = useState(false);
  const [typed, setTyped] = useState(false);
  const [reply, setReply] = useState("");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState(0);
  const paused = hold || typed;

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const iRef = useRef(i);
  iRef.current = i;

  // live append
  useEffect(() => {
    if (!alive) return;
    const ts = [
      setTimeout(() => setItems((l) => [...l, LATE[0]!]), 6000),
      setTimeout(() => setItems((l) => [...l, LATE[1]!]), 14000),
    ];
    return () => ts.forEach(clearTimeout);
  }, [run, alive]);

  // drain
  useEffect(() => {
    if (!alive || paused) return;
    const t = setInterval(() => {
      setElapsed((e) => {
        if (e + 100 < DRAIN_MS) return e + 100;
        if (iRef.current + 1 < itemsRef.current.length) setI(iRef.current + 1);
        else setAlive(false);
        return 0;
      });
    }, 100);
    return () => clearInterval(t);
  }, [alive, paused]);

  // fade out, then unmount
  useEffect(() => {
    if (alive) return;
    const t = setTimeout(() => setGone(true), 400);
    return () => clearTimeout(t);
  }, [alive]);

  // fake run: Send -> 2.5 s -> idle
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setRunning(false), 2500);
    return () => clearTimeout(t);
  }, [running]);

  const replay = () => {
    setItems(SEED);
    setI(0);
    setElapsed(0);
    setTyped(false);
    setReply("");
    setRunning(false);
    setGone(false);
    setAlive(true);
    setRun((r) => r + 1);
  };

  const finish = () => {
    setItems((l) => {
      const next = l.filter((_, k) => k !== i);
      if (next.length === 0) setAlive(false);
      return next;
    });
    setI((k) => Math.max(0, Math.min(k, items.length - 2)));
    setElapsed(0);
  };
  const step = (s: number) => {
    setI((k) => (k + s + items.length) % items.length);
    setElapsed(0);
  };

  const footnote = (
    <div className="absolute bottom-2 left-3 flex items-center gap-3">
      <span className="t-small face-mono text-document/50">
        items buffer 30 s before the first notification
      </span>
      {!alive ? (
        <button
          type="button"
          className="t-small rounded-control border border-document/30 px-2 py-0.5 text-document/80"
          onClick={replay}
        >
          show again
        </button>
      ) : null}
    </div>
  );

  const item = items[i];
  if (gone || !item) return footnote;

  const send = () => {
    if (!reply.trim()) return;
    setReply("");
    setRunning(true);
  };

  return (
    <>
      {footnote}
      <Win width={420} bottom={12}>
        <div
          className="flex flex-col gap-1.5 p-3 transition-opacity duration-300"
          style={{ height: 346, opacity: alive ? 1 : 0 }}
          onMouseEnter={() => setHold(true)}
          onMouseLeave={() => setHold(false)}
          onFocusCapture={() => setHold(true)}
          onBlurCapture={() => setHold(false)}
        >
          <div className="flex items-center gap-1.5">
            <span data-tone="pea" className="t-small t-upper">
              Pea
            </span>
            <span className="t-prose">{items.length} need you</span>
            <span className="grow" />
            <Button kind="nav" direction="back" label="previous" onClick={() => step(-1)} />
            <span className="t-small face-mono text-ink-2">{item.title}</span>
            <Button kind="nav" direction="forward" label="next" onClick={() => step(1)} />
          </div>
          <div className="min-h-0 grow overflow-auto">
            {item.kind === "final" && (
              <>
                <div className="t-small face-mono mb-0.5 text-ink-2">
                  Retag level 2 diffusers · finished
                </div>
                <Markdown text={FINAL_MD} className={DENSE} />
              </>
            )}
            {item.kind === "approval" && (
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
            {item.kind === "proposal" && (
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
          {item.kind === "final" ? (
            <ComposerFrame>
              <Composer
                variant="reply"
                aria-label="reply to Pea"
                placeholder="Reply to Pea"
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  setTyped(true);
                }}
                onSend={send}
                style={{ maxHeight: "4.5em", minHeight: "1.5em" }}
                send={
                  /* One slot: Stop replaces Send while the reply runs. */
                  running ? (
                    <Button
                      kind="framed"
                      icon={Square}
                      label="Stop"
                      data-tone="alarm"
                      onClick={() => setRunning(false)}
                    />
                  ) : (
                    <Button kind="commit" icon={ArrowUp} label="Send" onClick={send} />
                  )
                }
              />
            </ComposerFrame>
          ) : (
            <div className="flex gap-1.5">
              {item.kind === "approval" ? (
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
              ) : (
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
          )}
          <div className="flex items-center justify-between border-t border-line pt-1.5">
            <span className="flex gap-1">
              {items.map((it, k) => (
                <span
                  key={it.id}
                  className="size-1.5 rounded-full"
                  style={{ background: k === i ? "var(--pe-ink)" : "var(--pe-line)" }}
                />
              ))}
            </span>
            <Button label="Open tray">Open tray</Button>
          </div>
        </div>
        <div className="h-[2px] w-full bg-line/40">
          <div
            className="h-full bg-ink-2"
            style={{
              width: `${typed ? 0 : 100 - (elapsed / DRAIN_MS) * 100}%`,
              transition: "width 100ms linear",
            }}
          />
        </div>
      </Win>
    </>
  );
}
