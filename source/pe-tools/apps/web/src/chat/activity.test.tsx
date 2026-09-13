// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { unresolvedRuns } from "./activity";
import { SavedCaptureText } from "#/takeoff/saved-capture-text";
import { ActionReceiptView } from "#/actions/receipt";

const call = (id: string, name: string, state: string, ok = true) => ({
  type: "tool-invocation" as const,
  toolInvocation: {
    toolCallId: id,
    toolName: name,
    state: "result",
    args: { key: "workflow:takeoffs.sync" },
    result: { result: { action: { id }, id, key: "takeoffs.sync", state, ok } },
  },
});
const thread = (parts: unknown[]) =>
  ({
    messages: [{ id: "m1", content: { parts } }],
    display: { isRunning: false, activeTools: {} },
  }) as never;

/** A newer success, and an unrelated read, never remove an older unresolved outcome. */
test("unknown A survives an unrelated read and a successful B, keeping its original ID", () => {
  const rows = unresolvedRuns(
    thread([
      call("A", "pe_do", "unknown"),
      call("R", "pe_read", "succeeded"),
      call("B", "pe_do", "succeeded"),
    ]),
  );
  expect(rows.map((row) => row.id)).toEqual(["A"]);
  expect(rows[0]!.says).toContain("A");
  expect(rows[0]!.says).toContain("not proof the operation failed");
});

/** Reading the stored text keeps whitespace and malformed JSON, and never writes. */
test("saved capture text shows the stored bytes and offers no editor", async () => {
  const stored = '{\n  "a":   1,\n  "b": ,\n}\n   ';
  const fetchMock = vi.fn(async (url: string) => {
    expect(String(url)).toContain("text=1");
    return new Response(JSON.stringify({ path: "C:/captures/x.json", text: stored }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <SavedCaptureText id={"a".repeat(64)} />,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("saved capture file text"));
  await waitFor(() => expect(screen.getByTestId("saved-capture-text")).toBeTruthy());
  const shown = screen.getByTestId("saved-capture-text").textContent ?? "";
  expect(shown).toContain('"b": ,');
  expect(shown.includes("   ")).toBe(true);
  expect(document.querySelector("textarea")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  // One reader, no poll: closing and reopening re-uses the read it already holds.
  fireEvent.click(screen.getByLabelText("saved capture file text"));
  fireEvent.click(screen.getByLabelText("saved capture file text"));
  await waitFor(() => expect(screen.getByTestId("saved-capture-text")).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  cleanup();
  vi.unstubAllGlobals();
});

/** The selected row's detail reads the original ID on its own owner, once, with no stream. */
test("one selected receipt detail reads its original owner and opens no stream or poll", async () => {
  const sources: string[] = [];
  class Probe {
    constructor(url: string) {
      sources.push(url);
    }
    close() {}
  }
  vi.stubGlobal("EventSource", Probe as never);
  const seen: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(
      JSON.stringify({
        id: "A",
        kind: "workflow",
        key: "takeoffs.sync",
        actor: "human",
        state: "unknown",
        destination: { kind: "host" },
        request: {},
        bases: {},
        steps: [],
        preparation: { state: "unprepared" },
        recovery: [],
        startedAt: "2026-09-10T00:00:00.000Z",
        publication: { state: "unrequested" },
        error: "outcome unknown",
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ActionReceiptView id="A" base="/demo/instances/demo-1" />,
  );
  await waitFor(() => expect(screen.getByText(/Action A/)).toBeTruthy());
  // Exactly one read, addressed by the original ID through the owner it was given.
  expect(seen).toHaveLength(1);
  expect(seen[0]).toContain("/demo/instances/demo-1");
  expect(seen[0]).toContain("A");
  // Mounted without `watch`: no resource stream is opened for it.
  expect(sources).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  cleanup();
  vi.unstubAllGlobals();
});
