// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ChatSituationHead, type ChatHandle, type ChatSituation } from "./composer-head";
import { ThreadComposer } from "./composer";
import { emptyChatState } from "@pe/agent-contracts/chat-state";

const composer = vi.hoisted(() => ({
  mount: "full",
  fileRefusal: null as string | null,
  chat: {},
}));
vi.mock("#/workbench/provider", () => ({
  useWorkbench: () => ({
    chat: composer.chat,
    providers: {},
    config: {},
    currentThreadId: null,
    threads: [],
    draft: {},
  }),
}));
vi.mock("#/navigation/surface-host", () => ({
  useSurfaceHost: () => ({ shell: { mount: composer.mount } }),
}));
vi.mock("./use-attachments", () => ({
  useAttachments: () => ({
    attachments: [],
    refusal: composer.fileRefusal,
    fileInputProps: { type: "file" },
  }),
}));

vi.mock("#/navigation/route-controls", () => ({
  usePublishSituationSignal: () => {},
  useSituationPresentation: () => false,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("Situation exposes and copies immutable identity separately from mutable title, only when selected", () => {
  const id = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard: { writeText } }));
  const handle = { manifest: { key: "chat" } } as ChatHandle;
  const situation = {
    head: { defaultTarget: null, revision: 1, stale: false },
    threadLabel: "A renamed conversation",
    threadId: id,
  } as ChatSituation;
  const view = render(
    <ChatSituationHead
      handle={handle}
      situation={situation}
      status={{ text: "ready", caution: false }}
    />,
  );
  expect(screen.getByText("A renamed conversation")).toBeTruthy();
  expect(screen.getAllByText(id)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Copy thread ID" }));
  expect(writeText).toHaveBeenCalledWith(id);
  view.rerender(
    <ChatSituationHead
      handle={handle}
      situation={{ ...situation, threadLabel: "", threadId: null }}
      status={{ text: "ready", caution: false }}
    />,
  );
  expect(screen.queryByText(id)).toBeNull();
  expect(screen.queryByRole("button", { name: /thread ID/ })).toBeNull();
  expect(screen.getByText("New thread")).toBeTruthy();
});

test.each(["full", "compact"])(
  "%s composer has one refusal footer and a caution Send hint",
  (mount) => {
    composer.mount = mount;
    composer.chat = emptyChatState();
    composer.fileRefusal = null;
    const run = vi.fn(async () => null);
    const action = { label: "Send", says: "Send message", refusal: null, run };
    const handle = {
      manifest: { key: "chat", actions: {} },
      readings: { machine: { state: "absent" }, capabilities: { state: "absent" } },
      busy: null,
      work: { changed: false },
      actions: { send: action, fork: { ...action, label: "Fork" } },
      outcome: { key: "send", at: 1, refusal: { message: "Choose a provider." } },
    } as unknown as ChatHandle;
    const view = render(<ThreadComposer handle={handle} pickers={() => null} />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.getAttribute("data-tone")).toBe("caution");
    expect(send.getAttribute("aria-description")).toBe("Choose a provider.");
    expect(screen.getAllByText("Choose a provider.")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Message" }).nextElementSibling).toBe(
      screen.getByRole("alert"),
    );
    expect(view.container.querySelector("[title]")).toBeNull();
    expect(screen.queryByText(/^(ready|send failed)$/i)).toBeNull();
    fireEvent.click(send);
    expect(run).toHaveBeenCalledTimes(1);
    composer.fileRefusal = "File exceeds 5 MB.";
    view.rerender(<ThreadComposer handle={handle} pickers={() => null} />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe("File exceeds 5 MB.");
  },
);
