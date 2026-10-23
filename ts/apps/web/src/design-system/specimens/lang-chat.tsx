import { ThreadsSidebar, ThreadSidebarActions } from "#/chat/thread-palette";
import { ModeDial } from "#/chat/mode-dial";
import { demoThreads } from "#/chat/thread-navigation";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { Pane } from "@pe/kit/lang/pane";
import {
  Composer,
  ComposerFrame,
  ConversationBody,
  MessageBubble,
  MessageHead,
  ToolStatus,
} from "#/components/lang/conversation";
import { useState } from "react";
import { ArrowUp, GitFork, Paperclip } from "lucide-react";
import { Ladder } from "#/route/ladder";
import { ProviderMark } from "#/components/lang/provider-mark";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "@pe/kit/lang/switcher";
import { SpecimenFrame } from "./recipe-grid";

/** The composer's picker: provider › model › effort › fast, one rung each. */
function PickerSpecimen() {
  const [model, setModel] = useState("Opus 5.5");
  const [effort, setEffort] = useState("high");
  const [fast, setFast] = useState("fast");
  const rung = (key: string, now: string, set: (id: string) => void, ids: string[]) => ({
    key,
    label: now,
    placeholder: `choose ${key}`,
    options: ids.map((id) => ({ id, label: id })),
    picked: (id: string) => id === now,
    pick: set,
  });
  return (
    <Ladder
      face="control"
      mark={<ProviderMark harness="claude" />}
      openOn="model"
      closeOn={["effort"]}
      levels={[
        {
          key: "provider",
          label: "Claude",
          placeholder: "choose a provider",
          options: [{ id: "Claude", label: "Claude", sub: "● ready" }],
          picked: () => true,
          pick: () => {},
        },
        rung("model", model, setModel, ["Opus 5.5", "Sonnet 5.5"]),
        rung("effort", effort, setEffort, ["low", "medium", "high"]),
        { ...rung("speed", fast, setFast, ["fast", "not fast"]), silent: fast === "not fast" },
      ]}
    />
  );
}

export function LangChatSpecimens() {
  return (
    <>
      <SpecimenFrame name="Switcher" importPath="@pe/kit/lang/switcher">
        <Switcher
          ariaLabel="Pane views"
          value="threads"
          onChange={() => {}}
          options={[
            { value: "threads", label: "Threads", title: "Choose a thread" },
            { value: "world", label: "World", title: "Inspect the thread context" },
          ]}
        />
      </SpecimenFrame>
      <SpecimenFrame name="Thread list" importPath="@pe/kit/lang/list-view">
        <div className="h-80 w-80">
          <Pane
            scroll="clip"
            flush
            title="threads"
            ground="artifact"
            tabs={<ModeDial mode="threads" setMode={() => {}} />}
            actions={<ThreadSidebarActions onNew={() => {}} />}
          >
            <ThreadsSidebar
              threads={
                demoThreads({
                  ...emptyChatState(),
                  id: "example",
                  title: "Coordinate the Level 2 supply air path",
                }) as never
              }
              currentThreadId="example"
              providers={[]}
              onSelect={() => {}}
              onFork={() => {}}
              onRename={() => {}}
              onDelete={() => {}}
              onUpdate={async () => true}
              onNewTarget={() => {}}
            />
          </Pane>
        </div>
      </SpecimenFrame>
      <SpecimenFrame name="Conversation" importPath="#/components/lang/conversation">
        <div className="max-w-2xl space-y-6">
          <ConversationBody role="user">
            <MessageHead role="user" turn={1} at={new Date(2026, 9, 11, 14, 31)} />
            <div className="ml-auto w-fit">
              <MessageBubble>Inspect the mechanical view before we change it.</MessageBubble>
            </div>
          </ConversationBody>
          <ConversationBody role="assistant">
            <MessageHead role="assistant" at={new Date(2026, 9, 11, 14, 31)} />
            <p>
              The view contains 47 visible elements. The schedule change is ready for your review.
            </p>
            <div className="mt-3 flex gap-3">
              <span className="face-mono t-small">capture_view · Operations Demo.rvt · r14</span>
              <ToolStatus state="done" />
            </div>
          </ConversationBody>
          <div className="flex gap-4">
            {(["working", "waiting", "failed", "denied", "cancelled", "expired"] as const).map(
              (state) => (
                <ToolStatus key={state} state={state} />
              ),
            )}
          </div>
          <ComposerFrame>
            <Composer
              aria-label="Specimen message"
              placeholder="Ask Pea, or type / for a skill"
              pickers={<PickerSpecimen />}
              tools={<span>Ready</span>}
              fork={<Button kind="framed" icon={GitFork} label="Fork this thread" />}
              attach={<Button kind="framed" icon={Paperclip} label="Attach files" />}
              send={<Button kind="commit" icon={ArrowUp} label="send" />}
              onSend={() => undefined}
            />
          </ComposerFrame>
        </div>
      </SpecimenFrame>
    </>
  );
}
