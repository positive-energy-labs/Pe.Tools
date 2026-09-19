// @vitest-environment jsdom
/**
 * Chat's schedules pane is the page's own view (`route-panes.tsx`: framed, url off), so a stale
 * key (`basis.stale`) draws there as it does on /schedules: drift against Revit's value now, and
 * answered by the cell's own transitions — accept (the contract's `stage`) and deny (`unstage`) —
 * through the same write that drops the key. Real host fixture lane.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { appAtomRegistry } from "#/route";
import { setup } from "../../../../host/tests/schedule-test-fixture";
import { LiveScheduleGridWorkspace } from "./live";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));

const sources: { close(): void }[] = [];
afterEach(() => {
  cleanup();
  for (const source of sources.splice(0)) source.close();
});

function stubBrowser(app: { fetch: (request: Request) => Response | Promise<Response> }) {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage: EventSource["onmessage"] = null;
      onerror: EventSource["onerror"] = null;
      onopen: EventSource["onopen"] = null;
      closed = false;
      abort = new AbortController();
      constructor(url: string) {
        sources.push(this);
        void (async () => {
          const response = await app.fetch(
            new Request(new URL(url, "http://host"), { signal: this.abort.signal }),
          );
          const reader = response.body!.getReader();
          this.onopen?.call(this as unknown as EventSource, new Event("open"));
          try {
            while (!this.closed) {
              const next = await reader.read();
              if (next.done) break;
              this.onmessage?.call(
                this as unknown as EventSource,
                new MessageEvent("message", {
                  data: new TextDecoder().decode(next.value).slice(6),
                }),
              );
            }
          } catch {
            /* closing cancels production stream */
          }
        })();
      }
      close() {
        this.closed = true;
        this.abort.abort();
      }
    },
  );
}

/** The stale row's StateCell in the pending list: its drift body, and the line it draws on. */
const staleCell = async () => {
  const list = await screen.findByRole("list", { name: "pending cells" }, { timeout: 10_000 });
  const drift = await within(list).findByText("150 VA", {
    selector: '[data-state="drift"]',
  });
  // The line the cell draws its body and verbs on (at row scale, the cell itself).
  return (drift.closest(".dl-cell-line") ?? drift.closest(".dl-cell"))! as HTMLElement;
};

test("Chat's schedules pane draws a stale key as drift, answered by the cell's own accept and deny", async () => {
  const f = await setup(); // 1::2 staged "150 VA"; Revit holds "100 VA"
  const markStale = async () => {
    const { captureId } = (await f.view()).doc.basis!;
    expect(
      await f.patch([
        { path: ["basis"], value: { captureId, stale: [{ key: "1::2", was: "100 VA" }] } },
      ]),
    ).toMatchObject({ ok: true });
  };
  await markStale();
  stubBrowser(f.app);
  // Chat's own mount (`route-panes.tsx`); the target is pinned instead of a thread head.
  const target = JSON.stringify({ kind: "open", ref: f.b });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <LiveScheduleGridWorkspace
          framed
          url={false}
          thread="t-stale"
          workspaceId={f.scope.work}
          target={target}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/chat"] }),
  });
  await router.load();
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );

  // Drift against Revit's value now, with the ruled verbs IN the cell.
  let cell = await staleCell();
  const accept = within(cell).getByRole("button", { name: "accept" });
  expect(accept.title).toBe("Accept to stage it again over what Revit holds now.");
  expect(within(cell).getByRole("button", { name: "deny" }).title).toBe(
    "Drop your stale value; the Revit value stands.",
  );
  expect(within(cell).getByText("100 VA").title).toBe("the value the model currently holds");

  // Accept stages the value again and the key leaves `basis.stale`, in one write.
  await act(async () => fireEvent.click(accept));
  await vi.waitFor(async () => expect((await f.view()).doc.basis).not.toHaveProperty("stale"));
  expect((await f.view()).doc.cells["1::2"].staged).toEqual({ value: "150 VA" });

  // Deny drops the stale value: Revit's stands, and the key leaves `basis.stale`.
  await markStale();
  cell = await staleCell();
  await act(async () => fireEvent.click(within(cell).getByRole("button", { name: "deny" })));
  await vi.waitFor(async () =>
    expect((await f.view()).doc.cells["1::2"]?.staged ?? null).toBeNull(),
  );
  expect((await f.view()).doc.basis).not.toHaveProperty("stale");
}, 30_000);
