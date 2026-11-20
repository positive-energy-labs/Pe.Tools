// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { nodeOf, factOf } from "@pe/ducts-domain/test-snapshot";
import { NodeFactsView } from "./facts.tsx";

afterEach(cleanup);
test.each(["PE_M_Grd_AirFlow", "Other flow"])(
  "terminal facts with stamped slot %s",
  (flowParameter) => {
    const slot = "slot:PE_M_Grd_AirFlow";
    const node = nodeOf(1, "terminal", {
      flowParameter,
      facts: [
        factOf("flow", 120, { unit: "cfm", provenance: "designer-stated" }),
        factOf(slot, 120, { unit: "cfm", provenance: "designer-stated" }),
      ],
    });
    const { container } = render(<NodeFactsView node={node} issues={[]} />);
    expect(screen.getAllByText("flow", { selector: "dt" })).toHaveLength(1);
    expect([...container.querySelectorAll("dt")].map((row) => row.textContent)).toEqual(
      flowParameter === "PE_M_Grd_AirFlow" ? ["part", "flow"] : ["part", "flow", slot],
    );
  },
);
