/** The transcript turn (head, body, bubble, tool status) and the composer (frame, box, bottom row).
 *  Presentation only; the logic lives in workbench/ and chat/. Painted in conversation.css. */
import type { ComponentProps, ReactNode } from "react";
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
/** The box's bottom row: pickers and state lead (wrapping first); fork, attach, cancel and send
 *  trail. Every control in it is a Button or a `control`-face picker. */
export function ComposerRow({ lead, trail }: { lead: ReactNode; trail: ReactNode }) {
  return (
    <div className="dl-composer-row">
      <div className="dl-composer-lead">{lead}</div>
      <div className="dl-composer-trail">{trail}</div>
    </div>
  );
}
/** The one object you write in: work it carries, the text, its controls. A file drag over it
 *  takes the recess ground. */
export function ComposerBox({
  dragging,
  children,
  ...props
}: Omit<ComponentProps<"div">, "className"> & { dragging?: boolean }) {
  return (
    <div
      className="dl-composer-box"
      data-surface={dragging ? "recess" : "artifact"}
      data-drop-zone=""
      {...props}
    >
      {children}
    </div>
  );
}
