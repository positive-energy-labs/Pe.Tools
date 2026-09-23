import { browserActionSays } from "@pe/agent-contracts";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Activity, useState } from "react";
import { emptyChatState } from "#/workbench/chat-state";
import { afterEach, expect, test, vi } from "vite-plus/test";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));
vi.mock("#/components/master-table/cells", () => ({ StateDot: () => null }));

import { ThreadComposer } from "./composer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the slash menu offers skills only; built-in commands are gone", () => {
  const lane = mount({ skills: [{ name: "audit", description: "Audit the model" }] });
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: "/" } });
  const options = screen.getAllByRole("option").map((option) => option.textContent);
  expect(options).toEqual(["/auditAudit the model"]);
  fireEvent.change(box, { target: { value: "/fork" } });
  expect(screen.queryByRole("listbox")).toBe(null);
  lane.unmount();
});

test("the slash menu's keys are the list's: ↓ and Enter pick without sending; Escape closes", async () => {
  const send = vi.fn(async () => null);
  const lane = mount({
    skills: [
      { name: "audit", description: "Audit the model" },
      { name: "author", description: "Write a family" },
    ],
    send,
  });
  const box = screen.getByRole("textbox");
  await act(async () => box.focus());
  await act(async () => fireEvent.change(box, { target: { value: "/au" } }));
  await act(async () => fireEvent.keyDown(box, { key: "ArrowDown" }));
  await act(async () => fireEvent.keyDown(box, { key: "ArrowDown" }));
  expect(box.getAttribute("aria-activedescendant")).toBeTruthy();
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
  expect((box as HTMLTextAreaElement).value).toBe("Use the author skill: ");
  expect(send).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(box);
  await act(async () => fireEvent.change(box, { target: { value: "/" } }));
  expect(screen.getByRole("listbox")).toBeTruthy();
  await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
  expect(screen.queryByRole("listbox")).toBe(null);
  lane.unmount();
});

const newAction = {
  label: "new",
  says: browserActionSays.memberOpen,
  refusal: null,
  count: null,
  run: vi.fn(),
};

function mount({
  skills = [] as { name: string; description: string }[],
  send = vi.fn(async (): Promise<{ code: "not-ready"; message: string } | null> => null),
} = {}) {
  workbench.value = {
    chat: { ...emptyChatState(), inspect: { skills } },
    sendPrompt: vi.fn(async () => undefined),
    cancel: vi.fn(),
    isRunning: false,
    setModel: vi.fn(async () => undefined),
    setAccessLevel: vi.fn(async () => undefined),
    addApiKey: vi.fn(async () => undefined),
  };
  const view = render(
    <ThreadComposer
      handle={
        {
          actions: {
            send: {
              label: "send",
              says: browserActionSays.chatSend,
              refusal: null,
              count: null,
              run: send,
            },
            new: newAction,
            fork: {
              label: "fork",
              says: browserActionSays.memberOpen,
              refusal: "No thread to fork",
              count: null,
              run: vi.fn(),
            },
          },
          outcome: null,
          busy: null,
        } as never
      }
    />,
  );
  const attachments = () =>
    Array.from(view.container.querySelectorAll("[title$='is attached to the next message']")).map(
      (chip) => chip.getAttribute("title")?.replace(" is attached to the next message", ""),
    );
  return { ...view, attachments };
}

test("composer Pane lists its real keys without replacing textarea Enter", () => {
  const send = vi.fn(async () => null);
  const lane = mount({ send });
  const pane = lane.container.querySelector<HTMLElement>("[data-pane-id='composer']")!;
  const box = screen.getByRole<HTMLTextAreaElement>("textbox");

  act(() => pane.focus());
  expect(screen.getByLabelText("composer keyboard shortcuts").textContent).toContain(
    "send message",
  );
  expect(screen.getByLabelText("composer keyboard shortcuts").textContent).toContain(
    "skill commands",
  );
  fireEvent.keyDown(pane, { key: "/", code: "Slash" });
  expect(box.value).toBe("/");

  fireEvent.change(box, { target: { value: "send this" } });
  fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
  expect(send).toHaveBeenCalledOnce();
  const attach = screen.getByTitle("Attach files");
  act(() => attach.focus());
  const nativeEnter = (button: HTMLElement) => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);
    if (!event.defaultPrevented) fireEvent.click(button);
    return event;
  };
  const fileInput = lane.container.querySelector<HTMLInputElement>("input[type='file']")!;
  const openFiles = vi.spyOn(fileInput, "click");
  expect(nativeEnter(attach).defaultPrevented).toBe(false);
  expect(openFiles).toHaveBeenCalledOnce();
  const model = screen.getByTitle("Model");
  expect(nativeEnter(model).defaultPrevented).toBe(false);
  expect(model.getAttribute("aria-expanded")).toBe("true");
  expect(send).toHaveBeenCalledOnce();
  act(() => box.focus());
  expect(fireEvent.keyDown(box, { key: "Enter", code: "Enter", isComposing: true })).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(fireEvent.keyDown(box, { key: "Enter", code: "Enter", shiftKey: true })).toBe(true);
  expect(send).toHaveBeenCalledOnce();
});

test("refused Enter records the refusal and keeps the draft", async () => {
  const refusal = { code: "not-ready", message: "Session is not ready" } as const;
  const send = vi.fn(async () => refusal);
  mount({ send });
  const box = screen.getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(box, { target: { value: "keep this" } });
  fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
  await settle();
  expect(send).toHaveBeenCalledWith({ text: "keep this", attachments: undefined });
  expect(box.value).toBe("keep this");
});

const png = (name = "shot.png", bytes = 8) =>
  new File([new Uint8Array(bytes)], name, { type: "image/png" });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

test("pasting an image adds it as an attachment; pasting text stays text", async () => {
  const lane = mount();
  const box = screen.getByRole("textbox");
  fireEvent.paste(box, { clipboardData: { files: [png()], types: ["Files"], getData: () => "" } });
  await settle();
  expect(lane.attachments()).toEqual(["shot.png"]);

  const plain = fireEvent.paste(box, {
    clipboardData: { files: [], types: ["text/plain"], getData: () => "hello" },
  });
  await settle();
  expect(plain).toBe(true); // not prevented: the browser pastes the text
  expect(lane.attachments()).toHaveLength(1);
});

test("dropping files on the composer adds them and shows a drop state while dragging", async () => {
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
  expect(lane.attachments()).toEqual(["a.png"]);

  // A file dropped elsewhere on the page must not navigate the tab to it.
  const outside = fireEvent.drop(document.body, { dataTransfer: transfer });
  expect(outside).toBe(false);
});

test("an image chip renders held bytes and needs no object URL cleanup", async () => {
  const lane = mount();
  fireEvent.paste(screen.getByRole("textbox"), {
    clipboardData: {
      files: [png(), new File(["x".repeat(2048)], "spec.pdf", { type: "application/pdf" })],
      types: ["Files"],
      getData: () => "",
    },
  });
  await settle();
  const thumb = lane.container.querySelector<HTMLImageElement>(
    "img[src^='data:image/png;base64,']",
  );
  expect(thumb).toBeTruthy();
  expect(screen.getByText("spec.pdf")).toBeTruthy();
  expect(screen.getByText("2.0 KB")).toBeTruthy();
  fireEvent.click(screen.getByTitle("Remove shot.png"));
  await settle();
  expect(lane.attachments()).toEqual(["spec.pdf"]);
});

test("a file over the limit is refused with one caution line naming it", async () => {
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
  expect(lane.attachments()).toEqual(["ok.png"]);
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

test("new and fork sit in the control row as route actions, refusals shown the same way", () => {
  const lane = mount();
  const row = screen.getByTitle("Attach files").parentElement!;
  const fresh = within(row).getByRole("button", { name: "new" });
  const fork = within(row).getByRole("button", { name: "fork" });
  expect(fresh.getAttribute("aria-disabled")).toBe("false");
  expect(fork.getAttribute("aria-disabled")).toBe("true");
  expect(fork.getAttribute("title")).toBe("No thread to fork");
  fireEvent.click(fresh);
  expect(newAction.run).toHaveBeenCalledOnce();
  lane.unmount();
});

test("Activity retains each visited thread draft without sharing it", () => {
  function Bank() {
    const [active, setActive] = useState("A");
    return (
      <>
        <button onClick={() => setActive("A")}>thread A</button>
        <button onClick={() => setActive("B")}>thread B</button>
        {(["A", "B"] as const).map((thread) => (
          <Activity key={thread} mode={active === thread ? "visible" : "hidden"}>
            <ThreadComposer
              handle={
                {
                  actions: {
                    send: {
                      label: "send",
                      says: browserActionSays.chatSend,
                      refusal: null,
                      count: null,
                      run: vi.fn(),
                    },
                    new: newAction,
                    fork: { ...newAction, label: "fork" },
                  },
                } as never
              }
            />
          </Activity>
        ))}
      </>
    );
  }
  workbench.value = { chat: emptyChatState(), isRunning: false };
  render(<Bank />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft A" } });
  fireEvent.click(screen.getByRole("button", { name: "thread B" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft B" } });
  fireEvent.click(screen.getByRole("button", { name: "thread A" }));
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("draft A");
});

test("a late send clears only its exact submitted draft", async () => {
  let settleSend!: (result: null) => void;
  const run = vi.fn(
    () =>
      new Promise<null>((resolve) => {
        settleSend = resolve;
      }),
  );
  workbench.value = { chat: emptyChatState(), isRunning: false };
  render(
    <ThreadComposer
      handle={
        {
          actions: {
            send: {
              label: "send",
              says: browserActionSays.chatSend,
              refusal: null,
              count: null,
              run,
            },
            new: newAction,
            fork: { ...newAction, label: "fork" },
          },
        } as never
      }
    />,
  );
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: "sent" } });
  fireEvent.click(screen.getByRole("button", { name: "send" }));
  fireEvent.change(box, { target: { value: "later edit" } });
  await act(async () => settleSend(null));
  expect((box as HTMLTextAreaElement).value).toBe("later edit");
});
