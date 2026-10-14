/**
 * The tray's notice card, mounted once at the root on the tray surface. The host projects receipt
 * revisions onto the `notices` Reading (the host log) and holds each burst ~30 s; the tray shim hands every item to
 * a native `notice` event once this card says `notice-ready`, and lends its window card-sized without
 * taking focus. One card pages every pending item: a new notice appends to the open card, a
 * draining timer walks passive items and ends after the last; pending asks hold the queue, hover
 * pauses it and typing stops it for good. Card messages ride the tray's string-JSON `type` protocol
 * (`notice-ready`/`notice-card`/`notice-hide`/`notice-panel`); opening an href is the surface's own
 * `open-window`. The card settles nothing: every answer goes to the thread's own door, which stays
 * the authority, and an item leaves only when that door accepts.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlarmClockOff, ArrowUp, Square, X } from "lucide-react";
import type { Machine, MachineNotice, Reading } from "@pe/agent-contracts";
import {
  nativeMessageSchema,
  postRendererMessage,
  type NativeWebView,
  type RendererMessage,
  type NativeMessageEvent,
} from "@pe/host-contracts/native-adapter";

import { QuestionForm } from "#/chat/question-form";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "#/components/lang/outcome";
import { Row } from "@pe/kit/lang/row";
import { Textarea } from "#/components/lang/textarea";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { useSurfaceHost } from "#/navigation/surface-host";
import { useDestination } from "#/navigation/state";
import { FailureNote } from "#/components/failure-note";
import { useAction } from "#/readings";

import {
  acknowledge,
  admit,
  currentView,
  loadLedger,
  saveLedger,
  snooze,
  wake,
  type NoticeLedger,
} from "./notice-policy";
import { AutomaticUpdates } from "./update";
import { NoticePreview } from "./notice-preview";

declare global {
  interface Window {
    chrome?: { webview?: NativeWebView };
  }
}

type TrayMessage = Extract<RendererMessage, { type: `notice-${string}` }>;
const tray = (message: TrayMessage) => postRendererMessage(window.chrome?.webview, message);

/** How long each item holds before the card walks on. */
export const NOTICE_DRAIN_MS = 8_000;
const TICK_MS = 100;
const FIXTURE = "Fixture: nothing here reaches a host.";
/** How often snoozed items are checked for their hour being up. */
const WAKE_MS = 30_000;

export function NoticeCard({ reading, fixture }: { reading: Reading<Machine>; fixture: boolean }) {
  const [items, setItems] = useState<MachineNotice[]>([]);
  const [at, setAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [typed, setTyped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const host = useSurfaceHost();
  const go = useDestination();
  const ledger = useRef<NoticeLedger | null>(null);
  /** This surface's own record of what the person has seen and snoozed, kept across reloads. */
  const record = (change: (ledger: NoticeLedger) => NoticeLedger) => {
    ledger.current = change(ledger.current ?? loadLedger(window.localStorage));
    saveLedger(window.localStorage, ledger.current);
  };
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const end = () => {
    // A card that ends has shown what it held: those revisions are acknowledged.
    for (const item of itemsRef.current) record((l) => acknowledge(l, item));
    itemsRef.current = [];
    setItems([]);
    setAt(0);
    setElapsed(0);
    setTyped(false);
    setError(null);
    setPreviewHeight(0);
  };
  useEffect(() => {
    const webview = window.chrome?.webview;
    const take = (next: MachineNotice) => {
      record((l) => l);
      const verdict = admit(ledger.current!, next, currentView(), Date.now());
      // Looking at that thread is seeing it: no card, and it will not come back.
      if (verdict === "looking") record((l) => acknowledge(l, next));
      if (verdict !== "show") {
        if (!itemsRef.current.length) tray({ type: "notice-hide" });
        return;
      }
      const list = itemsRef.current;
      const same = list.findIndex((item) => item.id === next.id);
      if (same >= 0 && list[same]!.revision >= next.revision) return;
      itemsRef.current =
        same < 0 ? [...list, next] : list.map((item, i) => (i === same ? next : item));
      setItems(itemsRef.current);
      setElapsed(0);
    };
    const receive = ({ data }: NativeMessageEvent) => {
      const parsed = nativeMessageSchema.safeParse(data);
      if (!parsed.success || parsed.data.type !== "notice") return;
      const next = parsed.data.notice;
      if (!next) return end();
      take(next);
    };
    webview?.addEventListener("message", receive);
    tray({ type: "notice-ready" });
    // A snoozed item whose hour is up comes back through the same door as a new one.
    const timer = setInterval(() => {
      record((l) => l);
      const woken = wake(ledger.current!, Date.now());
      if (!woken.due.length) return;
      record(() => woken.ledger);
      woken.due.forEach(take);
    }, WAKE_MS);
    return () => {
      webview?.removeEventListener("message", receive);
      clearInterval(timer);
    };
  }, []);

  const live = items.length > 0;
  const needsAnswer = items.some(
    (item) => item.act?.kind === "question" || item.act?.kind === "permission",
  );
  const last = at >= items.length - 1;
  useEffect(() => {
    if (!live || needsAnswer || held || typed || previewHeight > 0) return;
    const timer = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [live, needsAnswer, held, typed, previewHeight]);
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
    const report = () =>
      tray({ type: "notice-card", height: Math.ceil(element.getBoundingClientRect().height) });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element, { box: "border-box" });
    return () => observer.disconnect();
  }, [live, previewHeight]);

  const item = items[Math.min(at, items.length - 1)];
  useLayoutEffect(() => setPreviewHeight(0), [item?.id, item?.revision]);
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
    const settled = items.find((n) => n.id === id);
    if (settled) record((l) => acknowledge(l, settled));
    const rest = items.filter((n) => n.id !== id);
    if (rest.length === 0) return close({ type: "notice-hide" });
    setItems(rest);
    setAt((i) => Math.min(i, rest.length - 1));
    setElapsed(0);
    setError(null);
  };
  /** Take this item off the card for an hour; it returns once, and the others stay. */
  const snoozeItem = () => {
    record((l) => snooze(l, item, Date.now()));
    const rest = items.filter((n) => n.id !== item.id);
    if (rest.length === 0) {
      setItems([]);
      return tray({ type: "notice-hide" });
    }
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
  /** A failure's door opens in the tray panel at that route; the card steps aside. */
  const door = (href: string) => {
    go(href);
    close({ type: "notice-panel" });
  };
  return (
    <div
      ref={card}
      role="status"
      aria-label="notice"
      className="fixed right-0 bottom-0 z-notice w-[min(420px,100vw)]"
      style={{ paddingTop: previewHeight }}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div
        ref={shell}
        data-surface="artifact"
        className="hairline t-small flex max-h-96 flex-col gap-1.5 overflow-auto rounded-lg px-2 pt-1.5"
      >
        <div data-row="" className="flex min-w-0 shrink-0 items-center gap-1">
          {act?.kind === "reply" ? (
            <>
              <span className="t-small text-ink-2">Pea</span>
              <NoticePreview
                key={`${item.id}:${item.revision}`}
                title={item.title}
                body={item.body}
                anchor={shell}
                onOpen={open}
                onSize={setPreviewHeight}
              />
            </>
          ) : (
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
          )}
          <span className="t-small face-mono text-ink-2">{`${at + 1}/${items.length}`}</span>
          <Button kind="nav" direction="back" label="previous" onClick={() => step(-1)} />
          <Button kind="nav" direction="forward" label="next" onClick={() => step(1)} />
          <Button icon={AlarmClockOff} label="snooze for an hour" onClick={snoozeItem} />
          <Button icon={X} label="dismiss" onClick={() => close({ type: "notice-hide" })} />
        </div>
        {act?.kind === "reply" ? (
          <Reply
            key={item.id}
            threadId={act.threadId}
            fixture={fixture}
            onTyped={() => setTyped(true)}
            onError={setError}
          />
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
          <div className="min-h-0 overflow-auto">
            <FailureNote text={item.body} onDoor={door} />
          </div>
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
          className="boundary-t -mx-2 shrink-0"
          style={{
            width: typed || needsAnswer ? 0 : `${100 - (elapsed / NOTICE_DRAIN_MS) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

/** A small reply field and one Send/Stop slot; the response lives in the title preview. */
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
    <div className="flex min-w-0 items-end gap-1 pb-1">
      <Textarea
        surface="field"
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
      {
        /* One slot: Stop replaces Send while the reply runs. */
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
    </div>
  );
}
