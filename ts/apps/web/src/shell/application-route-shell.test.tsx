// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DocumentPicker } from "./application-route-shell";
import type { PanePlace } from "./admitted-pane";
const inventory = vi.hoisted(() => ({ state: "ready", observation: { sessions: [{
  connected: true, sessionId: "bridge-one", processId: 1, sdkSessionId: "ke277",
  openDocumentCount: 2, openDocuments: [
    { openId: "project-one", title: "Project A", isFamilyDocument: false },
    { openId: "family-one", title: "Family A", isFamilyDocument: true },
  ],
}] } }));
vi.mock("./readings-hooks", async (original) => ({
  ...await original<typeof import("./readings-hooks")>(), useInventory: () => inventory,
}));
afterEach(cleanup);

test("choosing a document pins one exact lifetime, preserving this Place's subject and history", async () => {
  const write = vi.fn();
  const place = { fixture: null, address: { read: () => new URLSearchParams("system=SA&thread=chat"), write } } as unknown as PanePlace;
  render(<DocumentPicker place={place} target={null} needs="project" enabled />);
  fireEvent.click(screen.getByRole("button", { name: "Choose a document" }));
  expect(screen.queryByText("Family A")).toBeNull();
  fireEvent.click(await screen.findByText("Project A"));
  expect(write).toHaveBeenCalledOnce();
  const [search, mode] = write.mock.calls[0]!;
  expect(mode).toBe("push");
  expect(search.get("system")).toBe("SA");
  expect(search.get("thread")).toBe("chat");
  expect(JSON.parse(search.get("target"))).toEqual({ kind: "open", ref: { session: "bridge-one", openId: "project-one" } });
});
