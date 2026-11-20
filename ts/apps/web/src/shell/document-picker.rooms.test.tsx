// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { DocumentPicker } from "./document-picker";
import { module as rooms } from "@pe/rooms-web/routes/rooms";
const FLOOR = "8a0c1e3f-0000-4000-8000-000000000001-000026dc";

vi.mock("../host/resource-state", async (original) => ({
  ...(await original<typeof import("../host/resource-state")>()),
  useInventory: () => ({
    state: "ready",
    observation: {
      sessions: [
        {
          sessionId: "s1",
          connected: true,
          processId: 1,
          openDocuments: [
            { openId: "a", title: "Chadds-r9", isFamilyDocument: false },
            { openId: "b", title: "Snowdon", isFamilyDocument: false },
          ],
        },
      ],
    },
  }),
}));
afterEach(cleanup);

test("switching Rooms documents leaves the old plan behind in the same history entry", async () => {
  const write = vi.fn<(search: URLSearchParams, history: "push" | "replace") => void>();
  const ref = { session: "s1", openId: "a" };
  render(
    <DocumentPicker
      place={{
        address: {
          read: () =>
            new URLSearchParams({ view: JSON.stringify(FLOOR), stage: "review" }),
          write,
          subscribe: () => () => {},
        },
      }}
      target={{ kind: "document", ref }}
      needs="project"
      enabled
      page={rooms.spec}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Document: Chadds-r9; change" }));
  fireEvent.click(await screen.findByRole("option", { name: /Snowdon/ }));
  expect(write).toHaveBeenCalledTimes(1);
  const [search, history] = write.mock.calls[0] ?? [];
  expect(history).toBe("push");
  // A plan belongs to its document: the other document starts at an explicit choice.
  expect(search?.get("view")).toBe(JSON.stringify(""));
  expect(search?.get("stage")).toBe("review");
  expect(search?.get("target")).toBe(
    JSON.stringify({
      kind: "open",
      ref: { session: "s1", openId: "b" },
    }),
  );
});
