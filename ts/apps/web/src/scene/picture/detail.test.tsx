// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DetailedRead } from "./detail";
import type { Psc1Metadata } from "#/scene/psc1";
afterEach(cleanup);
it("discloses generated read cost and padding, and acquires only on a click", () => {
  const onRead = vi.fn();
  const metadata = {
    effectiveContextPaddingFt: 5,
    stamp: {
      geometryCost: {
        plannedCount: 12,
        newlyTessellatedCount: 7,
        cumulativeTessellatedCount: 31,
      },
    },
  } as Psc1Metadata;
  const view = render(<DetailedRead metadata={metadata} onRead={onRead} />);
  expect(onRead).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain(
    "Context 5 ft / planned 12 / newly tessellated 7 / document holds 31",
  );
  fireEvent.click(view.getByRole("button", { name: "Read detailed" }));
  expect(onRead).toHaveBeenCalledTimes(1);
});
