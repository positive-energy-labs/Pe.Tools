// @vitest-environment jsdom
// Drive 10 fix line 3: the chooser kept the name "Choose a document" after HCB-r9 was chosen.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { DocumentPicker } from "./document-picker";

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

test("the chooser names the chosen document, and asks for one only while none is chosen", () => {
  const props = { place: { address: {} as never }, needs: "project", enabled: true };
  const view = render(<DocumentPicker {...props} target={null} />);
  expect(screen.getByRole("button", { name: "Choose a document" })).toBeTruthy();
  // The e2e bound signal (tests/e2e/cdp.ts BOUND): absent while nothing is bound.
  expect(view.container.querySelector("[data-bound-document]")).toBeNull();
  view.rerender(
    <DocumentPicker
      {...props}
      target={{ kind: "document", ref: { session: "s1", openId: "a" } } as never}
    />,
  );
  expect(screen.getByRole("button", { name: "Document: Chadds-r9; change" })).toBeTruthy();
  expect(view.container.querySelector('[data-bound-document="a"]')).toBeTruthy();
  // A target the connected Revit does not list as open is not bound.
  view.rerender(
    <DocumentPicker
      {...props}
      target={{ kind: "document", ref: { session: "s1", openId: "closed" } } as never}
    />,
  );
  expect(view.container.querySelector("[data-bound-document]")).toBeNull();
});
