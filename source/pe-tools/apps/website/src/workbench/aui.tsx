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
import { useWorkbench } from "./WorkbenchProvider.tsx";
import { workbenchToThreadMessages } from "./aui-adapter.ts";

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
      <div className="lens-who you">
        <span>you</span>
        <button
          className="lens-fork"
          type="button"
          title="Fork this conversation into a new thread"
          onClick={() => void forkThread()}
        >
          <GitFork size={12} />
        </button>
      </div>
      <div className="lens-bubble">{text}</div>
    </MomentSection>
  );
}

function AssistantMoment() {
  const id = useMessage((message) => message.id);
  const running = useMessage((message) => message.status?.type === "running");
  return (
    <MomentSection id={id} role="assistant">
      <div className="lens-who pea">pea</div>
      <div className="mg-prose" style={{ display: "grid", gap: "8px" }}>
        <AssistantParts />
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
    if (this.state.error) return <div className="lens-part-error">{this.state.error}</div>;
    return this.props.children;
  }
}

/** Assistant text → assistant-ui markdown, styled with our existing prose rules. */
const MarkdownText: TextMessagePartComponent = () => <MarkdownTextPrimitive className="mg-prose" />;

/** Collapsible chain-of-thought (collapsed by default so the spine stays calm). */
const ReasoningPart: ReasoningMessagePartComponent = ({ text }) => {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className={`lens-cot ${open ? "open" : ""}`}>
      <button className="lens-cot-head" type="button" onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={12} className="lens-cot-caret" />
        <span>Thought process</span>
      </button>
      {open ? <div className="lens-cot-body">{text}</div> : null}
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
    <div className="lens-tool-part" data-tool-id={toolCallId}>
      <div className={`lens-marker tool ${tone}`}>
        <span>⌗ {toolName}</span>
        {target ? <code>{target}</code> : null}
      </div>
      {pending ? (
        <div className="lens-approval-actions">
          {(approval.options ?? DEFAULT_APPROVAL_OPTIONS).map((option) => {
            const allow = option.kind.startsWith("allow");
            return (
              <button
                key={option.id}
                type="button"
                className={`lens-approval-btn ${allow ? "allow" : "deny"}`}
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
