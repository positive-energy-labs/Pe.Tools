// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { render, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionJournal, ActionIncomplete } from "../../../host/src/action-journal";
import { RevitBridge } from "../../../host/src/bridge";
import { TakeoffCaptures } from "../../../host/src/takeoff-captures";
import { makeCallRoute } from "../../../host/src/call-route";
import { ActionReceipts, ActionReceiptView } from "./receipt";
import { readScopedActionStatuses } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { peReadings } from "#/readings";
vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
// This host harness has no browser SSE transport; Chrome verifies streamed progress.
beforeEach(() => {
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const connectReceiptReadings = (owner: ActionJournal) =>
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind !== "receipts" || !request.id) throw Error("Expected one receipt subject");
    return owner.observe(undefined, request.id, (result) =>
      accept(
        "error" in result
          ? { kind: "failure", key: request.id!, error: result.error }
          : { kind: "snapshot", key: request.id!, value: result.value },
      ),
    );
  });

test("real host receipt list remounts original controls without dispatch and isolates file/lifetime subjects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-action-surface-"));
  const path = join(dir, "actions.json");
  let owner = new ActionJournal(path);
  let effects = 0;
  const target = { session: "B", openId: "original-B" };
  const a = { kind: "file" as const, workspaceId: "settings:a" };
  const b = { kind: "file" as const, workspaceId: "settings:b" };
  for (const [id, key, destination, state] of [
    ["file-incomplete", "settings.write", { kind: "host" }, "incomplete"],
    ["file-unknown", "settings.write", { kind: "host" }, "unknown"],
    ["native-unknown", "family.build", { kind: "document", ref: target }, "unknown"],
  ] as const) {
    await owner.admit(
      {
        id,
        key,
        kind: "workflow",
        actor: "human",
        destination,
        input: { workspaceId: key === "family.build" ? b.workspaceId : a.workspaceId },
        bases: {},
      },
      async () => ({}),
      async (execution) => {
        await execution.step("file", "fixture-effect", {}, async () => {
          effects++;
          if (state === "unknown") throw Error("missing receipt");
          return { written: true };
        });
        throw new ActionIncomplete("publication refused", {});
      },
    );
    await owner.wait(id);
  }
  owner = new ActionJournal(path);
  const bridge = {
    list: Effect.succeed([]),
    invoke: () => Effect.die("No native dispatch allowed"),
  } as unknown as RevitBridge["Service"];
  const web = HttpRouter.toWebHandler(
    makeCallRoute(owner, new TakeoffCaptures(join(dir, "captures"))).pipe(
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ),
    { disableLogger: true },
  );
  const requests: { method: string; path: string }[] = [];
  let unavailable = false;
  connectReceiptReadings(owner);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://direct-host");
    requests.push({ method: init?.method ?? "GET", path: url.pathname });
    if (unavailable) throw Error("host unavailable");
    return web.handler(new Request(url, init), Context.empty() as never);
  });
  const view = (scope: typeof a, lastId?: string) => (
    <ActionReceipts scope={scope} lastId={lastId} />
  );
  try {
    const mounted = render(view(a));
    await screen.findByText(/Action file-unknown \/ unknown/);
    await screen.findByText(/Action file-incomplete \/ incomplete/);
    expect(screen.queryByText(/Action native-unknown/)).toBeNull();
    const panels = screen.getByRole("region", { name: "Actions for this selection" });
    expect(within(panels).getAllByText("resume original action")).toHaveLength(2);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    expect(effects).toBe(3);
    const requestsBeforeEquivalentScope = requests.length;
    mounted.rerender(view({ ...a }));
    expect(requests).toHaveLength(requestsBeforeEquivalentScope);
    mounted.unmount();
    render(view(a));
    await screen.findByText(/Action file-unknown \/ unknown/);
    expect(effects).toBe(3);
    cleanup();
    render(view(b, "file-unknown"));
    await screen.findByText("No unresolved actions for this selection");
    expect(screen.queryByText(/Action file-unknown/)).toBeNull();
    cleanup();
    expect(
      (await readScopedActionStatuses({ kind: "family", workspaceId: b.workspaceId, target })).map(
        (r) => r.id,
      ),
    ).toEqual(["native-unknown"]);
    expect(
      (
        await readScopedActionStatuses({
          kind: "family",
          workspaceId: b.workspaceId,
          target: { ...target, openId: "reopened" },
        })
      ).map((r) => r.id),
    ).toEqual([]);
    expect(
      (await readScopedActionStatuses({ kind: "family-file", workspaceId: b.workspaceId })).map(
        (row) => row.id,
      ),
    ).toEqual(["native-unknown"]);
    const page = await web.handler(
      new Request("http://direct-host/family"),
      Context.empty() as never,
    );
    expect(page.status).toBe(404);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await owner.admit(
      {
        id: "running-original",
        key: "settings.write",
        kind: "workflow" as const,
        actor: "human",
        destination: { kind: "host" },
        input: { workspaceId: "settings:c" },
        bases: {},
      },
      async () => ({}),
      async (execution) => {
        await execution.step("file", "held-fixture", {}, async () => {
          await held;
          throw Error("lost external response");
        });
      },
    );
    render(view({ kind: "file", workspaceId: "settings:c" }, "running-original"));
    await screen.findByText(/Action running-original \/ running/);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    release();
    await owner.wait("running-original");
    await screen.findByText(/Action running-original \/ unknown/, {}, { timeout: 4000 });
    expect(
      (screen.getByRole("button", { name: "recover native receipt" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    cleanup();
    unavailable = true;
    render(view(b));
    await screen.findByText(/Action list unavailable:/);
    // "Authored Work remains" was the deleted Family lane's wording; an unreachable host now says
    // only that the list is unavailable, and never invents an empty selection.
    expect(screen.queryByText("No unresolved actions for this selection")).toBeNull();
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  } finally {
    cleanup();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

// Deleted: the `FamilyReadingStatus` component it rendered is gone — a failed reading is now the
// manifest's own `failure` that `useRoute` holds beside the last good readings, covered by RouteShell.

test("raw operation receipt labels a received reply and preserves its failed item payload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "raw-reply-"));
  const owner = new ActionJournal(join(dir, "actions.json"));
  await owner.admit(
    {
      id: "reply",
      kind: "operation",
      key: "revit.apply.parameter-values",
      actor: "human",
      destination: { kind: "document", ref: { session: "B", openId: "original" } },
      input: { edits: [] },
      bases: {},
    },
    async () => ({}),
    async () => ({ applied: 0, results: [{ ok: false, message: "parameter refused" }] }),
  );
  await owner.wait("reply");
  const web = HttpRouter.toWebHandler(
    makeCallRoute(owner, new TakeoffCaptures(join(dir, "captures"))).pipe(
      Layer.provideMerge(
        Layer.succeed(RevitBridge, {
          list: Effect.succeed([]),
          invoke: () => Effect.die("No native dispatch allowed"),
        } as unknown as RevitBridge["Service"]),
      ),
    ),
    { disableLogger: true },
  );
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
    web.handler(new Request(new URL(input, "http://host"), init), Context.empty() as never),
  );
  connectReceiptReadings(owner);
  const dirty = vi.spyOn(peReadings, "dirty");
  try {
    render(<ActionReceiptView id="reply" />);
    await screen.findByText("Action reply / reply received");
    expect(screen.getByLabelText("Returned operation payload").textContent).toContain(
      '"ok": false',
    );
    expect(screen.getByLabelText("Returned operation payload").textContent).toContain(
      "parameter refused",
    );
    fireEvent.click(screen.getByRole("button", { name: "read status" }));
    await waitFor(() => expect(dirty).toHaveBeenCalledWith({ kind: "receipts", id: "reply" }));
  } finally {
    cleanup();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("changing receipt id drops the prior subject before the new stream snapshot arrives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "receipt-id-change-"));
  const owner = new ActionJournal(join(dir, "actions.json"));
  for (const id of ["first", "second"]) {
    await owner.admit(
      {
        id,
        kind: "operation",
        key: "revit.apply.parameter-values",
        actor: "human",
        destination: { kind: "document", ref: { session: "B", openId: "original" } },
        input: { edits: [] },
        bases: {},
      },
      async () => ({}),
      async () => ({ id }),
    );
    await owner.wait(id);
  }
  connectReceiptReadings(owner);
  const mounted = render(<ActionReceiptView id="first" />);
  try {
    await screen.findByText("Action first / reply received");
    mounted.rerender(<ActionReceiptView id="second" />);
    expect(screen.queryByText(/Action first/)).toBeNull();
    await screen.findByText("Action second / reply received");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
