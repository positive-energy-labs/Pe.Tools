// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { DUCTS_SUMMARY, DUCTS_WALK } from "@pe/agent-contracts/ducts-guide";
import { RemoteDeviceGate } from "#/machine/devices";
import { DuctsIntroduction } from "#/ducts/introduction";
import { EScreen } from "#/ducts/proto/e/screen";
import type { ProtoProps } from "#/ducts/proto/props";
import { SCENE_FIXTURE } from "#/ducts/scene.fixture";

const host = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("#/host/pe-client", () => ({ peClient: host }));

afterEach(() => {
  cleanup();
  host.call.mockReset();
});

test("the static shell renders caller-owned public guidance without a host or protected children", () => {
  const generic = renderToStaticMarkup(
    <RemoteDeviceGate name="Tools" guidance={<p>Choose a tool and document.</p>}>
      <p>Protected document facts</p>
    </RemoteDeviceGate>,
  );
  expect(generic).toContain("Choose a tool and document.");
  expect(generic).not.toContain("How Ducts works");
  expect(generic).not.toContain("Protected document facts");
  const ducts = renderToStaticMarkup(
    <RemoteDeviceGate name="Ducts" guidance={<DuctsIntroduction />}>
      <p>Protected document facts</p>
    </RemoteDeviceGate>,
  );
  for (const { step } of DUCTS_WALK) expect(ducts).toContain(step);
  expect(ducts.match(/<details>/g)).toHaveLength(DUCTS_WALK.length);
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
  expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("false");
  host.call.mockResolvedValueOnce({ environmentId: "test", local: false, paired: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry host connection" }));
  await waitFor(() => expect(host.call).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Protected document facts")).toBeNull();
  expect(screen.queryByText("Public guide")).toBeNull();
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

test("the actual Ducts loading branch keeps one guide through reading, pricing and failure", () => {
  // Deliberately no action callbacks: loading must not mount panes that could invoke them.
  const props = {
    page: { system: null },
    snapshot: null,
    pricing: false,
    empty: { says: "reading ducts…", exit: "wait for the snapshot" },
    reading: { pending: true, error: null, refreshing: false },
  } as unknown as ProtoProps;
  const view = render(<EScreen props={props} />);
  expect(screen.getByText(DUCTS_SUMMARY)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("reading ducts…");
  view.rerender(<EScreen props={{ ...props, snapshot: SCENE_FIXTURE.snapshot, pricing: true }} />);
  expect(screen.getByRole("status").textContent).toContain(SCENE_FIXTURE.snapshot.document.title);
  expect(screen.getByRole("status").textContent).toContain("pricing every run");
  expect(screen.getAllByText(DUCTS_SUMMARY)).toHaveLength(1);
  view.rerender(
    <EScreen
      props={{ ...props, reading: { ...props.reading, pending: false, error: "Snapshot refused" } }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("Snapshot refused");
  expect(screen.getByRole("region", { name: "Ducts loading" }).getAttribute("aria-busy")).toBe(
    "false",
  );
  expect(screen.getByText(DUCTS_SUMMARY)).toBeTruthy();
});
