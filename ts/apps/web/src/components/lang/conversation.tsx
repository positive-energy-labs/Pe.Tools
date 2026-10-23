import { TooltipHint } from "@pe/kit/lang/tooltip";
/** The transcript turn (head, body, bubble, tool status) and the composer (frame, box). Presentation
 *  only; the logic lives in workbench/ and chat/. Painted in
 *  conversation.css. */
import { type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Textarea } from "@pe/kit/lang/input";
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
  target,
}: {
  role: "user" | "assistant";
  /** The harness that answered (a Pea turn): its mark leads the head, a rank under the name. */
  harness?: string;
  /** The user turn's index — the same `#n` the timeline's readout and hover preview say. */
  turn?: number;
  at?: Date;
  /** The Revit document this turn ran against, as its prompt recorded it: "on <name>" in mono. */
  target?: string;
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
      {target ? (
        <TooltipHint content={target}>
          <span className="dl-message-target">on {target}</span>
        </TooltipHint>
      ) : null}
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

/**
 * The one box you write in: work, the draft (it grows to a cap, then scrolls), the refusal and any
 * state chips, then one bottom row of controls: attach and the pickers' marks left, fork and
 * Send/Stop right. `variant="reply"` is the notice card's: the draft and the Send/Stop slot alone. Enter sends
 * unless `onKey` takes the key.
 */
export function Composer({
  variant,
  areaRef,
  dragging,
  drop,
  menus,
  work,
  refusal,
  pickers,
  attach,
  fork,
  tools,
  send,
  onSend,
  onKey,
  ...field
}: Omit<ComponentProps<typeof Textarea>, "ref" | "rows" | "surface" | "size" | "onKeyDown"> & {
  variant?: "reply";
  areaRef?: (area: HTMLTextAreaElement | null) => void;
  /** A file drag over the box takes the recess ground. */
  dragging?: boolean;
  drop?: ComponentProps<"div">;
  /** Popups anchored on the form (slash and `@` menus). */
  menus?: ReactNode;
  /** The box's top section: asks, chips, refusals. */
  work?: ReactNode;
  /** The one refusal line, directly below the draft. */
  refusal?: string | null;
  /** The marks after the attach control, bottom left; each opens its picker. */
  pickers?: ReactNode;
  /** The bottom row's first control. */
  attach?: ReactNode;
  /** Just left of Send, bottom right. */
  fork?: ReactNode;
  /** State chips; a row under the draft only when present. */
  tools?: ReactNode;
  /** The one Send/Stop slot. */
  send: ReactNode;
  onSend: () => void;
  /** True when the key belongs to an open menu, not the draft. */
  onKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}) {
  return (
    <form className="relative w-full">
      {menus}
      {/* The one object you write in: work it carries, the text, its controls. */}
      <div
        className="dl-composer-box"
        data-surface={dragging ? "recess" : "artifact"}
        data-drop-zone=""
        data-variant={variant}
        {...drop}
      >
        <div data-composer-work="">{work}</div>
        <Textarea
          {...field}
          ref={areaRef}
          surface="embedded"
          rows={1}
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
        {/* Bottom left: attach, then the pickers' marks. */}
        {attach || pickers ? (
          <div data-composer-lead="">
            {attach}
            {pickers}
          </div>
        ) : null}
        {/* Bottom right: fork, then the one Send slot (Stop replaces Send while a turn runs). */}
        <div data-composer-cluster="">
          {fork}
          <div data-composer-send="">{send}</div>
        </div>
      </div>
    </form>
  );
}
