import { TooltipHint } from "@pe/kit/lang/tooltip";
/** Transcript and composer presentation; conversation.css owns the look. */
import { type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Textarea } from "@pe/kit/lang/input";
import { ButtonOutcome } from "@pe/kit/lang/button";
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
    <div className="dl-message-bubble" data-surface="document">
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

/** Draft and controls; Enter sends unless an open menu owns the key. */
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
  dragging?: boolean;
  drop?: ComponentProps<"div">;
  menus?: ReactNode;
  work?: ReactNode;
  /** Button owns the refusal overlay under Send. */
  refusal?: string | null;
  pickers?: ReactNode;
  attach?: ReactNode;
  fork?: ReactNode;
  tools?: ReactNode;
  send: ReactNode;
  onSend: () => void;
  onKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}) {
  return (
    <form className="relative w-full">
      {menus}
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
        {attach || pickers || tools ? (
          <div data-composer-lead="">
            {attach}
            {pickers}
            {tools}
          </div>
        ) : null}
        <div data-composer-cluster="">
          {fork}
          <div data-composer-send="" className="contents">
            <ButtonOutcome value={refusal ? { kind: "refused", label: refusal } : null}>
              {send}
            </ButtonOutcome>
          </div>
        </div>
      </div>
    </form>
  );
}
