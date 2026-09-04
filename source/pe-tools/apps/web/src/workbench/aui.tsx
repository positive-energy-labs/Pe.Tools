import {
  Component,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useMessage,
  type ReasoningMessagePartComponent,
  type TextMessagePartComponent,
  type ThreadMessageLike,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { toolTitle } from "@pe/agent-contracts";
import { Check, ChevronRight, X } from "lucide-react";
import { Textarea } from "#/components/lang/textarea";
import { Verb } from "#/components/lang/verb";
import { useWorkbench } from "./provider";
import { isRenderable, toThreadMessages } from "./aui-adapter";
import { APPROVAL_OPTIONS, readRecord, readString, toolTarget } from "./chat-state";
import { PROSE_CLASS } from "./prose";
import { RouteChatPluginView } from "./route-chat-plugins";
import { Press } from "#/components/lang/press";
import { annotation } from "#/components/anatomy";
import { PressContent } from "#/components/anatomy/press-content";

const ThreadMessagesContext = createContext<ThreadMessageLike[]>([]);

export function useThreadMessages(): ThreadMessageLike[] {
  return useContext(ThreadMessagesContext);
}

export function WorkbenchRuntimeProvider({ children }: { children: ReactNode }) {
  const { chat, isRunning, sendPrompt, cancel } = useWorkbench();
  const messages = useMemo(() => toThreadMessages(chat), [chat]);
  const visible = useMemo(() => messages.filter(isRenderable), [messages]);

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    isRunning,
    onNew: async (message) => {
      const text = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      if (text) await sendPrompt(text);
    },
    onCancel: async () => cancel(),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadMessagesContext.Provider value={visible}>{children}</ThreadMessagesContext.Provider>
    </AssistantRuntimeProvider>
  );
}

type RegisterMoment = (id: string, el: HTMLElement | null) => void;
const MomentRegistry = createContext<RegisterMoment>(() => {});

export function Moments({ register }: { register: RegisterMoment }) {
  return (
    <MomentRegistry.Provider value={register}>
      <ThreadPrimitive.Messages
        components={{ UserMessage: UserMoment, AssistantMessage: AssistantMoment }}
      />
    </MomentRegistry.Provider>
  );
}

function MomentSection({
  id,
  role,
  children,
}: {
  id: string;
  role: "user" | "assistant";
  children: ReactNode;
}) {
  const register = useContext(MomentRegistry);
  const setRef = useCallback((el: HTMLElement | null) => register(id, el), [register, id]);
  return (
    <section
      aria-label={`${role === "user" ? "User" : "Assistant"} message`}
      data-key={id}
      data-role={role}
      {...annotation("moment")}
      ref={setRef}
    >
      {children}
    </section>
  );
}

function TurnTag({ id }: { id: string }) {
  const messages = useThreadMessages();
  let turn = 0;
  let found = false;
  for (const message of messages) {
    if (message.role === "user") turn += 1;
    if (message.id === id) {
      found = true;
      break;
    }
  }
  if (!found) return null;
  turn = Math.max(1, turn);
  return (
    <Press
      type="button"
      tone="nav"
      size="label"
      title={`Center turn ${turn} on the focal axis`}
      onClick={() => window.dispatchEvent(new CustomEvent("pe:focus-turn", { detail: turn }))}
    >
      #{turn}
    </Press>
  );
}

function MomentTime() {
  const at = useMessage((message) =>
    message.createdAt instanceof Date ? message.createdAt.getTime() : undefined,
  );
  if (!at) return null;
  return (
    <span className="ml-auto t-small face-mono tracking-[0.02em] text-ink-2">
      {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function UserMoment() {
  const id = useMessage((message) => message.id);
  const text = useMessage((message) =>
    message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim(),
  );
  const imageBlob = useMessage((message) =>
    message.content
      .flatMap((part) =>
        part.type === "image" && typeof part.image === "string" ? [part.image] : [],
      )
      .join("|"),
  );
  const images = imageBlob ? imageBlob.split("|") : [];
  if (!text && images.length === 0) return null;
  return (
    <MomentSection id={id} role="user">
      <div className="mb-1 flex items-center gap-2">
        <TurnTag id={id} />
        <span className="t-small t-upper text-ink-2">you</span>
        <MomentTime />
      </div>
      <div className="ml-auto flex w-fit max-w-[76%] flex-col items-end gap-1.5">
        {images.map((src) => (
          <img
            key={src}
            src={src}
            alt="attachment"
            className="hairline-x-faint hairline-y-faint max-h-64 rounded-sm object-contain"
          />
        ))}

        {text ? (
          <div className="boundary-l px-3 py-1.5 t-prose text-ink" data-surface="recess">
            {text}
          </div>
        ) : null}
      </div>
    </MomentSection>
  );
}

function AssistantMoment() {
  const id = useMessage((message) => message.id);
  const running = useMessage((message) => message.status?.type === "running");
  const hasContent = useMessage((message) =>
    message.content.some(
      (part) =>
        (part.type === "text" && part.text.trim().length > 0) ||
        part.type === "image" ||
        part.type === "tool-call",
    ),
  );
  if (!hasContent && !running) return null;
  return (
    <MomentSection id={id} role="assistant">
      <div className="mb-1 flex items-center gap-2">
        <TurnTag id={id} />
        <span className="t-small t-upper text-ink">pea</span>
        <MomentTime />
      </div>
      <div className="grid gap-[3px]">
        <AssistantParts />

        {running ? <span {...annotation("streaming-caret")} aria-hidden="true" /> : null}
      </div>
    </MomentSection>
  );
}

function AssistantParts(): ReactNode {
  return (
    <PartsBoundary>
      <MessagePrimitive.Parts
        components={{
          Text: MarkdownText,
          Reasoning: ReasoningPart,
          tools: { Fallback: ToolCallPart },
        }}
      />
    </PartsBoundary>
  );
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

const MarkdownText: TextMessagePartComponent = () => (
  <MarkdownTextPrimitive className={PROSE_CLASS} />
);

const ReasoningPart: ReasoningMessagePartComponent = ({ text }) => {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
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
};

const ToolCallPart: ToolCallMessagePartComponent = ({
  toolCallId,
  toolName,
  args,
  isError,
  status,
  approval,
}) => {
  const { resolveApproval } = useWorkbench();
  const tone = isError ? "failed" : status?.type === "running" ? "active" : "";
  const target = toolTarget(args);
  const pending = approval && approval.approved === undefined && !approval.resolution;
  const question = pending && toolName === "ask_user" ? readQuestion(args) : undefined;
  return (
    <div className="grid gap-0.5" data-tool-id={toolCallId}>
      <div {...annotation("tool-marker")} data-kind="tool" className={tone}>
        <span>⌗ {toolTitle(toolName)}</span>
        {target ? <code>{target}</code> : null}

        <span
          className={`ml-auto t-small face-mono tracking-[0.02em] ${status?.type === "running" ? "text-ink-2" : ""}`}
          data-tone={isError ? "caution" : status?.type === "running" ? undefined : "done"}
        >
          {isError ? "err" : status?.type === "running" ? "run" : "ok"}
        </span>
      </div>
      <RouteChatPluginView
        toolCallId={toolCallId}
        toolName={toolName}
        args={args}
        sessionState={{}}
        running={status?.type === "running"}
      />
      {question ? (
        <AskUserPrompt toolCallId={toolCallId} question={question} resolve={resolveApproval} />
      ) : pending ? (
        <div className="flex flex-wrap gap-[7px]">
          {(approval.options ?? APPROVAL_OPTIONS).map((option) => {
            const allow = option.kind.startsWith("allow");
            return (
              <Verb
                key={option.id}
                tone={allow ? "commit" : "act"}
                icon={allow ? Check : X}
                label={option.label ?? option.id}
                reason={
                  allow
                    ? `Let pea run ${toolTitle(toolName)} — the call executes against the live target`
                    : `Refuse this ${toolTitle(toolName)} call — pea continues without it`
                }
                onClick={() => void resolveApproval(approval.id, option.id)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

type Question = {
  text: string;
  options: { label: string; description?: string }[];
  multiple: boolean;
};

function readQuestion(args: unknown): Question | undefined {
  const value = readRecord(args);
  if (value?.__peaApprovalKind !== "suspension") return undefined;
  const text = readString(value?.question);
  if (!text) return undefined;
  const options = Array.isArray(value?.options)
    ? value.options.flatMap((option) => {
        const record = readRecord(option);
        const label = readString(record?.label);
        return label
          ? [
              {
                label,
                ...(readString(record?.description)
                  ? { description: readString(record?.description) }
                  : {}),
              },
            ]
          : [];
      })
    : [];
  return { text, options, multiple: value?.selectionMode === "multi_select" };
}

function AskUserPrompt({
  toolCallId,
  question,
  resolve,
}: {
  toolCallId: string;
  question: Question;
  resolve: (toolCallId: string, response?: string | string[]) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="grid gap-2 py-1">
      <div className="t-prose">{question.text}</div>
      {question.options.length === 0 ? (
        <>
          <Textarea
            size="compact"
            aria-label="Answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div>
            <Verb
              tone="commit"
              icon={Check}
              label="Answer"
              reason="Send this answer to Pea"
              disabled={!answer.trim()}
              onClick={() => void resolve(toolCallId, answer.trim())}
            />
          </div>
        </>
      ) : question.multiple ? (
        <>
          <div className="grid gap-1">
            {question.options.map((option) => (
              <label key={option.label} className="flex items-start gap-2 t-prose">
                <input
                  type="checkbox"
                  checked={selected.includes(option.label)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(option.label)
                        ? current.filter((label) => label !== option.label)
                        : [...current, option.label],
                    )
                  }
                />
                <span>
                  {option.label}
                  {option.description ? (
                    <span className="block t-small text-ink-2">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <div>
            <Verb
              tone="commit"
              icon={Check}
              label="Answer"
              reason="Send the selected answers to Pea"
              disabled={selected.length === 0}
              onClick={() => void resolve(toolCallId, selected)}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-1">
          {question.options.map((option) => (
            <div key={option.label} className="flex items-baseline gap-2">
              <Verb
                tone="act"
                label={option.label}
                reason={option.description ?? `Answer ${option.label}`}
                onClick={() => void resolve(toolCallId, option.label)}
              />
              {option.description ? (
                <span className="t-small text-ink-2">{option.description}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
