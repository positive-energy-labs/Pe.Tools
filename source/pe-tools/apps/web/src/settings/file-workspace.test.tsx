// @vitest-environment jsdom
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ActionButton } from "#/components/lang/action-button";
const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  navigate: vi.fn(),
  location: {
    pathname: "/settings",
    search: { mode: "file", module: "Global", root: "fragments", file: "a.json" } as Record<
      string,
      unknown
    >,
  },
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
}));
vi.mock("#/settings/host", () => ({
  createLiveSettingsHost: () => ({
    open: mocks.open,
    workspaces: async () => [],
    tree: async () => [],
  }),
}));
vi.mock("#/workbench/route-state", () => ({
  useRouteState: () => ({
    hydrated: true,
    slice: { basis: { versionToken: "v1" } },
    revision: 1,
    command: vi.fn(),
  }),
}));
vi.mock("#/route", () => ({ RouteShell: () => <span>File picker</span> }));
import { FileWorkspace } from "#/settings/file-workspace";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const snapshot = (file: string) => ({
  documentId: { moduleKey: "Global", rootKey: "fragments", relativePath: file },
  workspaceId: file,
  path: file,
  rawContent: "{}",
  versionToken: "v1",
  validation: { isValid: true, issues: [] },
});
test("one subject-owned read ignores late selections, hides old Work during back/read failure, and select only navigates", async () => {
  const requests: Array<{
    file: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }> = [];
  mocks.open.mockImplementation(
    (id) =>
      new Promise((resolve, reject) => requests.push({ file: id.relativePath, resolve, reject })),
  );
  mocks.navigate.mockImplementation(async ({ search }) => {
    mocks.location = { ...mocks.location, search: search(mocks.location.search) };
  });
  const ui = () => (
    <FileWorkspace>
      {(scope, select) => (
        <div>
          <span>Work {scope.work}</span>
          <ActionButton
            label="Select B"
            reason="Navigate to the selected file"
            onClick={() => void select(snapshot("b.json").documentId)}
          />
        </div>
      )}
    </FileWorkspace>
  );
  const view = render(ui());
  expect(requests.map((row) => row.file)).toEqual(["a.json"]);
  await act(async () => requests[0].resolve(snapshot("a.json")));
  expect(screen.getByText("Work a.json")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByText("Select B")));
  expect(requests).toHaveLength(1);
  view.rerender(ui());
  expect(screen.queryByText("Work a.json")).toBeNull();
  mocks.location = { ...mocks.location, search: { ...mocks.location.search, file: "c.json" } };
  view.rerender(ui());
  await act(async () => requests[2].resolve(snapshot("c.json")));
  await act(async () => requests[1].resolve(snapshot("b.json")));
  expect(screen.getByText("Work c.json")).toBeTruthy();
  expect(mocks.location.search.file).toBe("c.json");
  mocks.location = { ...mocks.location, search: { ...mocks.location.search, file: "a.json" } };
  view.rerender(ui());
  expect(screen.queryByText("Work c.json")).toBeNull();
  await act(async () => requests[3].reject(new Error("deleted on disk")));
  expect(screen.queryByText("Work a.json")).toBeNull();
  expect(screen.getByText("deleted on disk", { exact: false })).toBeTruthy();
  expect(requests.map((row) => row.file)).toEqual(["a.json", "b.json", "c.json", "a.json"]);
});
