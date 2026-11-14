// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { ViewImageView } from "./view-image";

afterEach(cleanup);

test("a refused image displays every excluded element and reason without a picture or capture link", () => {
  const data = {
    view: { label: "Pe lens" }, refused: true, filePath: null,
    notDrawn: [
      { elementId: 6751193, reasons: ["PhaseHidden", "OutsideCrop"] },
      { elementId: 6752819, reasons: ["CategoryHidden"] },
    ],
    restore: { held: false, left: ["phase"] },
  };
  const view = render(<ViewImageView opKey="revit.context.view-image.focus" request={{}} data={data} />);
  for (const response of [data, { ...data, filePath: undefined, capture: null, imageUrl: null }]) {
    view.rerender(<ViewImageView opKey="revit.context.view-image.focus" request={{}} data={response} />);
    expect(view.container.textContent).toContain("Picture refused");
    for (const expected of ["6751193", "6752819", "PhaseHidden", "OutsideCrop", "CategoryHidden", "View restore failed", "phase"])
      expect(view.container.textContent).toContain(expected);
    expect(view.container.textContent).not.toContain("unrecognized response shape");
    expect(view.container.querySelector("img, a")).toBeNull();
  }
});
