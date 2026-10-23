import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover } from "@base-ui/react/popover";
import { MessageSquarePlus, Send } from "lucide-react";

import { Button } from "@pe/kit/lang/button";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { PopupFrame } from "@pe/kit/lang/list-popup";
import { OutcomeLine } from "#/components/lang/outcome";
import { Textarea } from "@pe/kit/lang/input";
import { deliverFeedback, sendFeedback, type FeedbackReceipt } from "#/host/feedback";
import { useAction } from "#/readings";
import { useScopeKeys } from "@pe/kit/keys";

// Pick one element, write a note, send it with a cropped picture through the host, which keeps it
// first and hands it to PostHog second. A kept note that did not deliver says so and can retry.
type Grab = typeof import("react-grab/primitives");
type Rect = { x: number; y: number; width: number; height: number };
type Picked = {
  element: Element;
  rect: Rect;
  context: Awaited<ReturnType<Grab["getElementContext"]>>;
};

const PAD = 20;
const NOTE_LABEL = "feedback note";
/** Chrome the picture leaves out; the pick mark stays in so the crop shows what was meant. */
const CHROME = "data-feedback-chrome";
const START_FEEDBACK = "pe:start-feedback";

/** Use the one picker from a tutorial or a message's own feedback control. */
export function startFeedback(element?: Element) {
  window.dispatchEvent(new CustomEvent(START_FEEDBACK, { detail: element }));
}

export function FeedbackPicker({ hideTrigger = false }: { hideTrigger?: boolean }) {
  const grab = useRef<Grab | null>(null);
  const capture = useRef(0);
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState<Rect | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [note, setNote] = useState("");
  const [kept, setKept] = useState<FeedbackReceipt | null>(null);
  const [cancelHost, setCancelHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const update = () => setCancelHost(document.getElementById("pe-feedback-cancel"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const close = () => {
    capture.current++;
    setPicking(false);
    setHover(null);
    setPicked(null);
    setNote("");
    setKept(null);
  };
  const settle = (receipt: FeedbackReceipt) =>
    receipt.delivery === "accepted" ? close() : setKept(receipt);

  // A refusal keeps the popover and the typed note; a kept, undelivered note keeps its receipt.
  const send = useAction(async ({ context, rect }: Picked) => {
    const picture = await snapshot(rect).then(
      (dataUrl) => ({ dataUrl, error: null }),
      (error: unknown) => ({ dataUrl: null, error: String(error) }),
    );
    return sendFeedback({
      comment: note.trim(),
      url: location.href,
      selector: context.selector,
      component: context.componentName,
      components: context.stack.map((f) => f.functionName).filter((n): n is string => !!n),
      html: context.htmlPreview.slice(0, 4000),
      rect,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      picture: picture.dataUrl,
      picture_error: picture.error,
    });
  }, settle);
  const deliver = useAction(deliverFeedback, settle);
  const submit = () => picked && note.trim() && !kept && !send.isPending && send.mutate(picked);

  useEffect(() => {
    const start = (event: Event) => {
      const element = (event as CustomEvent<Element | undefined>).detail;
      close();
      setPicking(true);
      if (!element) return;
      const attempt = capture.current;
      void import("react-grab/primitives")
        .then(async (g) => {
          grab.current = g;
          const context = await g.getElementContext(element);
          if (attempt === capture.current && element.isConnected)
            setPicked({ element, rect: g.getElementBounds(element), context });
        })
        .catch(() => {
          /* The regular picker remains available when direct capture fails. */
        });
    };
    window.addEventListener(START_FEEDBACK, start);
    return () => {
      capture.current++;
      window.removeEventListener(START_FEEDBACK, start);
    };
  }, []);

  // Bound only while picking: idle, it would sit beside the route's own Escape on the document.
  useScopeKeys(
    [
      {
        hotkey: "Escape",
        callback: close,
        label: "cancel feedback",
        says: "stop picking without sending a note",
      },
    ],
    picking && !picked ? undefined : null,
  );

  useEffect(() => {
    if (!picking || picked) return;
    let live = true;
    void import("react-grab/primitives").then((g) => live && (grab.current = g));
    const chrome = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(`[${CHROME}]`);
    const at = (e: MouseEvent) =>
      grab.current?.getElementAtPoint(e.clientX, e.clientY, {
        filter: (el) => grab.current!.isElementGrabbable(el) && !chrome(el),
      }) ?? null;
    const move = (e: PointerEvent) => {
      const el = at(e);
      setHover(el ? grab.current!.getElementBounds(el) : null);
    };
    const click = (e: MouseEvent) => {
      if (chrome(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = at(e);
      if (!el || !grab.current) return;
      const g = grab.current;
      // ponytail: no freeze() — it halts every React update, including this popover.
      void g
        .getElementContext(el)
        .then((context) => setPicked({ element: el, rect: g.getElementBounds(el), context }));
    };
    const swallow = (e: Event) => !chrome(e.target) && e.preventDefault();
    window.addEventListener("pointermove", move, true);
    window.addEventListener("click", click, true);
    window.addEventListener("pointerdown", swallow, true);
    return () => {
      live = false;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("pointerdown", swallow, true);
    };
  }, [picking, picked]);

  const box = picked?.rect ?? hover;
  return (
    <>
      {box && (
        <div
          className="pick-mark fixed z-popup"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
      {picking && cancelHost
        ? createPortal(
            <span {...{ [CHROME]: "" }} data-react-grab-ignore>
              <HotkeyCommand
                label="cancel feedback"
                word="Cancel"
                hotkey="Escape"
                invoke={close}
                bind={false}
                face="responsive"
                reason="Stop picking without sending a note"
              />
            </span>,
            cancelHost,
          )
        : null}
      {(!hideTrigger || picking) && !cancelHost ? (
        <div
          {...{ [CHROME]: "" }}
          data-react-grab-ignore
          className="fixed bottom-(--gutter) left-(--gutter) z-popup flex h-(--rail-h) items-center"
        >
          <Button
            kind="framed"
            label={picking ? "cancel feedback" : "feedback"}
            icon={MessageSquarePlus}
            onClick={() => (picking ? close() : setPicking(true))}
            reason={
              picking
                ? "Stop picking without sending a note"
                : "Pick one thing on this page and send a note about it"
            }
          >
            {picking ? "cancel feedback" : "feedback"}
          </Button>
        </div>
      ) : null}
      <Popover.Root
        open={!!picked}
        // Only cancel and Esc drop a note; a stray outside click must not lose typed text.
        onOpenChange={(open, details) => !open && details.reason !== "outside-press" && close()}
      >
        {picked && (
          <PopupFrame anchor={picked.element} label={NOTE_LABEL}>
            <div {...{ [CHROME]: "" }} className="flex w-80 flex-col gap-2 px-2 py-1">
              <span className="t-small face-mono text-ink-2">
                {picked.context.componentName ?? picked.element.tagName.toLowerCase()}
              </span>
              <Textarea
                autoFocus
                size="compact"
                value={note}
                placeholder="What's wrong or what should change?"
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  submit();
                }}
              />
              {send.error && <OutcomeLine kind="error" label={send.error.message} />}
              {kept && kept.delivery !== "accepted" ? (
                <OutcomeLine
                  kind="refused"
                  label={`kept ${kept.feedbackId.slice(0, 8)}, ${kept.delivery === "failed" ? "not delivered" : "delivery unconfirmed"}: ${kept.error}`}
                  says="the note is on this host; deliver it again or close"
                />
              ) : null}
              {deliver.error && <OutcomeLine kind="error" label={deliver.error.message} />}
              <div className="flex justify-end gap-2">
                <Button kind="framed" label="cancel" onClick={close} reason="Drop this note">
                  cancel
                </Button>
                {kept ? (
                  <Button
                    kind="commit"
                    label="deliver again"
                    icon={Send}
                    busy={deliver.isPending}
                    onClick={() => deliver.mutate(kept.feedbackId)}
                    reason="Hand the note this host kept to PostHog again; the browser does not resend it"
                  >
                    deliver again
                  </Button>
                ) : (
                  <Button
                    kind="commit"
                    label="send"
                    icon={Send}
                    busy={send.isPending}
                    refusal={note.trim() ? null : "Write a note first"}
                    onClick={submit}
                    reason="Send this note and a picture of the marked element to PostHog"
                  >
                    send
                  </Button>
                )}
              </div>
            </div>
          </PopupFrame>
        )}
      </Popover.Root>
    </>
  );
}

/** Rasterize the page with the pick mark, crop to it plus padding, encode WebP. */
async function snapshot(rect: Rect) {
  const { domToCanvas } = await import("modern-screenshot");
  const scale = Math.min(devicePixelRatio, 2);
  const page = await domToCanvas(document.documentElement, {
    scale,
    width: innerWidth,
    height: innerHeight,
    filter: (node) =>
      !(
        node instanceof Element &&
        (node.hasAttribute(CHROME) || node.getAttribute("aria-label") === NOTE_LABEL)
      ),
  });
  const x = Math.max(0, rect.x - PAD);
  const y = Math.max(0, rect.y - PAD);
  const w = Math.min(innerWidth, rect.x + rect.width + PAD) - x;
  const h = Math.min(innerHeight, rect.y + rect.height + PAD) - y;
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  out
    .getContext("2d")!
    .drawImage(page, x * scale, y * scale, w * scale, h * scale, 0, 0, out.width, out.height);
  const dataUrl = out.toDataURL("image/webp", 0.8);
  // Matches the host's ANALYTICS_PAYLOAD_BUDGET; the note still sends without its picture.
  if (dataUrl.length > 256 * 1024) throw new Error(`picture too large (${dataUrl.length} chars)`);
  return dataUrl;
}
