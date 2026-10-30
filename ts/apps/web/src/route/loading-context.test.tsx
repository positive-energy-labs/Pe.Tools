// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { HelpWorld } from "./help";
import { STARTUP_TEACHING, referenceTeaching } from "./teaching";
import { DUCTS_TEACHING } from "#/ducts/proto/e/teaching";
import { RemoteDeviceGate } from "#/machine/devices";

const host = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("#/host/pe-client", () => ({ peClient: host }));

afterEach(() => {
  cleanup();
  host.call.mockReset();
});

test("the static shell renders caller-owned public guidance without a host or protected children", () => {
  const generic = renderToStaticMarkup(
    <RemoteDeviceGate name="Tools" guidance={<HelpWorld facts={STARTUP_TEACHING} />}>
      <p>Protected document facts</p>
    </RemoteDeviceGate>,
  );
  expect(generic).toContain("data-page-map");
  expect(generic).toContain("Workspace");
  expect(generic).toContain('data-map-region="navigation"');
  expect(generic).toContain("aspect-ratio:1440 / 800");
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
