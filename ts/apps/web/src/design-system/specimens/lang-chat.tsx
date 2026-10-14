import {
  NavigationFilter,
  NavigationFilters,
  NavigationGroup,
  NavigationItem,
  NavigationMore,
  NavigationSearch,
  NavigationToggle,
} from "#/components/lang/navigation";
import { Pane } from "#/components/lang/pane";
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
import { PaneTabs } from "@pe/kit/lang/pane-tabs";
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
      <SpecimenFrame name="PaneTabs" importPath="@pe/kit/lang/pane-tabs">
        <PaneTabs
          ariaLabel="Pane views"
          value="threads"
          onChange={() => {}}
          options={[
            { value: "threads", label: "Threads", title: "Choose a thread" },
            { value: "world", label: "World", title: "Inspect the thread context" },
          ]}
        />
      </SpecimenFrame>
      <SpecimenFrame name="Navigation" importPath="#/components/lang/navigation">
        <div className="h-80 w-80">
          <Pane scroll="clip" title="threads" ground="artifact">
            <div data-navigation="" className="flex h-full min-h-0 flex-col gap-(--gutter)">
              <NavigationSearch value="" onChange={() => {}} />
              <NavigationFilters>
                <NavigationFilter
                  label="Target"
                  all="All targets"
                  options={[{ key: "demo", label: "Operations Demo.rvt" }]}
                  value="demo"
                  onChange={() => {}}
                />
                <NavigationFilter
                  label="Provider"
                  all="All providers"
                  options={[{ key: "codex", label: "Codex" }]}
                  value="*"
                  onChange={() => {}}
                />
                <NavigationFilter
                  label="State"
                  all="All states"
                  options={[{ key: "working", label: "Working" }]}
                  value="*"
                  onChange={() => {}}
                />
                <NavigationToggle label="Unread" count={1} pressed={false} onChange={() => {}} />
              </NavigationFilters>
              <div data-navigation-roster="" className="min-h-0 flex-1 overflow-y-auto">
                <NavigationGroup label="Active" count={2} stack={{ index: 0, of: 2 }}>
                  <NavigationItem
                    id="example"
                    title="Coordinate the Level 2 supply air path"
                    target="Operations Demo.rvt"
                    meta="Codex · GPT-5.4"
                    time="14:31"
                    state="Working"
                    unread
                    active
                    actions={<Button label="Thread actions">…</Button>}
                    onPick={() => {}}
                    onRename={() => {}}
                    onMenu={() => {}}
                  />
                  <NavigationItem
                    id="waiting"
                    title="Review the equipment schedule"
                    meta="Claude · Sonnet"
                    time="14:20"
                    state="1 waiting for you"
                    stateTone="caution"
                    actions={<Button label="Thread actions">…</Button>}
                    onPick={() => {}}
                    onRename={() => {}}
                    onMenu={() => {}}
                  />
                </NavigationGroup>
                <NavigationGroup
                  label="Settled"
                  count={1}
                  compact
                  forceOpen
                  stack={{ index: 1, of: 2 }}
                >
                  <NavigationItem
                    id="settled"
                    title="Normalize equipment names"
                    target="Operations Demo.rvt"
                    meta="Claude"
                    time="Yesterday"
                    compact
                    actions={<Button label="Thread actions">…</Button>}
                    onPick={() => {}}
                    onRename={() => {}}
                    onMenu={() => {}}
                  />
                  <NavigationMore hidden={12} step={25} onMore={() => {}} />
                </NavigationGroup>
              </div>
            </div>
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
              variant="full"
              aria-label="Specimen message"
              placeholder="Ask Pea, or type / for a skill"
              pickers={() => <PickerSpecimen />}
              tools={
                <>
                  <span>Ready</span>
                  <Button kind="framed" icon={GitFork} label="Fork this thread" />
                  <Button kind="framed" icon={Paperclip} label="Attach files" />
                </>
              }
              send={<Button kind="commit" icon={ArrowUp} label="send" />}
              onSend={() => undefined}
            />
          </ComposerFrame>
        </div>
      </SpecimenFrame>
    </>
  );
}
