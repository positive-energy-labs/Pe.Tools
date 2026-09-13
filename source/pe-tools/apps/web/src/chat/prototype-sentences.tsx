/** Three throwaway Chat compositions on /chat?variant=A|B|C. Existing seed, kit controls, no writes. */
import { useEffect, useReducer, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Check,
  Sparkles,
} from "lucide-react";
import { Press } from "#/components/lang/press";
import { PickList } from "#/components/lang/pick-list";
import { Textarea } from "#/components/lang/textarea";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "#/components/lang/dialog";
import { CHAT_SEED_STATE } from "./seeds";
import {
  editPrototypeWork,
  emptyPrototypeWork,
  type PrototypeTarget,
} from "./prototype-sentence-model";

export type SentenceVariant = "A" | "B" | "C";
const variants = {
  A: "The continuous sentence",
  B: "The unfolding sentence",
  C: "The next question",
};
// The coordination proposal already used by the Chat demo; display it without replaying its tool calls.
const seedParts = CHAT_SEED_STATE.messages.flatMap((message) => message.content.parts ?? []);
const proposal = seedParts.find(
  (part) => part.type === "tool-invocation" && part.toolInvocation.toolName === "submit_plan",
);
const plan =
  proposal?.type === "tool-invocation"
    ? (proposal.toolInvocation.args as { plan: string[] }).plan
    : [];
const proposalChanges = plan.filter((line) => !line.includes("approval"));
const firstPrompt = seedParts.find((part) => part.type === "text");

// Deliberately labeled sample choices: the duplicate open document tests exact session selection.
const targets: PrototypeTarget[] = [
  {
    id: "design/operations/level2",
    kind: "revit",
    path: ["Revit · Design", "Operations Demo.rvt", "Level 2 HVAC Plan"],
  },
  {
    id: "design/operations/level1",
    kind: "revit",
    path: ["Revit · Design", "Operations Demo.rvt", "Level 1 HVAC Plan"],
  },
  {
    id: "coordination/operations/level2",
    kind: "revit",
    path: ["Revit · Coordination", "Operations Demo.rvt", "Level 2 HVAC Plan"],
  },
  {
    id: "local/family/profiles/mechanical/fancoil",
    kind: "file",
    path: ["Local files", "Family Foundry", "Profiles", "Mechanical", "Fan coil.json"],
  },
  {
    id: "local/family/profiles/mechanical/pump",
    kind: "file",
    path: ["Local files", "Family Foundry", "Profiles", "Mechanical", "Pump.json"],
  },
];

function Phrase({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  label?: string;
}) {
  return (
    <Press size="value" hover="bare" onClick={onClick} aria-label={label}>
      <span className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-4">
        {children}
      </span>
    </Press>
  );
}

function TargetPicker({
  open,
  close,
  choose,
}: {
  open: boolean;
  close: () => void;
  choose: (target: PrototypeTarget | null) => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  const [descending, setDescending] = useState(false);
  const candidates = targets.filter((t) => path.every((part, index) => t.path[index] === part));
  const names = [...new Set(candidates.map((t) => t.path[path.length]).filter(Boolean))].sort(
    (a, b) => (descending ? b.localeCompare(a) : a.localeCompare(b)),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent>
        <DialogTitle>Where should this work go?</DialogTitle>
        <DialogDescription>
          One choice, as deep as you need. These are sample destinations.
        </DialogDescription>
        <nav aria-label="Destination path" className="flex flex-wrap items-center gap-1 t-small">
          <Press size="value" onClick={() => setPath([])}>
            Anywhere
          </Press>
          {path.map((part, index) => (
            <span key={part} className="inline-flex items-center gap-1">
              <ChevronRight size={12} />
              <Press size="value" onClick={() => setPath(path.slice(0, index + 1))}>
                {part}
              </Press>
            </span>
          ))}
        </nav>
        <div className="flex items-center justify-between hairline-b pb-2">
          <span className="t-small text-ink-2">
            {path.length ? "Continue inside this location" : "Choose Revit or a local file"}
          </span>
          <Press
            size="caption"
            onClick={() => setDescending(!descending)}
            aria-label="Reverse destination sort"
          >
            {descending ? "Z–A" : "A–Z"}
          </Press>
        </div>
        <PickList
          key={path.join("/")}
          placeholder="Search this level…"
          items={names.map((name) => ({
            id: name,
            label: name,
            meta: candidates.some(
              (t) => t.path[path.length] === name && t.path.length > path.length + 1,
            )
              ? "›"
              : "select",
          }))}
          onPick={(name) => {
            const next = [...path, name];
            const leaf = candidates.find(
              (t) => t.path.length === next.length && t.path.every((part, i) => part === next[i]),
            );
            if (leaf) {
              choose(leaf);
              close();
            } else setPath(next);
          }}
          emptyNote="No destinations here. Go back one level."
        />
        <div className="hairline-t pt-2">
          <Press
            size="value"
            onClick={() => {
              choose(null);
              close();
            }}
          >
            Continue without a destination
          </Press>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SentencePrototype({ variant }: { variant: SentenceVariant }) {
  const navigate = useNavigate({ from: "/chat" });
  const [work, dispatch] = useReducer(editPrototypeWork, undefined, emptyPrototypeWork);
  const [picker, setPicker] = useState(false);
  const [review, setReview] = useState(false);
  const [details, setDetails] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<number | null>(null);
  const staged = work.changes.length > 0;
  const changeVariant = (direction: number) => {
    const keys: SentenceVariant[] = ["A", "B", "C"];
    const next = keys[(keys.indexOf(variant) + direction + keys.length) % keys.length]!;
    void navigate({ search: (previous) => ({ ...previous, variant: next }), replace: true });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        element.closest(
          "input,textarea,select,button,[contenteditable=true],[role=dialog],[role=combobox],[role=listbox]",
        )
      )
        return;
      if (picker || review || receipt !== null) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        changeVariant(event.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const stage = () => {
    dispatch({
      type: "stage",
      changes:
        work.target?.kind === "file"
          ? ["Update the profile description", "Preserve parameter bindings"]
          : proposalChanges,
    });
    setNotice("");
  };
  const choose = (target: PrototypeTarget | null) => {
    dispatch({ type: "target", target });
    // A changed destination requires a new review; an existing proposal is retained to inspect.
    if (staged) setNotice("Destination changed. Review the staged work again before continuing.");
  };
  const send = () => {
    if (!text.trim()) return;
    setMessages((previous) => [...previous, text.trim()]);
    setText("");
    setNotice("Demo reply: we can keep discussing and drafting without connecting to Revit.");
  };
  const destination = (
    <Phrase label="Choose destination" onClick={() => setPicker(true)}>
      {work.target
        ? `${work.target.path.slice(-2).join(" › ")}${work.target.kind === "revit" ? ` in ${work.target.path[0]?.replace("Revit · ", "")}` : ""}`
        : "no document attached"}
    </Phrase>
  );
  const reviewPhrase = (
    <Phrase label="Review staged work" onClick={() => setReview(true)}>
      <strong>{work.changes.length} staged changes</strong>
    </Phrase>
  );
  const act = () => {
    if (!work.target) {
      setPicker(true);
      return;
    }
    if (!work.reviewed) {
      setReview(true);
      return;
    }
    dispatch({ type: "apply" });
    setNotice(
      "Demo completed. The sentence in the conversation keeps this destination and these changes.",
    );
  };
  const action = (
    <Phrase onClick={act}>
      {!work.target
        ? "choose where they go"
        : !work.reviewed
          ? "review before continuing"
          : work.target.kind === "file"
            ? "save to this file"
            : "apply to this view"}
    </Phrase>
  );
  const sentence = (inline = false) => (
    <span
      className="t-prose"
      data-testid={inline ? "inline-work-sentence" : "composer-work-sentence"}
    >
      {staged ? (
        <>
          With {reviewPhrase} for {destination}, {action}.
        </>
      ) : (
        <>
          We can{" "}
          {
            <Phrase onClick={stage}>
              draft {work.target?.kind === "file" ? "a profile update" : "a schedule update"}
            </Phrase>
          }{" "}
          with {destination}.
        </>
      )}
    </span>
  );
  const reviewContents = (
    <>
      <p className="t-small text-ink-2">
        {work.target
          ? work.target.path.join(" › ")
          : "Choose a destination before approving this work."}
      </p>
      <ol className="hairline-rows my-3">
        {work.changes.map((change, index) => (
          <li key={change} className="flex gap-3 py-3">
            <span className="face-mono text-ink-mute">0{index + 1}</span>
            <span>{change}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Phrase onClick={() => setPicker(true)}>Change destination</Phrase>
        <Press
          size="value"
          disabled={!work.target || !staged}
          onClick={() => {
            dispatch({ type: "review" });
            setReview(false);
            setDetails(false);
            setNotice("Reviewed for this destination. Nothing has been applied.");
          }}
        >
          <Check size={14} /> Approve these changes
        </Press>
      </div>
    </>
  );

  return (
    <main className="min-h-dvh text-ink" data-surface="page" data-testid="sentence-prototype">
      <header className="flex items-center justify-between gap-4 px-6 py-4 hairline-b">
        <a href="/" className="t-title face-display">
          Pea<span className="text-ink-mute"> / </span>
          <span className="text-ink-2">Coordination</span>
        </a>
        <div className="flex items-center gap-4">
          <span className="t-small text-ink-mute">UI study · sample data · no writes</span>
          <ThemeToggle />
        </div>
      </header>
      <div
        className={
          variant === "C"
            ? "mx-auto flex max-w-5xl flex-col px-6 pt-10 pb-32"
            : "mx-auto flex max-w-3xl flex-col px-6 pt-10 pb-32"
        }
      >
        <div className="mb-9 flex items-baseline justify-between gap-4">
          <div>
            <p className="t-upper t-small text-ink-mute">Level 2 · coordination brief</p>
            <h1 className="t-head face-display mt-2">Prepare the coordination schedule</h1>
          </div>
          <Press
            size="caption"
            onClick={() => {
              dispatch({ type: "stage", changes: [] });
              choose(null);
              setNotice("");
              setDetails(false);
            }}
          >
            Clear draft
          </Press>
        </div>
        <section aria-label="Conversation" className={variant === "C" ? "max-w-2xl" : ""}>
          <div className="mb-8 ml-12 hairline-l pl-4">
            <p className="t-small text-ink-mute mb-2">You</p>
            <p className="t-prose">
              {firstPrompt?.type === "text"
                ? firstPrompt.text
                : "Help me prepare the coordination schedule."}
            </p>
          </div>
          <div className="mb-8">
            <p className="t-small mb-2" data-tone="pea">
              Pea
            </p>
            <p className="t-prose">
              We can prepare the schedule together. Choose a model when you want to inspect it or
              apply a change. For now, the brief is enough to start.
            </p>
            {!staged && (!work.receipts.length || variant === "C") ? (
              <div className="mt-4">
                <Phrase onClick={stage}>
                  Draft the schedule update <ChevronRight size={12} />
                </Phrase>
              </div>
            ) : null}
          </div>
          {messages.map((message, index) => (
            <div key={`${index}-${message}`} className="mb-5 ml-12 hairline-l pl-4">
              <p className="t-small text-ink-mute">You</p>
              <p>{message}</p>
              <p className="mt-2 text-ink-2 t-small">
                Pea · We can discuss that without attaching a document. This study simulates the
                conversation.
              </p>
            </div>
          ))}
          {work.receipts.map((entry, index) => (
            <div key={index} className="my-6 hairline-l-2 pl-4">
              <p className="t-small mb-1 text-ink-mute">Pea · completed in this demo</p>
              <p className="t-prose">
                {entry.target.kind === "file" ? "Saved" : "Applied"}{" "}
                <Phrase onClick={() => setReceipt(index)}>{entry.changes.length} changes</Phrase> to{" "}
                <Phrase onClick={() => setReceipt(index)}>
                  {entry.target.path.slice(-2).join(" › ")}
                </Phrase>
                .
              </p>
              <p className="t-small text-ink-2 mt-1">
                {entry.target.path[0]} · recorded destination
              </p>
            </div>
          ))}
          {staged ? (
            <div className="my-8" aria-label="Pea proposed work">
              <p className="t-small mb-2" data-tone="pea">
                Pea · proposed work
              </p>
              {variant === "C" ? (
                <div className="hairline-l-2 pl-5 py-2">
                  <p className="t-title mb-2">
                    {!work.target
                      ? "Where should these changes go?"
                      : !work.reviewed
                        ? "Does this look right?"
                        : "Ready to make it happen?"}
                  </p>
                  {sentence(true)}
                  <div className="mt-4">
                    <Press size="value" onClick={act}>
                      <ArrowRight size={15} />
                      {!work.target
                        ? "Choose a destination"
                        : !work.reviewed
                          ? "Review the changes"
                          : "Complete this demo action"}
                    </Press>
                  </div>
                </div>
              ) : (
                sentence(true)
              )}
            </div>
          ) : null}
        </section>

        <section
          aria-label="Message composer"
          className={
            variant === "C" ? "mt-5 hairline-t pt-5" : "mt-5 rounded-lg hairline-t hairline-b"
          }
        >
          {variant === "A" ? <div className="px-3 py-3 hairline-b">{sentence()}</div> : null}
          {variant === "B" ? (
            <>
              <div className="px-3 py-3 flex items-center justify-between gap-3 hairline-b">
                <span className="t-prose">
                  {staged ? (
                    <>
                      Working on {reviewPhrase} for {destination}.
                    </>
                  ) : (
                    <>Thinking together with {destination}.</>
                  )}
                </span>
                <Press
                  size="icon"
                  aria-label="Expand working context"
                  aria-expanded={details}
                  onClick={() => setDetails(!details)}
                >
                  <ChevronDown size={16} />
                </Press>
              </div>
              {details ? (
                <div className="px-4 py-3 hairline-b" data-surface="recess">
                  <p className="t-small text-ink-mute">The work behind this sentence</p>
                  {staged ? (
                    reviewContents
                  ) : (
                    <div className="py-3">
                      <Phrase onClick={stage}>Draft a schedule update</Phrase>
                      <p className="mt-2 t-small text-ink-2">
                        Work stays here until you choose where it goes.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
          {variant === "C" ? (
            <div className="mb-3 flex items-center justify-between">
              <span className="t-small text-ink-2">
                {work.target ? (
                  <>Continue with {destination}.</>
                ) : (
                  <>
                    Just ask.{" "}
                    <Phrase onClick={() => setPicker(true)}>Add context when it helps.</Phrase>
                  </>
                )}
              </span>
              <Sparkles size={14} />
            </div>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Textarea
              aria-label="Message Pea"
              surface="embedded"
              placeholder="Ask Pea, or keep thinking out loud…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="flex items-center justify-between px-3 pb-3">
              <span className="t-small text-ink-mute">
                {work.target?.kind === "file"
                  ? "Local editing needs no Revit"
                  : "Chat works without Revit"}
              </span>
              <Press type="submit" size="icon" disabled={!text.trim()} aria-label="Send message">
                <ArrowUp size={16} />
              </Press>
            </div>
          </form>
        </section>
        <p role="status" className="min-h-6 mt-3 t-small text-ink-2">
          {notice}
        </p>
        <details className="mt-5 t-small text-ink-mute">
          <summary>About this study</summary>
          <p className="mt-2">
            The coordination proposal comes from the existing Chat seed. Destinations and actions
            are simulated in memory. Nothing contacts Pea or writes to Revit or files. Switch
            compositions without losing your draft. Reload to restart the journey.
          </p>
        </details>
      </div>
      <nav
        aria-label="Prototype variants"
        className="fixed bottom-5 left-1/2 z-raised flex w-80 -translate-x-1/2 items-center justify-between rounded-full px-4 py-3 shadow-lg hairline-t hairline-b"
        data-surface="artifact"
      >
        <Press size="icon" aria-label="Previous composition" onClick={() => changeVariant(-1)}>
          <ArrowLeft size={16} />
        </Press>
        <span className="t-small face-mono">
          {variant} · {variants[variant]}
        </span>
        <Press size="icon" aria-label="Next composition" onClick={() => changeVariant(1)}>
          <ArrowRight size={16} />
        </Press>
      </nav>
      <TargetPicker open={picker} close={() => setPicker(false)} choose={choose} />
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent>
          <DialogTitle>Review the staged work</DialogTitle>
          <DialogDescription>
            Approval belongs to this exact destination. Changing it asks for review again.
          </DialogDescription>
          {reviewContents}
        </DialogContent>
      </Dialog>
      <Dialog
        open={receipt !== null}
        onOpenChange={(open) => {
          if (!open) setReceipt(null);
        }}
      >
        <DialogContent>
          <DialogTitle>What happened</DialogTitle>
          <DialogDescription>
            This is a frozen demo record, not a live Revit receipt.
          </DialogDescription>
          {receipt !== null && work.receipts[receipt] ? (
            <>
              <p>{work.receipts[receipt].target.path.join(" › ")}</p>
              <ul>
                {work.receipts[receipt].changes.map((change) => (
                  <li key={change} className="py-2 hairline-b">
                    {change}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
