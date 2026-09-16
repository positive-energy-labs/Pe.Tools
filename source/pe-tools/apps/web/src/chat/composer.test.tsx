// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { emptyChatState } from "#/workbench/chat-state";
import { afterEach, expect, test, vi } from "vite-plus/test";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));
vi.mock("#/chat/control-chips", () => ({ ControlChips: () => null }));
vi.mock("#/components/master-table/cells", () => ({ StateDot: () => null }));

import { Composer } from "./composer";
import { createChatPageStore } from "#/workbench/store";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("/fork dispatches the native provider verb", () => {
  const registry = AtomRegistry.make();
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", prompt: "/fork", patch: async () => undefined },
  });
  const forkThread = vi.fn(async () => undefined);
  workbench.value = {
    store,
    chat: emptyChatState(),
    sendPrompt: vi.fn(async () => undefined),
    cancel: vi.fn(),
    newThread: vi.fn(),
    forkThread,
    isRunning: false,
  };

  render(
    <RegistryContext.Provider value={registry}>
      <Composer
        setMode={vi.fn()}
        handle={
          {
            actions: {
              send: { label: "send", says: "", refusal: null, count: null, run: vi.fn() },
            },
          } as never
        }
      />
    </RegistryContext.Provider>,
  );
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

  expect(forkThread).toHaveBeenCalledOnce();
  store.dispose();
});

function mount() {
  const registry = AtomRegistry.make();
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", patch: async () => undefined },
  });
  workbench.value = {
    store,
    chat: emptyChatState(),
    sendPrompt: vi.fn(async () => undefined),
    cancel: vi.fn(),
    newThread: vi.fn(),
    forkThread: vi.fn(),
    isRunning: false,
  };
  const view = render(
    <RegistryContext.Provider value={registry}>
      <Composer
        setMode={vi.fn()}
        handle={
          {
            actions: {
              send: { label: "send", says: "", refusal: null, count: null, run: vi.fn() },
            },
          } as never
        }
      />
    </RegistryContext.Provider>,
  );
  const attachments = () => registry.get(store.atoms.draft).attachments;
  return { ...view, store, registry, attachments };
}

const png = (name = "shot.png", bytes = 8) =>
  new File([new Uint8Array(bytes)], name, { type: "image/png" });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

function stubObjectUrls() {
  let next = 0;
  const revoked: string[] = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:preview-${next++}`),
      revokeObjectURL: vi.fn((url: string) => void revoked.push(url)),
    }),
  );
  return revoked;
}

test("pasting an image adds it as an attachment; pasting text stays text", async () => {
  stubObjectUrls();
  const lane = mount();
  const box = screen.getByRole("textbox");
  fireEvent.paste(box, { clipboardData: { files: [png()], types: ["Files"], getData: () => "" } });
  await settle();
  expect(lane.attachments().map((a) => a.name)).toEqual(["shot.png"]);

  const plain = fireEvent.paste(box, {
    clipboardData: { files: [], types: ["text/plain"], getData: () => "hello" },
  });
  await settle();
  expect(plain).toBe(true); // not prevented: the browser pastes the text
  expect(lane.attachments()).toHaveLength(1);
});

test("dropping files on the composer adds them and shows a drop state while dragging", async () => {
  stubObjectUrls();
  const lane = mount();
  const zone = lane.container.querySelector<HTMLElement>("[data-drop-zone]")!;
  expect(zone).toBeTruthy();
  const transfer = { files: [png("a.png")], types: ["Files"] };
  fireEvent.dragEnter(zone, { dataTransfer: transfer });
  fireEvent.dragOver(zone, { dataTransfer: transfer });
  expect(zone.dataset.surface).toBe("recess");
  fireEvent.drop(zone, { dataTransfer: transfer });
  await settle();
  expect(zone.dataset.surface).toBe("artifact");
  expect(lane.attachments().map((a) => a.name)).toEqual(["a.png"]);

  // A file dropped elsewhere on the page must not navigate the tab to it.
  const outside = fireEvent.drop(document.body, { dataTransfer: transfer });
  expect(outside).toBe(false);
});

test("an image chip shows a thumbnail that is revoked when the chip is removed", async () => {
  const revoked = stubObjectUrls();
  const lane = mount();
  fireEvent.paste(screen.getByRole("textbox"), {
    clipboardData: {
      files: [png(), new File(["x".repeat(2048)], "spec.pdf", { type: "application/pdf" })],
      types: ["Files"],
      getData: () => "",
    },
  });
  await settle();
  const thumb = lane.container.querySelector<HTMLImageElement>("img[src='blob:preview-0']");
  expect(thumb).toBeTruthy();
  expect(screen.getByText("spec.pdf")).toBeTruthy();
  expect(screen.getByText("2.0 KB")).toBeTruthy();
  fireEvent.click(screen.getByTitle("Remove shot.png"));
  await settle();
  expect(revoked).toEqual(["blob:preview-0"]);
  expect(lane.attachments().map((a) => a.name)).toEqual(["spec.pdf"]);
});

test("a file over the limit is refused with one caution line naming it", async () => {
  stubObjectUrls();
  const lane = mount();
  fireEvent.paste(screen.getByRole("textbox"), {
    clipboardData: {
      files: [
        png("huge.png", 5 * 1024 * 1024 + 1),
        png("ok.png"),
        png("bigger.png", 6 * 1024 * 1024),
      ],
      types: ["Files"],
      getData: () => "",
    },
  });
  await settle();
  expect(lane.attachments().map((a) => a.name)).toEqual(["ok.png"]);
  const line = lane.container.querySelector("[data-tone='caution']");
  expect(line?.textContent).toContain("huge.png");
  expect(line?.textContent).toContain("5 MB");
  expect(line?.textContent).toContain("bigger.png");

  fireEvent.paste(screen.getByRole("textbox"), {
    clipboardData: {
      files: Array.from({ length: 10 }, (_, i) => png(`p${i}.png`)),
      types: ["Files"],
      getData: () => "",
    },
  });
  await settle();
  expect(lane.attachments()).toHaveLength(10);
  expect(lane.container.querySelector("[data-tone='caution']")?.textContent).toContain("10 files");
});
