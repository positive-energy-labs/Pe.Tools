// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { journey, Drawing } from "./adoption.test.fixture";

vi.mock("@pe/web-kernel/host/build-stamp", () => ({ webBuildStamp: { version: "test", build: "test", source: "dev" } }));

test("takeoffs lists unreadable blobs as can't read, kept with owner and reason", async () => {
  const j = await journey({ unreadable: [{ elementId: 21, parameter: "Pe.Region", reason: "Unknown owner version 99" }, { elementId: 22, parameter: "Pe.Second", reason: "Malformed second blob" }, { elementId: 23, parameter: "Pe.Third", reason: "Unsupported third blob" }] });
  try {
    await j.ready();
    const view = render(<Drawing mount={j.mount} />);
    expect(view.container.textContent).toContain("can't read, kept");
    expect(view.container.textContent).toContain("Pe.Region");
    expect(view.container.textContent).toContain("Element name unavailable");
    expect(view.container.textContent).not.toContain("element 21");
    expect(view.container.textContent).toContain("Unknown owner version 99");
    for (const text of ["Pe.Second", "Malformed second blob", "Pe.Third", "Unsupported third blob"])
      expect(view.container.textContent).toContain(text);
  } finally { await j.close(); }
});
