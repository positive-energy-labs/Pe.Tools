import { Component, useCallback, useState, type ErrorInfo, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  DIAGRAM_TOOL_ID,
  diagramSpecSchema,
  toMermaid,
  toolTitle,
  type DiagramSpec,
} from "@pe/agent-contracts";
import { ChevronRight } from "lucide-react";
import { useCurrentThreadView } from "./thread-view";
import {
  readRecord,
  formatBytes,
  toolImages,
  toolOutputForDisplay,
  type Approval,
  type ChatMessage,
  type ChatPart,
  type ToolCall,
} from "./chat-state";
import { Markdown } from "./prose";
import { Code, stringify } from "#/components/lang/code";
import { actionCall, proposedRecord } from "./chat-plugins";
import { ActionLine, ProposedLine } from "./record-lines";
import { Press } from "#/components/lang/press";
import { annotation } from "#/components/anatomy";
import { PressContent } from "#/components/anatomy/press-content";
import { FactChip } from "#/components/lang/chip";
import { Thumbnail } from "./thumbnail";
import { useCopy } from "#/lib/use-copy";
import { deferredResultSummary, useDeferredToolResult } from "./deferred-result";

type RegisterMoment = (id: string, el: HTMLElement | null) => void;

/** The transcript: one section per message, drawn from the same array the lens measures. */
export function Moments({
  messages,
  register,
}: {
  messages: ChatMessage[];
  register: RegisterMoment;
}) {
  let turn = 0;
  return messages.map((message, index) => {
    if (message.role === "user") turn += 1;
    // A moment directly under one of the same role draws no role line: a run of pea turns reads
    // as one block, not N banners.
    const continues = messages[index - 1]?.role === message.role;
    const head = continues ? null : <MomentHead message={message} turn={Math.max(1, turn)} />;
    return (
      <MomentSection key={message.id} message={message} register={register}>
        {message.role === "user" ? (
          <UserMoment message={message} head={head} />
        ) : (
          <AssistantMoment message={message} head={head} />
        )}
      </MomentSection>
    );
  });
}

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
      aria-label={`${role === "user" ? "User" : "Assistant"} message`}
      data-key={id}
      data-role={role}
      {...annotation("moment")}
      ref={setRef}
      className="group/moment relative"
    >
      {/* Out of flow, in the gap under the message (pea's at the left, yours at the right), so it
          never adds height; shown on hover or keyboard focus. */}
      {markdown ? (
        <span
          data-copy-anchor=""
          className={`absolute top-full z-raised ${role === "user" ? "right-0" : "left-[10px]"}`}
          data-surface="page"
        >
          <span className="sr-only group-hover/moment:not-sr-only focus-within:not-sr-only">
            <CopyMessage markdown={markdown} />
          </span>
        </span>
      ) : null}
      {children}
    </section>
  );
}

function CopyMessage({ markdown }: { markdown: string }) {
  const { copied, copy } = useCopy();
  return (
    <Press
      type="button"
      tone="quiet"
      size="label"
      title="Copy this message as markdown"
      onClick={() => copy(markdown)}
    >
      {copied ? "copied" : "copy"}
    </Press>
  );
}

function MomentHead({ message, turn }: { message: ChatMessage; turn: number }) {
  const at = message.createdAt;
  return (
    <div className="mb-1 flex items-center gap-2">
      <Press
        type="button"
        tone="nav"
        size="label"
        title={`Center turn ${turn} on the focal axis`}
        onClick={() => window.dispatchEvent(new CustomEvent("pe:focus-turn", { detail: turn }))}
      >
        #{turn}
      </Press>
      {message.role === "user" ? (
        <span className="t-small t-upper text-ink-2">you</span>
      ) : (
        <span className="t-small t-upper text-ink">pea</span>
      )}
      {at ? (
        <span className="ml-auto t-small face-mono tracking-[0.02em] text-ink-2">
          {at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      ) : null}
    </div>
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
  return (
    <>
      {head}
      <div className="ml-auto flex w-fit max-w-[76%] flex-col items-end gap-1.5">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap items-end justify-end gap-1.5">
            {attachments.map((part, index) => (
              <Attachment key={index} part={part} />
            ))}
          </div>
        ) : null}

        {text ? (
          <div className="boundary-l px-3 py-1.5 t-prose text-ink" data-surface="recess">
            {text}
          </div>
        ) : null}
      </div>
    </>
  );
}

function AssistantMoment({ message, head }: { message: ChatMessage; head: ReactNode }) {
  const { parts, running } = message;
  // A turn that is nothing but tool calls is machinery, not speech: it folds behind one summary
  // row so an uninterrupted run of calls costs one line of the transcript instead of N.
  const titles = parts.flatMap((part) =>
    part.type === "tool-call" ? [toolTitle(part.call.title)] : [],
  );
  const toolOnly = titles.length === parts.length;
  const body = (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <PartsBoundary>
        {parts.map((part, index) => (
          <Part key={part.type === "tool-call" ? part.call.id : index} part={part} />
        ))}
      </PartsBoundary>

      {running ? <span {...annotation("streaming-caret")} aria-hidden="true" /> : null}
    </div>
  );
  return (
    <>
      {head}
      {toolOnly && titles.length > 1 && !running ? (
        <details {...annotation("tool-run")}>
          <summary>
            <span className="face-mono">⌗ {titles.length} calls</span>
            <span className="truncate text-ink-2">{titles.join(" · ")}</span>
          </summary>
          {body}
        </details>
      ) : (
        body
      )}
    </>
  );
}

function Part({ part }: { part: ChatPart }): ReactNode {
  switch (part.type) {
    case "text":
      return <Markdown text={part.text} />;
    case "reasoning":
      return <ReasoningPart text={part.text} />;
    case "image":
    case "file":
      return <Attachment part={part} />;
    case "tool-call":
      return <ToolCallPart call={part.call} approval={part.approval} />;
  }
}

type AttachmentPart = Extract<ChatPart, { type: "image" | "file" }>;

/** A sent file: an image is a thumbnail that opens full size; anything else is a name chip. */
function Attachment({ part }: { part: AttachmentPart }) {
  if (part.type === "file")
    return (
      <FactChip title={`${part.name} (${part.mimeType}), sent with this message`}>
        <span>{part.name}</span> <span className="text-ink-2">{part.mimeType}</span>
      </FactChip>
    );
  return <Thumbnail src={part.image} name={part.name ?? "attachment"} />;
}

class PartsBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[workbench] message-part render failed", error, info.componentStack);
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
      <Press
        type="button"
        tone="quiet"
        size="caption"
        title="Pea's chain of thought for this turn — collapsed so the spine stays calm"
        onClick={() => setOpen((value) => !value)}
      >
        <PressContent geometry="baseline">
          <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          <span>Thought process</span>
        </PressContent>
      </Press>
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

function ToolCallPart({ call, approval }: { call: ToolCall; approval?: Approval }) {
  const view = useCurrentThreadView();
  const pinKey = useAtomValue(view.atoms.lensPinKey);
  // One gesture, two lanes: clicking a marker opens its I/O here AND pins it in the trace lane's
  // inspect window, so the inspection survives the pointer leaving and the transcript scrolling.
  const key = `tool:${call.id}`;
  const open = pinKey === key;
  const deferred = useDeferredToolResult(call, open);
  const running = call.status === "in_progress";
  const diagram = succeededDiagram(call);
  const failed = call.status === "failed";
  // ponytail: no cause word; `ExpiredAsk` does not carry one and the ruling forbids inventing it.
  const expired = call.status === "expired";
  // The runtime's cancel record rides the same record path: a word, no tag, nothing to press.
  const cancelled = call.status === "cancelled";
  const record = expired ? " — expired, unanswered" : cancelled ? " — cancelled" : null;
  const tone = failed ? "failed" : running ? "active" : "";
  const result = failed ? (call.result ?? call.error) : deferred.result;
  const images = deferred.ref ? toolImages(result) : call.images;
  // What the run actually touched: the Scope revision it was admitted under and the session and
  // document the host resolved to. Read from the result, so it is evidence, not intent.
  const ran = readRecord(result);
  const ranTarget = readRecord(ran?.target);
  const revision = typeof ran?.revision === "number" ? ran.revision : undefined;
  const proposed = proposedRecord(call.title, call.args, result);
  const action = proposed ? null : actionCall(call.title, call.args, result);
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-tool-id={call.id}>
      <div
        {...annotation("tool-marker")}
        data-kind="tool"
        data-open={open ? "" : undefined}
        role="button"
        tabIndex={0}
        title={
          open
            ? "Close this call (unpins the trace lane)"
            : "Open this call's input and output, and pin it in the trace lane"
        }
        onClick={() => view.actions.setLensPinKey(open ? null : key)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            view.actions.setLensPinKey(open ? null : key);
          }
        }}
        className={tone}
      >
        <span>⌗ {toolTitle(call.title)}</span>
        {record ? <span className="t-small text-ink-2">{record}</span> : null}
        {call.target ? <code>{call.target}</code> : null}
        {revision !== undefined ? (
          <span className="t-small face-mono text-ink-2" data-testid="tool-revision">
            r{revision}
          </span>
        ) : null}
        {ranTarget && (ranTarget.session || ranTarget.document) ? (
          <span className="t-small text-ink-2 truncate" data-testid="tool-target">
            {[ranTarget.session, ranTarget.document].filter(Boolean).join(" · ")}
          </span>
        ) : null}

        {record ? null : (
          <span
            className={`ml-auto t-small face-mono tracking-[0.02em] ${running ? "text-ink-2" : ""}`}
            data-tone={failed ? "caution" : running ? undefined : "done"}
          >
            {failed ? "err" : approval ? "wait" : running ? "run" : "ok"}
          </span>
        )}
      </div>
      {deferred.ref ? (
        <span className="t-small text-ink-2" data-testid="deferred-result-summary">
          {deferredResultSummary(deferred.ref.summary)} · {formatBytes(deferred.ref.byteSize)}
        </span>
      ) : null}
      {/* A diagram call draws its own args once the host accepted them (agent ledger). */}
      {diagram ? (
        <Code code={toMermaid(diagram)} lang="mermaid" title={diagram.title ?? "diagram"} />
      ) : null}
      {/* What the call captured, visible without opening it and while it still runs. */}
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {images.map((src, index) => (
            <Thumbnail key={index} src={src} name={`${toolTitle(call.title)} image ${index + 1}`} />
          ))}
        </div>
      ) : null}
      {open ? (
        <div {...annotation("tool-body")}>
          <Code code={stringify(call.args)} lang="json" title="in" />
          {deferred.pending ? (
            <div className="t-prose text-ink-2">Loading full result…</div>
          ) : deferred.error ? (
            <div className="flex items-baseline gap-2 t-prose" data-tone="caution">
              <span>{deferred.error.message}</span>
              <Press type="button" tone="quiet" size="caption" onClick={deferred.retry}>
                retry
              </Press>
            </div>
          ) : result === undefined ? null : failed ? (
            <Code
              code={stringify(toolOutputForDisplay(result))}
              lang="json"
              title="out"
              tone="error"
              wrap
            />
          ) : (
            <Code code={stringify(toolOutputForDisplay(result))} lang="json" title="out" />
          )}
        </div>
      ) : null}
      {proposed ? <ProposedLine record={proposed} /> : null}
      {action ? <ActionLine call={action} /> : null}
      {/* A live ask answers in the Chat head (`chat/composer-head.tsx`), never here: the
          transcript holds its record (F-J1-9). */}
    </div>
  );
}
