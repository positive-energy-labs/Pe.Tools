// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { journey, Drawing } from "./adoption.test.fixture";

test("takeoffs lists unreadable blobs as can't read, kept with owner and reason", async () => {
  const j = await journey({ unreadable: [{ elementId: 21, parameter: "Pe.Region", reason: "Unknown owner version 99" }] });
  try {
    await j.ready();
    const view = render(<Drawing mount={j.mount} />);
    expect(view.container.textContent).toContain("can't read, kept");
    expect(view.container.textContent).toContain("Pe.Region");
    expect(view.container.textContent).toContain("Unknown owner version 99");
  } finally { await j.close(); }
});
