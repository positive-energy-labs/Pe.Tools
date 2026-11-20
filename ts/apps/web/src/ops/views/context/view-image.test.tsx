// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ViewImageView } from "./view-image";

vi.mock("@pe/web-kernel/host/runtime", () => ({
  runtimeStreamUrl: (url: string) => url + "?pe-runtime=test",
}));

afterEach(cleanup);

test("a refused image displays every excluded element and reason without a picture or capture link", () => {
  const data = {
    view: { label: "Pe lens" },
    refused: true,
    filePath: null,
    notDrawn: [
      { elementId: 6751193, reasons: ["PhaseHidden", "OutsideCrop"] },
      { elementId: 6752819, reasons: ["CategoryHidden"] },
    ],
    restore: { held: false, left: ["phase"] },
  };
  const view = render(
    <ViewImageView opKey="revit.context.view-image.focus" request={{}} data={data} />,
  );
  for (const response of [data, { ...data, filePath: undefined, capture: null, imageUrl: null }]) {
    view.rerender(
      <ViewImageView opKey="revit.context.view-image.focus" request={{}} data={response} />,
    );
    expect(view.container.textContent).toContain("Picture refused");
    for (const expected of [
      "6751193",
      "6752819",
      "PhaseHidden",
      "OutsideCrop",
      "CategoryHidden",
      "View restore failed",
      "phase",
    ])
      expect(view.container.textContent).toContain(expected);
    expect(view.container.textContent).not.toContain("unrecognized response shape");
    expect(view.container.querySelector("img, a")).toBeNull();
  }
});

test("an unregistered image opens the stored PNG", () => {
  const imageUrl = "/captures/" + "a".repeat(64) + ".png";
  const view = render(
    <ViewImageView
      opKey="revit.context.view-image"
      request={{}}
      data={{ view: { label: "Sheet" }, registration: null, imageUrl }}
    />,
  );
  expect(view.getByRole("link").getAttribute("href")).toBe(imageUrl + "?pe-runtime=test");
  expect(view.getByRole("img", { name: "Sheet" }).getAttribute("src")).toBe(
    imageUrl + "?pe-runtime=test",
  );
});
