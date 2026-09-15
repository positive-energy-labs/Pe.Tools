import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import { Paperclip, X } from "lucide-react";
import { ControlChips } from "#/chat/control-chips";
import { Textarea } from "#/components/lang/textarea";
import { useWorkbench, type WorkbenchAttachment } from "#/workbench/provider";
import { selectRunStatus, selectSkillCommands } from "#/workbench/chat-state";
import type { Mode } from "#/workbench/depth";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";
import { cn } from "#/lib/utils";
import { useSend, type ChatHandle } from "#/chat/composer-head";
import { SituationAction } from "#/route/situation";

interface SlashCommand {
  name: string;
  description: string;
  kind: "builtin" | "skill";
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "new", description: "Start a new thread", kind: "builtin" },
  { name: "fork", description: "Fork this thread", kind: "builtin" },
  { name: "threads", description: "Show the thread list", kind: "builtin" },
  { name: "trace", description: "Show the trace gutter", kind: "builtin" },
  { name: "world", description: "Show the context world inspector", kind: "builtin" },
];

export function Composer({
  setMode,
  handle,
  topBar,
}: {
  setMode: (mode: Mode) => void;
  /** The route handle; Enter runs its Send verb scoped to this draft, the head draws the same. */
  handle: ChatHandle;
  /** Rendered flush at the top edge of the box — the composer head and the budget bar. */
  topBar?: ReactNode;
}) {
  const { store, chat, newThread, forkThread } = useWorkbench();
  const isRunning = selectRunStatus(chat) !== "idle";
  const liveDraft = useAtomValue(store.atoms.draft);
  const draft = liveDraft;
  const { text, attachments } = draft;
  const send = useSend(handle, draft);
  const setText = (value: string) => {
    store.actions.setDraft((previous) => ({ ...previous, text: value }));
  };
  const setAttachments = (
    value: WorkbenchAttachment[] | ((previous: WorkbenchAttachment[]) => WorkbenchAttachment[]),
  ) => {
    const update = (previous: { text: string; attachments: WorkbenchAttachment[] }) => ({
      ...previous,
      attachments: typeof value === "function" ? value(previous.attachments) : value,
    });
    store.actions.setDraft(update);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const [activeCommand, setActiveCommand] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  const commands = useMemo<SlashCommand[]>(
    () => [
      ...BUILTIN_COMMANDS,
      ...selectSkillCommands(chat.inspect).map(
        (skill): SlashCommand => ({ ...skill, kind: "skill" }),
      ),
    ],
    [chat.inspect],
  );
  const slash = text.startsWith("/") ? text.slice(1).split(/\s+/)[0]!.toLowerCase() : undefined;
  const matches =
    slash !== undefined
      ? commands.filter((command) => command.name.toLowerCase().startsWith(slash))
      : [];
  const visibleMatches = matches.slice(0, 6);
  const activeIndex = activeCommand % Math.max(visibleMatches.length, 1);
  const selectedCommand = visibleMatches[activeIndex];
  const showMenu =
    !menuDismissed && slash !== undefined && !text.includes(" ") && visibleMatches.length > 0;

  const runBuiltin = (name: string): boolean => {
    switch (name) {
      case "new":
        newThread();
        return true;
      case "fork":
        void forkThread();
        return true;
      case "threads":
      case "trace":
      case "world":
        setMode(name as Mode);
        return true;
      default:
        return false;
    }
  };

  const pick = (command: SlashCommand) => {
    if (command.kind === "builtin") {
      runBuiltin(command.name);
      setText("");
    } else {
      setText(`Use the ${command.name} skill: `);
    }
  };

  const sendCurrent = () => {
    const trimmed = text.trim();
    if (trimmed.startsWith("/")) {
      const name = trimmed.slice(1).split(/\s+/)[0]!.toLowerCase();
      if (runBuiltin(name)) {
        setText("");
        return;
      }
    }
    // Enter is the same verb as the head's Send; a refused verb stays quiet here, as it always
    // has, and the head's button is where the refusal speaks.
    if (send.refusal) return;
    void send.run();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendCurrent();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (showMenu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveCommand(
          (current) => (current + step + visibleMatches.length) % visibleMatches.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuDismissed(true);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        if (selectedCommand) pick(selectedCommand);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrent();
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next = await Promise.all(Array.from(files).map(readAttachment));
    setAttachments((previous) => [...previous, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <form onSubmit={submit} className="relative w-full">
      {showMenu ? (
        <div
          id={menuId}
          role="listbox"
          aria-label="Commands"
          className={cn(
            "hairline-x-faint hairline-y-faint absolute bottom-full mb-2 w-full overflow-hidden rounded-sm",
            "right-2 left-2 z-[8] mb-1.5 max-h-52 w-auto overflow-x-hidden overflow-y-auto p-1 shadow-sm [&>button]:w-full",
          )}
          data-surface="artifact"
        >
          {visibleMatches.map((command, index) => (
            <Press
              key={`${command.kind}:${command.name}`}
              id={`${menuId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              state={index === activeIndex ? "selected" : "rest"}
              onMouseEnter={() => setActiveCommand(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(command)}
            >
              <PressContent geometry="baseline">
                {/* a slash command is a machine identifier — mono */}
                <span className="face-mono text-ink">/{command.name}</span>
                <span className="truncate t-small t-upper">{command.description}</span>
              </PressContent>
            </Press>
          ))}
        </div>
      ) : null}

      {/* The composer is a box on the artifact ground — a closed edge all the way around, so the
          input reads as a place you write rather than a strip the transcript ran into. */}
      <div
        className="hairline-x-faint hairline-y-faint overflow-hidden rounded-sm"
        data-surface="artifact"
      >
        {topBar}

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachments.map((attachment, index) => (
              <span
                key={index}
                className="hairline-x-faint hairline-y-faint inline-flex items-center gap-1 rounded-sm px-2 py-0.5 t-small t-upper"
                data-surface="recess"
              >
                {attachment.name ?? "attachment"}
                <Press
                  type="button"
                  title="Remove"
                  onClick={() =>
                    setAttachments((previous) =>
                      previous.filter((_, position) => position !== index),
                    )
                  }
                >
                  <X className="size-3" />
                </Press>
              </span>
            ))}
          </div>
        ) : null}

        <div className="p-2 px-2 py-1.5">
          <Textarea
            name="input"
            aria-label="Message"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={showMenu}
            aria-controls={showMenu ? menuId : undefined}
            aria-activedescendant={showMenu ? `${menuId}-${activeIndex}` : undefined}
            size="compact"
            surface="embedded"
            placeholder="Ask Pea…  ( / for commands )"
            rows={1}
            autoFocus
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setActiveCommand(0);
              setMenuDismissed(false);
            }}
            onKeyDown={onKeyDown}
          />
          {/* Control row: attachments + session controls (model/access), then Send — the same
              manifest verb Enter runs, with the Situation's flag (moved here from the head,
              2026-09-14: a composer's send belongs beside its text). */}
          <div className="flex items-center gap-1.5 pt-1">
            <Press
              tone="quiet"
              size="icon"
              title="Attach files"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Press>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(event) => void onFiles(event.currentTarget.files)}
            />
            <ControlChips />
            <span className="ml-auto flex items-center gap-1.5">
              {isRunning ? (
                <SituationAction handle={handle} name="cancel" action={handle.actions.cancel} />
              ) : null}
              <SituationAction handle={handle} name="send" action={send} commit />
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}

async function readAttachment(file: File): Promise<WorkbenchAttachment> {
  const textual =
    file.type.startsWith("text/") ||
    /\.(md|txt|json|jsonc|csv|tsv|ts|tsx|js|jsx|cs|py|rb|go|rs|java|yaml|yml|toml|xml|html|css)$/i.test(
      file.name,
    );
  if (textual) {
    return { name: file.name, mimeType: file.type || "text/plain", text: await file.text() };
  }
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    data: base64FromBuffer(await file.arrayBuffer()),
  };
}

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
