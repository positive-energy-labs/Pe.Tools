/** The transcript turn (head, body, bubble, tool status) and the composer (frame, box). Presentation
 *  only, the box's open/rest motion included; the logic lives in workbench/ and chat/. Painted in
 *  conversation.css. */
import {
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Textarea } from "./textarea";
import { ProviderMark } from "./provider-mark";
import "@pe/kit/lang/lang.css";
import "./conversation.css";

/** Who spoke, then when, then which turn: the speaker in the reading face (Pea in its identity
 *  ink), the clock and the turn index in the machine face beside it, each a rank quieter. A user
 *  head sits over its bubble. */
export function MessageHead({
  role,
  harness,
  turn,
  at,
}: {
  role: "user" | "assistant";
  /** The harness that answered (a Pea turn): its mark leads the head, a rank under the name. */
  harness?: string;
  /** The user turn's index — the same `#n` the timeline's readout and hover preview say. */
  turn?: number;
  at?: Date;
}) {
  return (
    <h2 className="dl-message-head" data-role={role}>
      {role === "assistant" && harness ? (
        <span className="dl-message-mark">
          <ProviderMark harness={harness} />
        </span>
      ) : null}
      <span data-tone={role === "assistant" ? "pea" : undefined}>
        {role === "assistant" ? "Pea" : "You"}
      </span>
      <span className="dl-message-meta">
        {at ? (
          <time dateTime={at.toISOString()}>
            {at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </time>
        ) : null}
        {turn ? <span data-slot="turn">#{turn}</span> : null}
      </span>
    </h2>
  );
}
/** What you sent, on the artifact plane: the one enclosed block in the transcript is yours. */
export function MessageBubble({ children }: { children: ReactNode }) {
  return (
    <div className="dl-message-bubble" data-surface="artifact">
      {children}
    </div>
  );
}
export function ConversationBody({
  children,
  role,
}: {
  children: ReactNode;
  role: "user" | "assistant";
}) {
  return (
    <div className="dl-message-body" data-role={role}>
      {children}
    </div>
  );
}
export function ToolStatus({
  state,
}: {
  state: "working" | "waiting" | "failed" | "done" | "denied" | "cancelled" | "expired";
}) {
  return (
    <span
      className="dl-tool-status"
      data-tone={state === "failed" ? "alarm" : state === "waiting" ? "caution" : undefined}
      data-state={state}
    >
      {state}
    </span>
  );
}
/** The composer's lane: the transcript's measure, then the box. */
export function ComposerFrame({ children }: { children: ReactNode }) {
  return <div className="dl-composer-frame">{children}</div>;
}

type ComposerVariant = "full" | "compact" | "reply";
export interface ComposerHandle {
  /** A send was accepted: outside `full`, rest at one line and give focus back to the page. */
  rest: () => void;
}

/**
 * The one box you write in. At rest the draft is one line, the pickers' marks stacked on its left
 * and Send on its right; open while you write, it grows to five lines over a bottom row of
 * pickers, tools and Send (conversation.css draws the motion). `full` is the page's, `compact` the
 * tray panel's, `reply` the notice card's: the draft and the Send/Stop slot alone. Enter sends
 * unless `onKey` takes the key; focus leaving the box (React focus bubbles through its portalled
 * popups) rests it, a window losing focus does not.
 */
export function Composer({
  ref,
  variant,
  areaRef,
  dragging,
  drop,
  menus,
  work,
  refusal,
  pickers,
  tools,
  send,
  onSend,
  onKey,
  ...field
}: Omit<ComponentProps<typeof Textarea>, "ref" | "rows" | "surface" | "size" | "onKeyDown"> & {
  ref?: Ref<ComposerHandle>;
  variant: ComposerVariant;
  areaRef?: (area: HTMLTextAreaElement | null) => void;
  /** A file drag over the box takes the recess ground. */
  dragging?: boolean;
  drop?: ComponentProps<"div">;
  /** Popups anchored on the form (slash and `@` menus). */
  menus?: ReactNode;
  /** The box's top section: asks, chips, refusals. */
  work?: ReactNode;
  /** The one refusal line, directly below the draft in every variant. */
  refusal?: string | null;
  pickers?: (open: boolean) => ReactNode;
  tools?: ReactNode;
  /** The one Send/Stop slot. */
  send: ReactNode;
  onSend: () => void;
  /** True when the key belongs to an open menu, not the draft. */
  onKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useImperativeHandle(ref, () => ({
    rest: () => {
      if (variant === "full") return;
      setOpen(false);
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && form.current?.contains(focused)) focused.blur();
    },
  }));
  const timer = useRef<number>(undefined);
  const hold = () => window.clearTimeout(timer.current);
  const release = () => {
    hold();
    timer.current = window.setTimeout(() => {
      if (!document.hasFocus()) return;
      setOpen(false);
      const area = form.current?.querySelector("textarea");
      if (area) area.scrollTop = 0;
    });
  };
  return (
    <form ref={form} onFocus={hold} onBlur={release} className="relative w-full">
      {menus}
      {/* The one object you write in: work it carries, the text, its controls. */}
      <div
        className="dl-composer-box"
        data-surface={dragging ? "recess" : "artifact"}
        data-drop-zone=""
        data-variant={variant}
        data-open={open || undefined}
        {...drop}
      >
        <div data-composer-work="">{work}</div>
        {pickers ? <div data-composer-pickers="">{pickers(open)}</div> : null}
        <Textarea
          {...field}
          ref={areaRef}
          surface="embedded"
          rows={1}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || onKey?.(event)) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        {refusal ? (
          <div data-composer-refusal="" data-tone="caution" role="alert">
            {refusal}
          </div>
        ) : null}
        {tools ? <div data-composer-tools="">{tools}</div> : null}
        {/* One slot: Stop replaces Send while a turn runs, so the two never coexist. */}
        <div data-composer-send="">{send}</div>
      </div>
    </form>
  );
}
