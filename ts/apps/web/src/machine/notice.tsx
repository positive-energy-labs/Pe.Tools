/**
 * The tray's notice card, mounted once at the root on the tray surface. The host projects receipt
 * revisions onto `/host/notices` and holds each burst ~30 s; the tray shim hands every item to
 * `window.peNotice` once this card says `notice-ready`, and lends its window card-sized without
 * taking focus. One card pages every pending item: a new notice appends to the open card, a
 * draining timer walks item to item and the card ends after the last, hover pauses it and typing
 * stops it for good. Card messages ride the tray's string-JSON `type` protocol
 * (`notice-ready`/`notice-card`/`notice-hide`/`notice-panel`); opening an href is the surface's own
 * `open-window`. The card settles nothing: every answer goes to the thread's own door, which stays
 * the authority, and an item leaves only when that door accepts.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import type { Machine, MachineNotice, Reading } from "@pe/agent-contracts";

import { QuestionForm } from "#/chat/question-form";
import { Button } from "@pe/kit/lang/button";
import { ComposerBox, ComposerFrame, ComposerRow } from "#/components/lang/conversation";
import { OutcomeLine } from "#/components/lang/outcome";
import { Row } from "@pe/kit/lang/row";
import { Textarea } from "#/components/lang/textarea";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { Markdown } from "#/workbench/prose";
import { useSurfaceHost } from "#/navigation/surface-host";
import { useAction } from "#/readings";

import { AutomaticUpdates } from "./update";

declare global {
  interface Window {
    peNotice?: (notice: MachineNotice | null) => void;
    chrome?: { webview?: { postMessage(message: string): void } };
  }
}

type TrayMessage =
  | { type: "notice-ready" }
  | { type: "notice-card"; height: number }
  | { type: "notice-hide" }
  | { type: "notice-panel" };
const tray = (message: TrayMessage) => window.chrome?.webview?.postMessage(JSON.stringify(message));

/** How long each item holds before the card walks on. */
export const NOTICE_DRAIN_MS = 8_000;
const TICK_MS = 100;
const FIXTURE = "Fixture: nothing here reaches a host.";

export function NoticeCard({ reading, fixture }: { reading: Reading<Machine>; fixture: boolean }) {
  const [items, setItems] = useState<MachineNotice[]>([]);
  const [at, setAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [typed, setTyped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const host = useSurfaceHost();

  const end = () => {
    setItems([]);
    setAt(0);
    setElapsed(0);
    setTyped(false);
    setError(null);
  };
  useEffect(() => {
    window.peNotice = (next) => {
      if (!next) return end();
      setItems((list) => {
        const same = list.findIndex((item) => item.id === next.id);
        return same < 0 ? [...list, next] : list.map((item, i) => (i === same ? next : item));
      });
    };
    tray({ type: "notice-ready" });
    return () => void delete window.peNotice;
  }, []);

  const live = items.length > 0;
  const last = at >= items.length - 1;
  useEffect(() => {
    if (!live || held || typed) return;
    const timer = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [live, held, typed]);
  useEffect(() => {
    if (elapsed < NOTICE_DRAIN_MS) return;
    setElapsed(0);
    if (last) {
      end();
      tray({ type: "notice-hide" });
    } else setAt((i) => i + 1);
  }, [elapsed, last]);

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      tray({ type: "notice-card", height: Math.ceil(element.getBoundingClientRect().height) }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [live]);

  const item = items[Math.min(at, items.length - 1)];
  if (!item) return null;
  const close = (message: TrayMessage) => {
    end();
    tray(message);
  };
  const step = (by: number) => {
    setAt((i) => (i + by + items.length) % items.length);
    setElapsed(0);
    setError(null);
  };
  /** The thread's door accepted: this item is settled; the card pages on, or ends. */
  const settle = (id: string) => {
    const rest = items.filter((n) => n.id !== id);
    if (rest.length === 0) return close({ type: "notice-hide" });
    setItems(rest);
    setAt((i) => Math.min(i, rest.length - 1));
    setElapsed(0);
    setError(null);
  };
  const refused = (caught: unknown) => setError(`Pea did not take this answer: ${String(caught)}`);
  const harness = () => harnessClient(resolveWorkbenchConfig().origin);
  const open = () =>
    close(
      item.href && host.openFullWindow(item.href)
        ? { type: "notice-hide" }
        : { type: "notice-panel" },
    );
  const act = item.act;
  return (
    <div
      ref={card}
      role="status"
      aria-label="notice"
      data-surface="artifact"
      className="hairline fixed right-0 bottom-0 z-notice flex max-h-dvh w-[min(420px,100vw)] flex-col gap-1.5 px-3 pt-2"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 grow">
          <Row
            role="button"
            tabIndex={0}
            label={item.title}
            title={item.href ? "open it in the app window" : "open the tray panel"}
            onClick={open}
            onKeyDown={(event) => event.key === "Enter" && open()}
          />
        </div>
        <span className="t-small face-mono text-ink-2">{`${at + 1}/${items.length}`}</span>
        <Button kind="nav" direction="back" label="previous" onClick={() => step(-1)} />
        <Button kind="nav" direction="forward" label="next" onClick={() => step(1)} />
        <Button icon={X} label="dismiss" onClick={() => close({ type: "notice-hide" })} />
      </div>
      {act?.kind === "reply" ? (
        <>
          <div className="max-h-64 min-h-0 overflow-auto">
            <Markdown text={item.body} />
          </div>
          <Reply
            key={item.id}
            threadId={act.threadId}
            fixture={fixture}
            onTyped={() => setTyped(true)}
            onError={setError}
          />
        </>
      ) : act?.kind === "question" ? (
        <QuestionForm
          key={act.requestId}
          question={act}
          onAnswer={(action, content) =>
            fixture
              ? setError(FIXTURE)
              : harness()
                  .question(act.threadId, act.requestId, action, content)
                  .then(() => settle(item.id), refused)
          }
        />
      ) : (
        <p className="text-ink-2">{item.body}</p>
      )}
      {act?.kind === "permission" ? (
        <span className="flex flex-wrap gap-1.5">
          {act.options.map((option) => (
            <Button
              key={option.optionId}
              kind={option.kind.startsWith("allow") ? "commit" : "framed"}
              label={option.name}
              reason={fixture ? FIXTURE : `answer Pea: ${option.name}`}
              refusal={fixture ? FIXTURE : null}
              onClick={() =>
                void harness()
                  .permission(act.threadId, act.requestId, option.optionId)
                  .then(() => settle(item.id), refused)
              }
            >
              {option.name}
            </Button>
          ))}
        </span>
      ) : act?.kind === "automatic-updates" ? (
        <AutomaticUpdates reading={reading} fixture={fixture} />
      ) : null}
      {error ? <OutcomeLine kind="refused" label={error} /> : null}
      {/* The drain: what is left of this item's hold; gone once typing stopped it for good. */}
      <div
        aria-hidden
        className="boundary-t -mx-3"
        style={{ width: typed ? 0 : `${100 - (elapsed / NOTICE_DRAIN_MS) * 100}%` }}
      />
    </div>
  );
}

/** The compact composer: the chat composer's own box, row and one Send/Stop slot. */
function Reply({
  threadId,
  fixture,
  onTyped,
  onError,
}: {
  threadId: string;
  fixture: boolean;
  onTyped: () => void;
  onError: (error: string | null) => void;
}) {
  const [text, setText] = useState("");
  /** The turn this reply started: Stop holds the slot until it is stopped. */
  const [turn, setTurn] = useState<string | null>(null);
  const harness = () => harnessClient(resolveWorkbenchConfig().origin);
  const reply = useAction(
    (input: string) => harness().prompt(threadId, { text: input }),
    ({ turnId }) => {
      setText("");
      setTurn(turnId);
      onError(null);
    },
  );
  const send = () => {
    if (fixture || reply.isPending || !text.trim()) return;
    reply
      .mutateAsync(text)
      .catch((caught: unknown) => onError(`Pea did not take this reply: ${String(caught)}`));
  };
  const stop = () =>
    void harness()
      .cancel(threadId)
      .then(
        () => setTurn(null),
        (caught: unknown) => onError(`Pea did not stop: ${String(caught)}`),
      );
  return (
    <ComposerFrame>
      <ComposerBox>
        <Textarea
          surface="embedded"
          size="compact"
          rows={1}
          aria-label="reply to Pea"
          placeholder="Reply to Pea"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            onTyped();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <ComposerRow
          lead={null}
          trail={
            /* One slot: Stop replaces Send while the reply runs, so the two never coexist. */
            turn ? (
              <Button kind="framed" icon={Square} label="Stop" data-tone="alarm" onClick={stop} />
            ) : (
              <Button
                kind="commit"
                icon={ArrowUp}
                label="Send"
                busy={reply.isPending}
                refusal={fixture ? FIXTURE : text.trim() ? null : "Write a reply first."}
                onClick={send}
              />
            )
          }
        />
      </ComposerBox>
    </ComposerFrame>
  );
}
