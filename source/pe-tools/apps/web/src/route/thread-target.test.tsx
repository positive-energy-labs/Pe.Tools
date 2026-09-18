// @vitest-environment jsdom
/**
 * The thread head is the one target store (ledger 2026-09-17): the URL carries the thread across
 * every link, a route resolves its document from that thread's head, the ladder writes the head,
 * and a `?target` pin is a view that never writes it.
 */
// First: the mocked `./shell` must be the one `./situation` binds (the two import each other).
import { useDocumentLadder } from "./situation";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createMemoryHistory, createRoute, createRouter } from "@tanstack/react-router";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import { peReadings } from "#/readings";
import { Route as rootRoute } from "#/routes/__root";
import { familySearch } from "#/routes/family";
import { schedulesSearch } from "#/routes/schedules";
import { familyManifest } from "./family/manifest";
import { schedulesManifest } from "./schedules/manifest";
import { useRoute } from "./use-route";

const url = vi.hoisted(() => ({ pin: null as string | null, choose: vi.fn() }));
vi.mock("./shell", async (original) => ({
  ...(await original<typeof import("./shell")>()),
  useChooseTarget: () => [url.pin, url.choose],
}));
const choose = url.choose;

const A = { session: "A", openId: "doc-A" };
const TOWER = address("C:/demo/tower.rvt");
const B = { session: "A", openId: "doc-B" };
const inventory = {
  sessions: [
    {
      connected: true,
      sessionId: "A",
      sdkSessionId: "rvt-1",
      openDocumentCount: 2,
      openDocuments: [
        { openId: "doc-A", title: "Tower", address: TOWER, isFamilyDocument: false },
        { openId: "doc-B", title: "Annex", address: null, isFamilyDocument: false },
      ],
    },
  ],
};

/** Every Reading subscription the kernel makes, and a way to answer each kind. */
function stream() {
  const accept = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  const requests: unknown[] = [];
  const spy = vi.spyOn(peReadings, "subscribe").mockImplementation((request, next) => {
    requests.push(request);
    accept.set(request.kind, next);
    return () => {};
  });
  const answer = (kind: string, value: unknown) =>
    act(() => accept.get(kind)?.({ kind: "snapshot", key: kind, value } as never));
  return { spy, requests, answer };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  choose.mockReset();
  url.pin = null;
});

function router(url: string) {
  const child = (path: string, validateSearch?: (search: Record<string, unknown>) => object) =>
    createRoute({ getParentRoute: () => rootRoute, path, validateSearch });
  return createRouter({
    routeTree: rootRoute.addChildren([
      child("/pods"),
      child("/chat"),
      child("/family", familySearch),
      child("/schedules", schedulesSearch),
    ]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
}

test("/pods → /family carries the thread, so /family reads the same document", () => {
  // The `open in Family` link names only the member; the root carries the thread and the pin.
  const next = router("/pods?thread=T&pod=p&path=settings/family/box.json").buildLocation({
    to: "/family",
    search: { stage: "apply", pod: "p", path: "settings/family/box.json" } as never,
  });
  expect(next.search).toMatchObject({ thread: "T", stage: "apply", pod: "p" });
  const pinned = router("/pods?thread=T&target=rvt-1").buildLocation({
    to: "/family",
    search: { stage: "apply" } as never,
  });
  expect(pinned.search).toMatchObject({ thread: "T", target: "rvt-1" });

  const { requests, answer } = stream();
  const { result } = renderHook(() =>
    useRoute(familyManifest(), { thread: (next.search as { thread: string }).thread }),
  );
  answer("inventory", inventory);
  answer("thread-head", { defaultTarget: { kind: "open", ref: A }, revision: 3 });
  expect(requests).toContainEqual({ kind: "thread-head", thread: "T" });
  expect(result.current.resolution).toMatchObject({ kind: "resolved", target: { ref: A } });
  // The /family draft keys on the resolved target (w9-draft); the head is what resolves it.
  expect(result.current.work.key).toMatchObject({ route: "family", target: TOWER });
});

test("/chat → /schedules carries the thread's document", () => {
  const next = router("/chat?thread=T2").buildLocation({ to: "/schedules" });
  expect(next.search).toMatchObject({ thread: "T2" });

  const { answer } = stream();
  const { result } = renderHook(() => useRoute(schedulesManifest(), { thread: "T2" }));
  answer("inventory", inventory);
  answer("thread-head", { defaultTarget: { kind: "open", ref: B }, revision: 1 });
  expect(result.current.resolution).toMatchObject({ kind: "resolved", target: { ref: B } });
});

test("/schedules reload keeps the document and the open schedule", () => {
  // The reload reads back what the route wrote: the thread and the open schedule's reading.
  const search = schedulesSearch({ thread: "T3", schedule: "W-1", stage: "capture" });
  expect(search).toMatchObject({ thread: "T3", schedule: "W-1" });

  const { requests, answer } = stream();
  const { result } = renderHook(() =>
    useRoute(schedulesManifest(), {
      thread: search.thread,
      page: { workspaceId: search.schedule },
      work: (page, target) => (target ? page.workspaceId || undefined : undefined),
    }),
  );
  answer("inventory", inventory);
  answer("thread-head", { defaultTarget: { kind: "open", ref: A }, revision: 2 });
  expect(result.current.resolution).toMatchObject({ kind: "resolved", target: { ref: A } });
  expect(requests).toContainEqual({ kind: "schedule-reading", subject: "work", id: "W-1" });
  expect(result.current.page[0].workspaceId).toBe("W-1");
});

test("a ?target pin is a view: it wins the route and never writes the head; a pick does", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          why: "set",
          head: { defaultTarget: { kind: "open", ref: B }, revision: 4 },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  url.pin = JSON.stringify({ kind: "open", ref: B });
  const { answer } = stream();
  const { result } = renderHook(() => {
    const handle = useRoute(familyManifest(), { thread: "T4", target: url.pin });
    return { handle, ladder: useDocumentLadder(handle) };
  });
  answer("inventory", inventory);
  answer("thread-head", { defaultTarget: { kind: "open", ref: A }, revision: 3 });
  // The pin names Annex; the thread still names Tower, and nothing was written.
  expect(result.current.handle.resolution).toMatchObject({ target: { ref: B } });
  expect(fetch).not.toHaveBeenCalled();
  expect(choose).not.toHaveBeenCalled();

  // A ladder pick moves the thread (a PUT on its head) and drops the pin, not a `?target` write.
  await act(async () => {
    result.current.ladder.levels[1]!.pick!("doc-A");
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(choose).toHaveBeenCalledWith(null));
  expect(fetch).toHaveBeenCalledTimes(1);
  const [href, init] = fetch.mock.calls[0] as unknown as [string, { body: string }];
  expect(href).toContain("/scope/T4");
  expect(JSON.parse(init.body)).toEqual({
    defaultTarget: { kind: "open", ref: A },
    expectedRevision: 3,
  });
});

test("the ladder refuses in the head's own words while a Pea turn holds the thread", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false, why: "in-turn" }), { status: 409 })),
  );
  const { answer } = stream();
  const { result } = renderHook(() => {
    const handle = useRoute(familyManifest(), { thread: "T5" });
    return { handle, ladder: useDocumentLadder(handle) };
  });
  answer("inventory", inventory);
  answer("thread-head", { defaultTarget: { kind: "open", ref: A }, revision: 3 });
  await act(async () => {
    result.current.ladder.levels[1]!.pick!("doc-B");
  });
  await vi.waitFor(() =>
    expect(result.current.ladder.refusal).toBe(
      "pea is mid-turn; the turn keeps the target it was admitted under. Wait or stop it.",
    ),
  );
  expect(choose).not.toHaveBeenCalled();
});
