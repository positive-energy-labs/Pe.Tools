// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { DocumentPicker } from "#/shell/application-route-shell";
import type { PanePlace } from "#/shell/admitted-pane";
import { peReadings } from "#/readings";
import { TooltipProvider } from "@pe/kit/lang/tooltip";
import { HelpWorld } from "./help";
import { STARTUP_TEACHING, referenceTeaching } from "./teaching";
import { DUCTS_TEACHING } from "#/ducts/proto/e/teaching";
import { useLocalDevice, RemoteDeviceGate, RecordedSourceChip } from "#/machine/devices";

const host = vi.hoisted(() => ({ call: vi.fn(), fetch: vi.fn() }));
vi.mock("#/host/runtime", () => ({ hostFetch: host.fetch }));
host.fetch.mockImplementation(async () => new Response(null, { status: 403 }));
vi.mock("#/host/pe-client", () => ({ peClient: { ...host, url: () => "/pe/features" } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  host.call.mockReset();
  host.fetch.mockReset().mockImplementation(async () => new Response(null, { status: 403 }));
});

test("the static shell renders caller-owned public guidance without a host or protected children", () => {
  const generic = renderToStaticMarkup(
    <RemoteDeviceGate name="Tools" guidance={<HelpWorld facts={STARTUP_TEACHING} />}>
      <p>Protected document facts</p>
    </RemoteDeviceGate>,
  );
  expect(generic).toContain("data-page-map");
  expect(generic).toContain("Workspace");
  expect(generic).not.toContain("How Ducts works");
  expect(generic).not.toContain("Protected document facts");
  const ducts = renderToStaticMarkup(
    <RemoteDeviceGate name="Ducts" guidance={<HelpWorld facts={DUCTS_TEACHING} />}>
      <p>Protected document facts</p>
    </RemoteDeviceGate>,
  );
  expect(ducts).toContain("data-page-map");
  expect(ducts).toContain("All-systems rules");
  expect(ducts).toContain("move the cursor down");
  expect(ducts).not.toContain(" · active");
  expect(ducts).not.toContain(" · shown");
  expect(ducts).not.toContain(" · available");
  expect(ducts).not.toContain("refuses now");
  expect(ducts).not.toContain("Protected document facts");
  expect(host.call).not.toHaveBeenCalled();
});

test("connection failure retains guidance; retry must still pass admission", async () => {
  host.call.mockRejectedValueOnce(new Error("Host offline"));
  render(
    <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
      <p>Protected document facts</p>
    </RemoteDeviceGate>,
  );
  expect((await screen.findByRole("alert")).textContent).toBe("Host offline");
  expect(screen.getByText("Public guide")).toBeTruthy();
  expect(screen.getByRole("region").hasAttribute("aria-busy")).toBe(false);
  host.call.mockResolvedValueOnce({ environmentId: "test", local: false, paired: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry host connection" }));
  await waitFor(() => expect(host.call).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Protected document facts")).toBeNull();
  expect(screen.getByText("Public guide")).toBeTruthy();
});

test.each([
  { local: true, paired: false },
  { local: false, paired: true },
])("only local or paired admission exposes children: %o", async (admission) => {
  host.call.mockResolvedValue({ environmentId: "test", ...admission });
  render(
    <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
      <p>Protected document facts</p>
    </RemoteDeviceGate>,
  );
  await act(async () => {});
  expect(screen.getByText("Protected document facts")).toBeTruthy();
  expect(screen.queryByText("Public guide")).toBeNull();
});

test("route declarations replace rather than merge and unsupported routes never use Ducts", () => {
  const view = render(<HelpWorld facts={referenceTeaching("/ducts")} />);
  expect(screen.getByRole("group", { name: "Page regions" })).toBeTruthy();
  expect(view.container.textContent).toContain("All-systems rules");
  view.rerender(<HelpWorld facts={referenceTeaching("/family")} />);
  expect(view.container.textContent).not.toContain("All-systems rules");
  expect(view.container.textContent).toContain("Workspace");
});

const recorded = {
  kind: "recording",
  at: null,
  build: "build",
  catalog: "catalog",
  coverage: ["native"],
};
const features = (source?: string) =>
  new Response(JSON.stringify({ version: "test", features: { peApi: 1, nativeAdapter: 2 } }), {
    headers: source === undefined ? {} : { "x-pe-source": source },
  });
function AccessWitness() {
  return (
    <TooltipProvider>
      <p>Local authority: {String(useLocalDevice())}</p>
      <RecordedSourceChip />
    </TooltipProvider>
  );
}
test("a recording admits the connected gate without the live device door or local authority", async () => {
  host.fetch.mockResolvedValue(features(JSON.stringify(recorded)));
  host.call.mockImplementation(() => {
    throw Error("recording called device.environment");
  });
  render(
    <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
      <AccessWitness />
    </RemoteDeviceGate>,
  );
  expect(await screen.findByText("Local authority: false")).toBeTruthy();
  expect(screen.getByText("Recorded · read only")).toBeTruthy();
  expect(screen.queryByText(/null|1970/)).toBeNull();
  expect(host.call).not.toHaveBeenCalled();
});

test("missing access context fails closed", () => {
  render(<AccessWitness />);
  expect(screen.getByText("Local authority: false")).toBeTruthy();
  expect(screen.queryByText("Recorded · read only")).toBeNull();
});
test.each([undefined, JSON.stringify({ kind: "live", capturing: true })])(
  "an absent or live source still blocks an unpaired device: %s",
  async (source) => {
    host.fetch.mockResolvedValue(features(source));
    host.call.mockResolvedValue({ environmentId: "test", local: false, paired: false });
    render(
      <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
        <AccessWitness />
      </RemoteDeviceGate>,
    );
    expect(await screen.findByRole("region", { name: "Pair this device" })).toBeTruthy();
    expect(screen.queryByText(/Local authority/)).toBeNull();
  },
);
test.each([
  "not json",
  JSON.stringify({ kind: "recording" }),
  JSON.stringify({ kind: "fixture", name: "demo" }),
])(
  "a present invalid host source refuses and a fresh retry can admit recording: %s",
  async (source) => {
    host.fetch.mockResolvedValueOnce(features(source));
    host.call.mockImplementation(() => {
      throw Error("invalid source called device door");
    });
    render(
      <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
        <AccessWitness />
      </RemoteDeviceGate>,
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Local authority/)).toBeNull();
    host.fetch.mockResolvedValueOnce(
      features(JSON.stringify({ ...recorded, truncated: { at: 3, reason: "full" } })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry host connection" }));
    expect(await screen.findByText("Recorded · read only · partial")).toBeTruthy();
    expect(host.fetch).toHaveBeenCalledTimes(2);
    expect(host.call).not.toHaveBeenCalled();
  },
);
test("bootstrap transport failure never infers device authority; retry owns a fresh signal", async () => {
  host.fetch.mockRejectedValueOnce(new Error("Bootstrap offline"));
  render(
    <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
      <AccessWitness />
    </RemoteDeviceGate>,
  );
  expect((await screen.findByRole("alert")).textContent).toBe("Bootstrap offline");
  expect(host.call).not.toHaveBeenCalled();
  const first = host.fetch.mock.calls[0][1].signal as AbortSignal;
  host.fetch.mockResolvedValueOnce(features());
  host.call.mockResolvedValueOnce({ environmentId: "test", local: true, paired: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry host connection" }));
  expect(await screen.findByText("Local authority: true")).toBeTruthy();
  expect(first.aborted).toBe(true);
  expect(host.fetch.mock.calls[1][1].signal).not.toBe(first);
});
test("unmount aborts bootstrap and its late response cannot call the device door", async () => {
  let answer!: (response: Response) => void;
  host.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  const view = render(
    <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
      <AccessWitness />
    </RemoteDeviceGate>,
  );
  const signal = host.fetch.mock.calls[0][1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => answer(features()));
  expect(host.call).not.toHaveBeenCalled();
});

test("an explicitly declared fixture grants local presentation without any host bootstrap", async () => {
  window.history.replaceState(null, "", "/?fixture=declared");
  render(
    <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
      <AccessWitness />
    </RemoteDeviceGate>,
  );
  expect(await screen.findByText("Local authority: true")).toBeTruthy();
  expect(host.fetch).not.toHaveBeenCalled();
  expect(host.call).not.toHaveBeenCalled();
});
test("the original wait bound fails bootstrap even when a response body stops answering", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  host.fetch.mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) });
  render(
    <RemoteDeviceGate name="Tools" guidance={<p>Public guide</p>}>
      <AccessWitness />
    </RemoteDeviceGate>,
  );
  await act(async () => {});
  expect(timeout).toHaveBeenCalledWith(15_000);
  act(() => deadline.abort(new DOMException("deadline", "TimeoutError")));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "No answer from this host after 15s.",
  );
  expect(screen.getByRole("button", { name: "Retry host connection" })).toBeTruthy();
  expect(host.call).not.toHaveBeenCalled();
});
test("the real inventory hook feeds picker labels without fabricated pid and retains them after bad input", async () => {
  const registry = AtomRegistry.make();
  let send!: Parameters<typeof peReadings.subscribe>[1];
  vi.spyOn(peReadings, "subscribe").mockImplementation((_request, listener) => {
    send = listener;
    return () => {};
  });
  const write = vi.fn();
  const place = { address: { read: () => new URLSearchParams(), write } } as unknown as PanePlace;
  const view = render(
    <RegistryContext.Provider value={registry}>
      <DocumentPicker place={place} target={null} needs="project" enabled />
    </RegistryContext.Provider>,
  );
  const value = {
    sessions: [
      {
        sessionId: "recorded-session",
        connected: true,
        openDocumentCount: 1,
        processId: null,
        custody: null,
        openDocuments: [
          {
            openId: "recorded-document",
            title: "Recorded project",
            address: null,
            isActive: true,
            isFamilyDocument: false,
          },
        ],
      },
    ],
  };
  act(() => send({ kind: "snapshot", key: "inventory", value }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a document" }));
  expect(await screen.findByText("Recorded project")).toBeTruthy();
  expect(screen.getByText("Revit")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/pid (null|0)|observed/);
  act(() => send({ kind: "snapshot", key: "inventory", value: { sessions: "bad" } }));
  fireEvent.click(screen.getByText("Recorded project"));
  expect(JSON.parse(write.mock.calls[0][0].get("target"))).toEqual({
    kind: "open",
    ref: { session: "recorded-session", openId: "recorded-document" },
  });
  view.unmount();
  registry.dispose();
});
