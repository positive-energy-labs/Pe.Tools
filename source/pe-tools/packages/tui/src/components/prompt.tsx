import type { JSX } from "@opentui/solid";
import { createSignal, onMount } from "solid-js";
import type { TextareaRenderable } from "@opentui/core";
import { peaTheme } from "../theme.js";

export type PromptMode = "chat" | "command";

export interface PromptHandle {
  submit(): Promise<void>;
  focus(): void;
}

export function Prompt(props: {
  disabled?: boolean;
  onSubmit: (text: string) => Promise<boolean>;
  onExit: () => void;
  onReady: (handle: PromptHandle) => void;
}): JSX.Element {
  let input: TextareaRenderable | undefined;
  const [mode, setMode] = createSignal<PromptMode>("chat");

  const submit = async () => {
    const text = input?.plainText.trim() ?? "";
    if (!text || props.disabled) return;
    if (text === "/exit") {
      props.onExit();
      return;
    }

    const sent = await props.onSubmit(text);
    if (!sent) return;

    input?.clear();
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
        <text fg={peaTheme.textMuted}>{mode() === "chat" ? "chat" : "command"}</text>
        <text fg={peaTheme.textMuted}>enter send · esc or /exit quit · y/a/n approvals</text>
      </box>
      <textarea
        ref={(value: TextareaRenderable) => {
          input = value;
          value.traits = { capture: ["submit"], status: "Composing" };
        }}
        height={3}
        width="100%"
        placeholder="Message Pea..."
        placeholderColor={peaTheme.textMuted}
        backgroundColor={peaTheme.backgroundElement}
        focusedBackgroundColor={peaTheme.backgroundElement}
        textColor={peaTheme.text}
        focusedTextColor={peaTheme.text}
        cursorColor={peaTheme.primary}
        wrapMode="word"
        keyAliasMap={{ enter: "return", esc: "escape" }}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", ctrl: true, action: "submit" },
          { name: "return", meta: true, action: "submit" },
        ]}
        onSubmit={() => {
          void submit();
        }}
        onContentChange={() => {
          const text = input?.plainText.trimStart() ?? "";
          setMode(text.startsWith("/") ? "command" : "chat");
        }}
      />
    </box>
  );
}
