// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ChatSituationHead, type ChatHandle, type ChatSituation } from "./composer-head";

vi.mock("#/navigation/route-controls", () => ({ usePublishSituationSignal: () => {} }));
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
