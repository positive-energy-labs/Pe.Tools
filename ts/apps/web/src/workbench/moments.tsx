import { EndpointError } from "./endpoint-error";
import { Component, memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  DIAGRAM_TOOL_ID,
  diagramSpecSchema,
  toMermaid,
  toolTitle,
  type DiagramSpec,
} from "@pe/agent-contracts";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  Wrench,
} from "lucide-react";
import { useCurrentThreadView } from "./thread-view";
import {
  readRecord,
  skillInvocation,
  toolDetail,
  toolOutputForDisplay,
  type Approval,
  type ChatMessage,
  type ChatPart,
  type ToolCall,
  formatBytes,
} from "@pe/agent-contracts/chat-state";
import { Markdown } from "./prose";
import { Code, stringify } from "@pe/kit/lang/code";
import { actionCall, proposedRecord } from "./chat-plugins";
import { ActionLine, ProposedLine } from "./record-lines";
import { Button } from "@pe/kit/lang/button";
import { annotation } from "#/components/anatomy";
import { PressContent } from "@pe/kit/anatomy/press-content";
import { FactChip, FileChip, MentionChip } from "@pe/kit/lang/chip";
import { mentionWord } from "#/chat/use-mentions";
import { isPdf, openPdf } from "./open-pdf";
import { Thumbnail } from "./thumbnail";
import { useCopy } from "@pe/kit/lib/use-copy";
import { startFeedback } from "#/components/feedback-picker";
import { reportFault } from "#/host/diagnostics";
import {
  transcriptSegments,
  type CallPart,
  type RunPart,
  type Segment,
} from "./conversation-sequences";
import {
  ConversationBody,
  MessageBubble,
  MessageHead,
  ToolStatus,
} from "#/components/lang/conversation";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { NativeReadingReferences } from "#/revit/reading-references";

type RegisterMoment = (id: string, el: HTMLElement | null) => void;

/** What a call shows without being opened: its captures, its drawing, its proposal or action
 *  record. Folding hides machinery, never these. */
function callRecords(call: ToolCall) {
  const result = call.status === "failed" ? (call.result ?? call.error) : call.result;
  const proposed = proposedRecord(call.title, call.args, result);
  return {
    result,
    proposed,
    action: proposed ? null : actionCall(call.title, call.args, result),
    diagram: succeededDiagram(call),
  };
}

/**
 * What a part shows, as a cheap string. Every state change refolds the event log into fresh
 * message objects, so identity cannot tell a moment changed. A settled call is final; only a
 * call still moving pays for a stringify of its args and result.
 */
function partKey(part: ChatPart): string {
  switch (part.type) {
    case "text":
    case "reasoning":
      return `${part.type[0]}${part.text.length}`;
    case "image":
      return `i${part.image.length}:${part.name ?? ""}`;
    case "file":
      return `f${part.name}:${part.size}`;
    case "tool-call": {
      const { call, approval } = part;
      const moving = call.status === "in_progress";
      return [
        "c",
        call.id,
        call.status,
        call.title,
        call.caption ?? "",
        call.target ?? "",
        call.images.length,
        approval?.requestId ?? "",
        moving ? JSON.stringify(call.args)?.length : "",
        moving ? JSON.stringify(call.result)?.length : "",
        call.status === "failed" ? String(call.error).length : "",
      ].join("|");
    }
  }
}

/** Everything one section draws that its own message does not hold: the head it wears. */
interface MomentProps {
  message: ChatMessage;
  segments: Segment[];
  continues: boolean;
  turn: number;
  harness: string;
  register: RegisterMoment;
  /** Equal keys draw equal pixels: the memo boundary compares this, not object identity. */
  contentKey: string;
}

function contentKey(
  message: ChatMessage,
  segments: Segment[],
  continues: boolean,
  turn: number,
  harness: string,
): string {
  // An assistant row draws its segments, which carry runs continued from later messages.
  const parts =
    message.role === "assistant"
      ? segments.flatMap((segment) =>
          "run" in segment
            ? segment.run.map(partKey)
            : [`${segment.index}:${partKey(segment.part)}`],
        )
      : message.parts.map(partKey);
  return [
    message.role,
    message.running,
    message.createdAt?.getTime() ?? "",
    message.target ?? "",
    message.mentions?.map((mention) => mention.key).join(",") ?? "",
    message.failure?.message ?? "",
    continues,
    message.role === "user" ? turn : "",
    harness,
    parts.join(";"),
  ].join("#");
}

/** The transcript: one memoized section per message, drawn from the same array the lens measures.
 *  A moment re-renders only when its own content key changes. */
export const Moments = memo(function Moments({
  messages,
  register,
  harness,
}: {
  messages: ChatMessage[];
  register: RegisterMoment;
  /** The thread's harness: one thread is one ACP session on one harness, so it answered every Pea turn. */
  harness: string;
}) {
  const groups = transcriptSegments(messages);
  let turn = 0;
  return messages.flatMap((message, index) => {
    if (message.role === "user") turn += 1;
    const segments = message.role === "system" ? [] : groups.get(message.id)!;
    // Calls continued from the previous message already belong to that sequence's section.
    if (message.role === "assistant" && segments.length === 0) return [];
    // A moment directly under one of the same role draws no role line: a run of pea turns reads
    // as one block, not N banners.
    const continues = messages[index - 1]?.role === message.role;
    const shownTurn = Math.max(1, turn);
    return [
      <Moment
        key={message.id}
        message={message}
        segments={segments}
        continues={continues}
        turn={shownTurn}
        harness={harness}
        register={register}
        contentKey={contentKey(message, segments, continues, shownTurn, harness)}
      />,
    ];
  });
});

const Moment = memo(
  function Moment({ message, segments, continues, turn, harness, register }: MomentProps) {
    // A host line (the harness session restarted): one quiet sentence, no head, no copy.
    if (message.role === "system")
      return (
        <MomentSection message={message} register={register}>
          {message.failure ? (
            <EndpointError message={message.failure.message} failure={message.failure} />
          ) : (
            <p className="t-small text-ink-2">
              {message.parts.map((part) => (part.type === "text" ? part.text : "")).join(" ")}
            </p>
          )}
        </MomentSection>
      );
    const head = continues ? null : (
      <MessageHead
        role={message.role}
        harness={harness}
        turn={message.role === "user" ? turn : undefined}
        target={message.target}
      />
    );
    return (
      <MomentSection message={message} register={register}>
        {message.role === "user" ? (
          <UserMoment message={message} head={head} />
        ) : (
          <AssistantMoment message={message} head={head} segments={segments} />
        )}
      </MomentSection>
    );
  },
  (prev, next) => prev.contentKey === next.contentKey && prev.register === next.register,
);

function MomentSection({
  message,
  register,
  children,
}: {
  message: ChatMessage;
  register: RegisterMoment;
  children: ReactNode;
}) {
  const { id, role } = message;
  const setRef = useCallback((el: HTMLElement | null) => register(id, el), [register, id]);
  const markdown = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
  return (
    <section
      aria-label={`${role === "user" ? "User" : role === "system" ? "Host" : "Assistant"} message`}
      data-key={id}
      data-role={role}
      {...annotation("moment")}
      ref={setRef}
      className="group/moment relative"
    >
      {children}
      {role !== "system" &&
      message.parts.some((part) => part.type !== "tool-call" && part.type !== "reasoning") ? (
        <div className="dl-message-controls" data-role={role}>
          {message.createdAt ? (
            <time className="dl-message-meta" dateTime={message.createdAt.toISOString()}>
              {message.createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </time>
          ) : null}
          {markdown ? <CopyMessage markdown={markdown} /> : null}
          <Button
            label="Feedback about this message"
            reason="Send feedback about this message"
            icon={<MessageSquarePlus size={13} />}
            onClick={(event) => startFeedback(event.currentTarget.closest("section") ?? undefined)}
          />
        </div>
      ) : null}
    </section>
  );
}

function CopyMessage({ markdown }: { markdown: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button
      label={copied ? "Message copied" : "Copy message"}
      reason="Copy this message as markdown"
      icon={copied ? <Check size={13} /> : <Copy size={13} />}
      onClick={() => copy(markdown)}
    />
  );
}

function UserMoment({ message, head }: { message: ChatMessage; head: ReactNode }) {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
  const attachments = message.parts.flatMap((part) =>
    part.type === "image" || part.type === "file" ? [part] : [],
  );
  const skill = skillInvocation(text);
  return (
    <ConversationBody role="user">
      {head}
      <div className="ml-auto flex w-fit max-w-[76%] flex-col items-end gap-1.5">
        {attachments.length > 0 || message.mentions ? (
          <div className="flex flex-wrap items-end justify-end gap-1.5">
            {/* What Pea received with the turn; the `@Title` tokens in the text stay plain. */}
            {message.mentions?.map((mention) => (
              <MentionChip
                key={mention.key}
                label={mention.title}
                kind={mentionWord(mention.kind)}
                pointer={mention.key}
                facts={mention.facts}
                takenAt={mention.takenAt}
              />
            ))}
            {attachments.map((part, index) => (
              <Attachment key={index} part={part} />
            ))}
          </div>
        ) : null}

        {text ? (
          <MessageBubble>
            {skill ? (
              <span className="inline-flex flex-wrap items-baseline gap-1.5">
                <FactChip title={`Ran the ${skill.name} skill`}>/{skill.name}</FactChip>
                {skill.args ? <span>{skill.args}</span> : null}
              </span>
            ) : (
              text
            )}
          </MessageBubble>
        ) : null}
      </div>
    </ConversationBody>
  );
}

function AssistantMoment({
  message,
  head,
  segments,
}: {
  message: ChatMessage;
  head: ReactNode;
  segments: Segment[];
}) {
  const { running } = message;
  return (
    <ConversationBody role="assistant">
      {head}
      {/* `data-blocks`: the lens measures this column's children as the turn's rendered blocks (a
          collapsed tool run is one), so the rail's notches draw what the transcript draws. */}
      <div className="flex min-w-0 flex-col gap-2" data-blocks="">
        <PartsBoundary>
          {segments.map((segment) =>
            "run" in segment ? (
              <ToolGroup key={segment.key} run={segment.run} />
            ) : (
              <Part key={segment.index} part={segment.part} />
            ),
          )}
        </PartsBoundary>
        {running && segments.some((segment) => "part" in segment) ? (
          <span {...annotation("streaming-caret")} aria-hidden="true" />
        ) : null}
      </div>
    </ConversationBody>
  );
}

/** The run in order: a call is a marker, a thought a quiet disclosure. */
function RunStack({ run }: { run: RunPart[] }) {
  return (
    <div className="flex min-w-0 flex-col">
      {run.map((part, index) =>
        part.type === "reasoning" ? (
          <ReasoningPart key={index} text={part.text} />
        ) : (
          <ToolCallPart
            key={part.call.id}
            call={part.call}
            approval={part.approval}
            recordsOnly={false}
          />
        ),
      )}
    </div>
  );
}

/** What folding never hides: a call's records. Draws nothing when no call has one. */
function RecordsStack({ parts }: { parts: CallPart[] }) {
  const shown = parts.filter((part) => {
    const { proposed, action, diagram } = callRecords(part.call);
    return part.approval || proposed || action || diagram || part.call.images.length > 0;
  });
  if (shown.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col" data-tool-records="">
      {shown.map((part) => (
        <ToolCallPart key={part.call.id} call={part.call} approval={part.approval} recordsOnly />
      ))}
    </div>
  );
}

/**
 * Fold machinery (calls and the thoughts between them), never the records it produced. An opened
 * call opens its containing run. A run with no call yet is just its thoughts.
 */
function ToolGroup({ run }: { run: RunPart[] }) {
  const view = useCurrentThreadView();
  const openKey = useAtomValue(view.atoms.openCallKey);
  const parts = run.filter((part): part is CallPart => part.type === "tool-call");
  const holdsOpenCall = parts.some((part) => openKey === `tool:${part.call.id}`);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (holdsOpenCall) setOpen(true);
  }, [holdsOpenCall]);
  if (parts.length === 0) return <RunStack run={run} />;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <ToolRunFold
        calls={parts.map((part) => part.call)}
        thoughts={run.length - parts.length}
        open={open}
        onToggle={setOpen}
      >
        <RunStack run={run} />
      </ToolRunFold>
      <RecordsStack parts={parts} />
    </div>
  );
}

/** Latest activity stays readable while the sequence grows; failures never disappear in a count. */
function ToolRunFold({
  calls,
  thoughts,
  open,
  onToggle,
  children,
}: {
  calls: ToolCall[];
  thoughts: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  const failed = calls.filter((call) => call.status === "failed").length;
  const working = calls.some((call) => call.status === "in_progress");
  const latest = calls.at(-1)!;
  const latestId = useRef(latest.id);
  const [newCall, setNewCall] = useState(false);
  useEffect(() => {
    if (latestId.current === latest.id) return;
    latestId.current = latest.id;
    setNewCall(true);
    const timer = setTimeout(() => setNewCall(false), 1400);
    return () => clearTimeout(timer);
  }, [latest.id]);
  const Glyph = working ? LoaderCircle : failed ? CircleAlert : Wrench;
  const summary = toolDetail(latest)?.text ?? toolTitle(latest.title);
  return (
    <details
      {...annotation("tool-run")}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) onToggle(event.currentTarget.open);
      }}
    >
      <summary className="dl-tool-run-summary" data-new-call={newCall ? "" : undefined}>
        <Glyph
          size={13}
          data-tone={failed ? "alarm" : undefined}
          aria-hidden="true"
          className={working ? "animate-spin" : undefined}
        />
        <span className="face-mono">
          {calls.length} {calls.length === 1 ? "tool" : "tools"}
          {thoughts > 0 ? ` · ${thoughts} ${thoughts === 1 ? "thought" : "thoughts"}` : ""}
        </span>
        <TooltipHint content={summary}>
          <span className="dl-tool-run-latest">{summary}</span>
        </TooltipHint>
        {failed > 0 ? <span data-tone="alarm">{failed} failed</span> : null}
        {working ? <span className="sr-only">Running</span> : null}
      </summary>
      {children}
    </details>
  );
}

function Part({ part }: { part: Exclude<ChatPart, CallPart> }): ReactNode {
  switch (part.type) {
    case "text":
      // TODO(route thread: host/readings): element mentions need a names(doc, ids) read. Then render
      // through subjectDocument against the row's pinned `targets`; an id only one target names links.
      return <Markdown text={part.text} />;
    case "image":
    case "file":
      return <Attachment part={part} />;
  }
}

type AttachmentPart = Extract<ChatPart, { type: "image" | "file" }>;

/** A sent file: an image is a thumbnail that opens full size; a file is a name and size chip, a PDF's name opens it. */
function Attachment({ part }: { part: AttachmentPart }) {
  if (part.type === "file") {
    const { name, mimeType, data, size } = part;
    return (
      <FileChip
        name={name}
        meta={formatBytes(size)}
        title={`${name} (${mimeType}), sent with this message`}
        open={isPdf(mimeType, data) ? () => openPdf(data) : undefined}
      />
    );
  }
  return <Thumbnail src={part.image} name={part.name ?? "attachment"} />;
}

class PartsBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: unknown) {
    reportFault({ code: "parts.failed" }, error);
  }
  render(): ReactNode {
    if (this.state.error)
      return (
        <div className="t-prose" data-tone="caution">
          {this.state.error}
        </div>
      );
    return this.props.children;
  }
}

function ReasoningPart({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hairline-l-faint pl-2">
      <Button
        label="Thought process"
        reason="Pea's chain of thought for this turn — collapsed so the spine stays calm"
        onClick={() => setOpen((value) => !value)}
      >
        <PressContent geometry="baseline">
          <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          <span>Thought process</span>
        </PressContent>
      </Button>
      {open ? (
        <div className="mt-1 mb-0.5 px-2 t-prose text-ink-2 whitespace-pre-wrap">{text}</div>
      ) : null}
    </div>
  );
}

/** The spec a succeeded `diagram` call drew, or undefined for any other call. */
function succeededDiagram(call: ToolCall): DiagramSpec | undefined {
  if (call.title !== DIAGRAM_TOOL_ID || call.status !== "completed") return undefined;
  if (readRecord(call.result)?.ok !== true) return undefined;
  const spec = diagramSpecSchema.safeParse(call.args);
  return spec.success ? spec.data : undefined;
}

const OPEN_TIP = "open this call's input and output";
const CLOSE_TIP = "close this call";

function ToolCallPart({
  call,
  approval,
  recordsOnly,
}: {
  call: ToolCall;
  approval?: Approval;
  recordsOnly: boolean;
}) {
  const view = useCurrentThreadView();
  const openKey = useAtomValue(view.atoms.openCallKey);
  // One call is open at a time: clicking a marker opens its I/O in place, and opening another
  // closes it.
  const key = `tool:${call.id}`;
  const open = openKey === key;
  const running = call.status === "in_progress";
  const failed = call.status === "failed";
  // Only a host restart expires an ask (`permission_resolved by:"expired"`).
  const expired = call.status === "expired";
  // The runtime's cancel record rides the same record path: a word, no tag, nothing to press.
  const cancelled = call.status === "cancelled";
  const record = expired
    ? " — expired, unanswered; the host restarted"
    : cancelled
      ? " — cancelled"
      : null;
  const denied = call.status === "denied";
  const title = toolTitle(call.title);
  const detail = toolDetail(call);
  const tone = failed ? "failed" : running && !approval ? "active" : "";
  const { result, proposed, action, diagram } = callRecords(call);
  const images = call.images;
  // What the run actually touched: the Scope revision it was admitted under and the session and
  // document the host resolved to. Read from the result, so it is evidence, not intent.
  const ran = readRecord(result);
  const ranTarget = readRecord(ran?.target);
  const revision = typeof ran?.revision === "number" ? ran.revision : undefined;
  return (
    // An opened call is one object: its row is the head and its I/O the body, inside one artifact edge.
    <div
      className="flex min-w-0 flex-col gap-0.5"
      data-tool-id={recordsOnly ? undefined : call.id}
      data-surface={!recordsOnly && open ? "artifact" : undefined}
    >
      {(recordsOnly ? approval : !approval) ? (
        <TooltipHint content={`${call.title} · ${open ? CLOSE_TIP : OPEN_TIP}`}>
          <div
            {...annotation("tool-marker")}
            data-kind="tool"
            data-open={open ? "" : undefined}
            role="button"
            tabIndex={0}
            onClick={() => view.actions.setOpenCallKey(open ? null : key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                view.actions.setOpenCallKey(open ? null : key);
              }
            }}
            className={tone}
          >
            <span>⌗ {title}</span>
            {detail?.emitted ? (
              <code>{detail.text}</code>
            ) : detail ? (
              <span>{detail.text}</span>
            ) : null}
            {record ? <span>{record}</span> : null}
            {revision !== undefined ? (
              <span className="face-mono" data-testid="tool-revision">
                r{revision}
              </span>
            ) : null}
            {ranTarget && (ranTarget.session || ranTarget.document) ? (
              <span data-testid="tool-target">
                {[ranTarget.session, ranTarget.document].filter(Boolean).join(" · ")}
              </span>
            ) : null}

            {record ? null : (
              <ToolStatus
                state={
                  failed
                    ? "failed"
                    : denied
                      ? "denied"
                      : approval
                        ? "waiting"
                        : running
                          ? "working"
                          : "done"
                }
              />
            )}
          </div>
        </TooltipHint>
      ) : null}
      {/* A diagram call draws its own args once the host accepted them (agent ledger). */}
      {recordsOnly && diagram ? (
        <Code code={toMermaid(diagram)} lang="mermaid" title={diagram.title ?? "diagram"} />
      ) : null}
      {/* What the call captured, visible without opening it and while it still runs. */}
      {recordsOnly && images.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {images.map((src, index) => (
            <Thumbnail
              key={index}
              src={src}
              name={
                call.target
                  ? (call.target.split(/[\\/]/).at(-1) ?? call.target)
                  : `${toolTitle(call.title)} image ${index + 1}`
              }
            />
          ))}
        </div>
      ) : null}
      {!recordsOnly && open ? (
        <div {...annotation("tool-body")}>
          {call.status === "completed" ? <NativeReadingReferences result={result} /> : null}
          <Code code={stringify(call.args)} lang="json" title="in" copyLabel="Copy input" />
          {result === undefined ? null : failed ? (
            <Code
              code={stringify(toolOutputForDisplay(result))}
              lang="json"
              title="out"
              copyLabel="Copy output"
              tone="alarm"
              wrap
            />
          ) : (
            <Code
              code={stringify(toolOutputForDisplay(result))}
              lang="json"
              title="out"
              copyLabel="Copy output"
            />
          )}
        </div>
      ) : null}
      {recordsOnly && proposed ? <ProposedLine record={proposed} /> : null}
      {recordsOnly && action ? <ActionLine call={action} /> : null}
      {/* A live ask answers in the Chat head (`chat/composer-head.tsx`), never here: the
          transcript holds its record (F-J1-9). */}
    </div>
  );
}
