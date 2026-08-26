// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";

import {
  RouteDocumentPicker,
  routeDocumentAddress,
  routeDocumentChoices,
} from "./route-document";
import type { SessionFacts } from "#/host/target";

const session = (id: string, title: string, at: string): SessionFacts => ({
  sessionId: id,
  sdkSessionId: id,
  processId: 25,
  lane: "dev",
  custody: "controlled",
  activeDocumentId: at,
  activeDocumentTitle: title,
  openDocumentCount: 1,
});

afterEach(cleanup);

describe("route document choice", () => {
  it("handles zero, one, and two open documents", () => {
    const one = routeDocumentChoices([session("pe.app-25", "project-a", "C:\\Models\\projectA.rvt")]);
    const two = routeDocumentChoices([
      session("pe.app-25", "project-a", "C:\\Models\\projectA.rvt"),
      session("pe.app-26", "Tower", "C:\\Models\\Tower.rvt"),
    ]);

    expect(routeDocumentAddress([], null)).toBeNull();
    expect(routeDocumentAddress(one, null)).toBe(address("C:\\Models\\projectA.rvt"));
    expect(routeDocumentAddress(two, null)).toBeNull();

    const pick = vi.fn();
    render(<RouteDocumentPicker choices={two} onPick={pick} />);
    fireEvent.click(screen.getByRole("button", { name: "pe.app-26 · Tower" }));
    expect(pick).toHaveBeenCalledWith(address("C:\\Models\\Tower.rvt"));
  });
});
