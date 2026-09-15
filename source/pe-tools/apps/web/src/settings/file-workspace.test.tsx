// @vitest-environment jsdom
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ActionButton } from "#/components/lang/action-button";
const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  openWork: vi.fn(),
  adoptWork: vi.fn(),
  workDoc: { basis: { versionToken: "v1" } } as { basis: { versionToken: string } } | null,
  workCurrent: true,
  workRevision: 1 as number | null,
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
vi.mock("#/route", async (original) => ({
  ...(await original<typeof import("#/route")>()),
  useRoute: () => ({
    work: { doc: mocks.workDoc, revision: mocks.workRevision, current: mocks.workCurrent },
    actions: {
      open: { run: mocks.openWork },
      adopt: { run: mocks.adoptWork },
    },
    failure: null,
  }),
}));
import { FileWorkspace } from "#/settings/file-workspace";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.workDoc = { basis: { versionToken: "v1" } };
  mocks.workCurrent = true;
  mocks.workRevision = 1;
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
      {(scope, select, observation) => (
        <div>
          <span>Work {scope.work}</span>
          <span>Profile {observation.reading.state}</span>
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
  expect(screen.getByText("Profile ready")).toBeTruthy();
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

test("a file refresh exposes stale and failed Reading lifecycle", async () => {
  let rejectRefresh!: (error: Error) => void;
  mocks.open
    .mockResolvedValueOnce(snapshot("a.json"))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => void (rejectRefresh = reject)));
  render(
    <FileWorkspace>
      {(_scope, _select, observation) => (
        <>
          <span>Profile {observation.reading.state}</span>
          {observation.reading.state === "failed" ? (
            <span>{observation.reading.message}</span>
          ) : null}
          <ActionButton
            label="Refresh profile"
            reason="Observe the current file"
            onClick={() => void observation.refresh()}
          />
        </>
      )}
    </FileWorkspace>,
  );
  expect(await screen.findByText("Profile ready")).toBeTruthy();
  fireEvent.click(screen.getByText("Refresh profile"));
  expect(screen.getByText("Profile stale")).toBeTruthy();
  await act(async () => rejectRefresh(new Error("unreadable")));
  expect(screen.getByText("Profile failed")).toBeTruthy();
  expect(screen.getByText("unreadable", { exact: false })).toBeTruthy();
});

test("authoritative absent Work opens the selected file and projects it through the shared handle", async () => {
  mocks.workDoc = null;
  mocks.workRevision = null;
  mocks.open.mockResolvedValueOnce(snapshot("a.json"));
  const ui = () => (
    <FileWorkspace>
      {(_scope, _select, observation, handle) => (
        <span>
          {handle.work.doc?.basis
            ? `Authoring ${observation.reading.state === "ready" ? observation.reading.observation.path : ""}`
            : "choose a family file"}
        </span>
      )}
    </FileWorkspace>
  );
  const view = render(ui());
  await screen.findByText("choose a family file");
  await waitFor(() =>
    expect(mocks.openWork).toHaveBeenCalledWith({ documentId: snapshot("a.json").documentId }),
  );

  mocks.workDoc = { basis: { versionToken: "v1" } };
  mocks.workRevision = 1;
  view.rerender(ui());
  expect(screen.getByText("Authoring a.json")).toBeTruthy();
});
