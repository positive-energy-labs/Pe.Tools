// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { ProjectBrowserView } from "./catalog/project-browser";
import { ParameterCoverageView } from "./detail/parameter-coverage";

afterEach(cleanup);

test("I1/N4: browser leaves and coverage samples name their elements and carry ids for the element menu", () => {
  const browser = render(
    <ProjectBrowserView
      opKey="revit.catalog.project-browser"
      request={{}}
      data={{
        organizations: [],
        items: [
          {
            browserPath: { section: "Views", segments: [] },
            handle: { label: "Level 1 HVAC", elementId: 4815162, uniqueId: "u-1" },
          },
        ],
        browserSnapshotId: "snap-1",
      }}
    />,
  );
  const leaf = browser.getByText("Level 1 HVAC").closest("[data-revit-ids]");
  expect(leaf?.getAttribute("data-revit-ids")).toBe("4815162");
  expect(browser.container.querySelector("[role=tree]")).toBeTruthy();
  expect(browser.container.textContent).not.toMatch(/\bid 4815162\b/);
  cleanup();

  const coverage = render(
    <ParameterCoverageView
      opKey="revit.matrix.parameter-coverage"
      request={{}}
      data={{
        parameters: [
          {
            identity: { key: "k", name: "Flow" },
            categoryName: "Air Terminals",
            elementCount: 2,
            presentCount: 1,
            blankCount: 1,
            defaultCount: 0,
            missingCount: 0,
            samples: [
              { elementId: 2342342, displayName: "RV-6" },
              { elementId: 2342343, displayName: "RV-7" },
            ],
          },
        ],
        issues: [],
        totalElements: 2,
      }}
    />,
  );
  const token = coverage.getByRole("button", { name: "RV-7, reference 2" });
  expect(token.getAttribute("data-revit-ids")).toBe("2342343");
  expect(coverage.container.textContent).not.toMatch(/2342342|2342343/);
});
