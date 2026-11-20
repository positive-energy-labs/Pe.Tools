import { fireEvent, render, screen } from "@testing-library/react";
import { expect, vi } from "vite-plus/test";
import { DocumentPicker } from "../../apps/web/src/shell/document-picker";
import { ref } from "./mounted.test-support.tsx";

export const otherRef = { ...ref, openId: "other" };
vi.mock("../../apps/web/src/host/resource-state", async (original) => ({
  ...(await original<typeof import("../../apps/web/src/host/resource-state")>()),
  useInventory: () => ({
    state: "ready",
    observation: {
      sessions: [
        {
          sessionId: ref.session,
          connected: true,
          processId: 1,
          openDocuments: [
            { openId: ref.openId, title: "Chadds", isFamilyDocument: false },
            { openId: otherRef.openId, title: "Snowdon", isFamilyDocument: false },
          ],
        },
      ],
    },
  }),
}));

export async function switchDocument(
  page: Parameters<typeof DocumentPicker>[0]["page"],
  read: () => URLSearchParams,
) {
  const write = vi.fn<(search: URLSearchParams, history: "push" | "replace") => void>();
  const picker = render(
    <DocumentPicker
      place={{ address: { read, write, subscribe: () => () => {} } }}
      target={{ kind: "document", ref }}
      needs="project"
      enabled
      page={page}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Document: Chadds; change" }));
  fireEvent.click(await screen.findByText("Snowdon", { exact: true }));
  expect(write).toHaveBeenCalledTimes(1);
  const [search, history] = write.mock.calls[0]!;
  expect(history).toBe("push");
  expect(JSON.parse(search.get("target")!)).toEqual({ kind: "open", ref: otherRef });
  picker.unmount();
  return search;
}
