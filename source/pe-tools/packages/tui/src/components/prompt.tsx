import type { InputRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { peaTheme } from "../theme.js";

export type PromptMode = "chat" | "command" | "shell";

export interface PromptHandle {
  submit(): Promise<void>;
  focus(): void;
}

const placeholder = {
  normal: [
    "Ask Pea to inspect the active Revit model",
    "Build a Pod from this idea",
    "Explain the failing verification run",
    "Find the right Host operation for this workflow",
  ],
  command: ["/threads", "/model", "/mode", "/help"],
  shell: ["git status", "vp check --fix", "pea live status"],
} as const;

export function Prompt(props: {
  disabled?: boolean;
  onSubmit: (text: string) => Promise<boolean>;
  onExit: () => void;
  onReady: (handle: PromptHandle) => void;
}): JSX.Element {
  let input: InputRenderable | undefined;
  const [mode, setMode] = createSignal<PromptMode>("chat");
  const [placeholderIndex, setPlaceholderIndex] = createSignal(0);
  const currentPlaceholder = createMemo(() => {
    const list =
      mode() === "command"
        ? placeholder.command
        : mode() === "shell"
          ? placeholder.shell
          : placeholder.normal;
    return list[placeholderIndex() % list.length];
  });

  const submit = async () => {
    const text = input?.plainText.trim() ?? "";
    if (!text || props.disabled) return;
    if (text === "/exit") {
      props.onExit();
      return;
    }

    const sent = await props.onSubmit(text);
    if (!sent) return;

    if (input) input.value = "";
    setMode("chat");
  };

  onMount(() => {
    props.onReady({
      submit,
      focus() {
        input?.focus();
      },
    });
    input?.focus();
    const interval = setInterval(() => setPlaceholderIndex((value) => value + 1), 3500);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <box
      flexDirection="column"
      backgroundColor={peaTheme.backgroundPanel}
      border={["top"]}
      borderColor={peaTheme.border}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg={mode() === "chat" ? peaTheme.primary : peaTheme.textMuted}>chat</text>
          <text fg={mode() === "command" ? peaTheme.primary : peaTheme.textMuted}>/command</text>
          <text fg={mode() === "shell" ? peaTheme.primary : peaTheme.textMuted}>$ shell</text>
        </box>
        <text fg={peaTheme.textMuted}>enter send · ctrl+d quit · y/a/n approvals</text>
      </box>
      <input
        ref={(value: InputRenderable) => {
          input = value;
          value.traits = { capture: ["submit"], status: "Composing" };
        }}
        width="100%"
        placeholder={currentPlaceholder()}
        placeholderColor={peaTheme.textMuted}
        backgroundColor={peaTheme.backgroundElement}
        focusedBackgroundColor={peaTheme.backgroundElement}
        textColor={peaTheme.text}
        focusedTextColor={peaTheme.text}
        cursorColor={peaTheme.primary}
        keyAliasMap={{ enter: "return", esc: "escape" }}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", ctrl: true, action: "submit" },
          { name: "return", meta: true, action: "submit" },
        ]}
        onSubmit={() => {
          void submit();
        }}
        onInput={(value: string) => {
          const text = value.trimStart();
          setMode(text.startsWith("/") ? "command" : text.startsWith("$") ? "shell" : "chat");
        }}
      />
    </box>
  );
}
