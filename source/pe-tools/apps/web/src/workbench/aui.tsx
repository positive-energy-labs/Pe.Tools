import {
  Component,
  createContext,
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
import { Check, ChevronRight, GitFork, X } from "lucide-react";
import { useWorkbench } from "./provider";
import { workbenchToThreadMessages } from "./aui-adapter";

/**
 * assistant-ui mounted as a pure render-from view over WorkbenchState. The runtime
 * holds no state of its own — it renders `workbenchToThreadMessages(state)` and routes
 * its actions (send, cancel) back into the existing WorkbenchProvider. Approvals are
 * resolved through our proven `/workbench/approve` route directly from the tool part,
 * so we don't double-plumb assistant-ui's approval transport.
 *
 * `ThreadPrimitive.Messages` owns iteration (it's the consumer that binds the v0.14
 * message-store client), but each message renders inside a `.lens-moment` section WE own
 * (ref + data-key via `MomentRegistry`), so the Lens MapDial/wire/fisheye geometry keeps
 * measuring it exactly as before. The same projected `ThreadMessageLike[]` is exposed via
 * context for the MapDial bands — one array, aligned with the runtime's message order.
 */
const ThreadMessagesContext = createContext<ThreadMessageLike[]>([]);

export function useThreadMessages(): ThreadMessageLike[] {
  return useContext(ThreadMessagesContext);
}

export function WorkbenchRuntimeProvider({ children }: { children: ReactNode }) {
  const { debug, isRunning, sendPrompt, cancel } = useWorkbench();
  const messages = useMemo(() => workbenchToThreadMessages(debug.state), [debug.state]);

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
      <ThreadMessagesContext.Provider value={messages}>{children}</ThreadMessagesContext.Provider>
    </AssistantRuntimeProvider>
  );
}

/** Lens hands down a callback to register each rendered moment's DOM node by message id. */
type RegisterMoment = (id: string, el: HTMLElement | null) => void;
const MomentRegistry = createContext<RegisterMoment>(() => {});

/**
 * The assistant-ui-owned chat moments. Renders inside the Lens's `.lens-chat` (which is the
 * `ThreadPrimitive.Root`). Each message becomes a `.lens-moment` section registered with the
 * Lens so the scroll controller can measure it.
 */
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
  return (
    <section data-key={id} data-role={role} className="lens-moment" ref={(el) => register(id, el)}>
      {children}
    </section>
  );
}

function UserMoment() {
  const { forkThread } = useWorkbench();
  const id = useMessage((message) => message.id);
  const text = useMessage((message) =>
    message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim(),
  );
  return (
    <MomentSection id={id} role="user">
      <div className="mb-1.5 inline-flex items-center gap-[7px] text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--pe-green)]">
        <span>you</span>
        {/* lens-fork kept as CSS: visibility is driven by `.lens-moment:hover` (geometry element) */}
        <button
          className="lens-fork"
          type="button"
          title="Fork the conversation from this turn into a new thread"
          onClick={() => void forkThread(id)}
        >
          <GitFork size={12} />
        </button>
      </div>
      <div className="ml-auto w-fit max-w-[80%] rounded-[12px_12px_2px_12px] border-[0.5px] border-[var(--user-line)] bg-[var(--user-tint)] px-3 py-2 text-sm leading-normal">
        {text}
      </div>
    </MomentSection>
  );
}

function AssistantMoment() {
  const id = useMessage((message) => message.id);
  const running = useMessage((message) => message.status?.type === "running");
  return (
    <MomentSection id={id} role="assistant">
      <div className="mb-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--pe-blue)]">
        pea
      </div>
      <div className="grid gap-2">
        <AssistantParts />
        {/* mg-caret kept as CSS: it's a keyframes blink animation (the user asked to keep those) */}
        {running ? <span className="mg-caret" aria-hidden="true" /> : null}
      </div>
    </MomentSection>
  );
}

/** Render the assistant message's parts (text, reasoning, tools) through assistant-ui. */
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

/** One bad message part must not blank the whole transcript. */
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
      return <div className="text-[13px] text-[#b4524f]">{this.state.error}</div>;
    return this.props.children;
  }
}

/**
 * Assistant text → assistant-ui markdown. assistant-ui renders the markdown to HTML but doesn't
 * style it, so we use the Tailwind typography plugin (`prose`) tuned to the PE look: serif
 * headings, PE-blue links, and inline-code pills on paper-2 with the backtick pseudo-content
 * stripped. Replaces the hand-written prose descendant CSS.
 */
const PROSE_CLASS = [
  "prose prose-sm max-w-none leading-relaxed text-[var(--basalt)]",
  "prose-p:my-0 prose-p:mb-[0.6em] last:prose-p:mb-0",
  "prose-headings:font-[var(--font-display)] prose-headings:font-semibold prose-headings:text-[var(--basalt)]",
  "prose-a:text-[var(--pe-blue)] prose-a:underline prose-a:underline-offset-2",
  "prose-code:rounded prose-code:border-[0.5px] prose-code:border-[var(--line)] prose-code:bg-[var(--paper-2)] prose-code:px-[5px] prose-code:py-px prose-code:text-[12.5px] prose-code:font-normal",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:rounded-[7px] prose-pre:border-[0.5px] prose-pre:border-[var(--line)] prose-pre:bg-[var(--paper-2)] prose-pre:text-[var(--basalt)]",
].join(" ");
const MarkdownText: TextMessagePartComponent = () => (
  <MarkdownTextPrimitive className={PROSE_CLASS} />
);

/** Collapsible chain-of-thought (collapsed by default so the spine stays calm). */
const ReasoningPart: ReasoningMessagePartComponent = ({ text }) => {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="border-l-2 border-[var(--kiln)]">
      <button
        className="inline-flex items-center gap-[5px] bg-transparent px-1.5 py-px text-xs font-semibold text-[var(--lichen)] hover:text-[var(--clay-ink)]"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <span>Thought process</span>
      </button>
      {open ? (
        <div className="mt-1 mb-0.5 ml-2 border-l border-[var(--line-2)] pl-[9px] text-[13px] leading-[1.55] whitespace-pre-wrap text-[var(--lichen)]">
          {text}
        </div>
      ) : null}
    </div>
  );
};

const DEFAULT_APPROVAL_OPTIONS = [
  { id: "allow_once", kind: "allow-once", label: "Approve" },
  { id: "reject_once", kind: "reject-once", label: "Deny" },
];

/**
 * Inline tool marker (one line in the spine; full I/O lives in the trace lane). When the
 * call carries a pending approval gate, the HITL approve/deny buttons render here and
 * resolve through the WorkbenchProvider's `/workbench/approve` route.
 */
const ToolCallPart: ToolCallMessagePartComponent = ({
  toolCallId,
  toolName,
  args,
  result,
  isError,
  status,
  approval,
}) => {
  const { resolveApproval } = useWorkbench();
  const tone = isError ? "failed" : status?.type === "running" ? "active" : "";
  const target = toolTarget(args, result);
  const pending = approval && approval.approved === undefined && !approval.resolution;
  return (
    // data-tool-id lets the Lens anchor this tool's trace card to the marker's real chat
    // position, so the focal card tracks the tool actually at the focal axis.
    <div className="grid gap-1.5" data-tool-id={toolCallId}>
      {/* lens-marker kept as CSS: focal/hover emphasis is driven by `.lens-moment.focal` (geometry) */}
      <div className={`lens-marker tool ${tone}`}>
        <span>⌗ {toolName}</span>
        {target ? <code>{target}</code> : null}
      </div>
      {pending ? (
        <div className="flex flex-wrap gap-[7px]">
          {(approval.options ?? DEFAULT_APPROVAL_OPTIONS).map((option) => {
            const allow = option.kind.startsWith("allow");
            return (
              <button
                key={option.id}
                type="button"
                className={`inline-flex items-center gap-[5px] rounded-[7px] border-[0.5px] px-[11px] py-[5px] text-[12.5px] font-semibold transition-colors active:translate-y-[0.5px] ${
                  allow
                    ? "border-[var(--pe-blue)] bg-[var(--pe-blue)] text-white hover:bg-[var(--pe-blue-soft)]"
                    : "border-[var(--line-2)] bg-[var(--paper)] text-[var(--slate)] hover:border-[#d8a59f] hover:bg-[#fdf1ef] hover:text-[#8f3434]"
                }`}
                onClick={() => void resolveApproval(approval.id, option.id)}
              >
                {allow ? <Check size={13} /> : <X size={13} />}
                {option.label ?? option.id}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

function toolTarget(args: unknown, _result: unknown): string | undefined {
  if (isRecord(args)) {
    const candidate = args.path ?? args.file ?? args.query ?? args.command;
    if (typeof candidate === "string") return candidate;
  }
  if (typeof args === "string" && args.length <= 64) return args;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
