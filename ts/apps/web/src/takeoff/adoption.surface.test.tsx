// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { commands } from "@pe/agent-contracts";
import { adoptionData } from "@pe/agent-contracts/takeoff-read";
import { gate, ref } from "../../../host/tests/host-read-graph.test-support";
import { loaded } from "./route";
import { journey, Drawing } from "./adoption.test.fixture";

test("view choices stay pending for a slow native catalogue, arrive before capture, retain named failures and only then report a completed empty catalogue", async () => {
  const catalogue = gate(), snapshot = gate();
  const j = await journey({ catalogue, snapshot });
  try {
    render(<Drawing mount={j.mount} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    expect(screen.queryByText("no views")).toBeNull();
    expect(screen.getByText("Reading views...")).toBeTruthy();
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 24000));
    expect(screen.getByText("Reading views...")).toBeTruthy();
    expect(screen.queryByText("no views")).toBeNull();
    expect(new Set(j.nativeCalls.filter((call) => call.key === "revit.catalog.project-index").map((call) => JSON.stringify(call.input))).size).toBe(1);
    expect(j.nativeCalls.some((call) => call.key === "takeoffs.snapshot")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 36000 - (Date.now() - started))));
    catalogue.release.resolve();
    await snapshot.entered.promise;
    expect(await screen.findByRole("option", { name: "Zoning plan" })).toBeTruthy();
    expect(j.mount.value().current).toBe(false);
    expect(new Set(j.nativeCalls.filter((call) => call.key === "revit.catalog.project-index").map((call) => JSON.stringify(call.input))).size).toBe(1);
    expect(j.nativeScopes.every((scope) => JSON.stringify(scope) === JSON.stringify({ bridgeSessionId: ref.session, openDocumentId: ref.openId }))).toBe(true);
    snapshot.release.resolve();
    await j.ready();
    const retained = gate();
    j.rereadCatalogue("views", retained);
    await retained.entered.promise;
    expect(await screen.findByText(/Reading views; showing the last known catalogue/)).toBeTruthy();
    expect(screen.getByRole("option", { name: /Zoning plan/ })).toBeTruthy();
    expect(screen.queryByText("no views")).toBeNull();
    retained.release.resolve();
    await j.ready();
    j.rereadCatalogue("failed");
    expect(await screen.findByText(/View catalogue unavailable:.*project index unavailable/)).toBeTruthy();
    expect(screen.getByRole("option", { name: /Zoning plan/ })).toBeTruthy();
    expect(screen.queryByText("no views")).toBeNull();
    expect(j.actions).toHaveLength(0);
    j.rereadCatalogue("empty");
    await j.ready();
    expect(await screen.findByText("no views")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Zoning plan/ })).toBeNull();
  } finally {
    await j.close();
  }
}, 90000);

test("choose adoption views, edit the actual Work, initialize and adopt through typed commands, then inspect a saved capture", async () => {
  const j = await journey();
  try {
    await j.ready();
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    render(<Drawing mount={j.mount} />);
    expect(screen.getByRole("button", { name: "Choose views" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await j.ready();
    await screen.findByRole("checkbox", { name: "Select Office zone in Zoning plan" });
    expect(j.nativeCalls).toContainEqual({
      key: "takeoffs.snapshot",
      input: { views: ["Zoning plan"], zoneGuids: [] },
    });
    expect(j.nativeCalls).toContainEqual({
      key: "takeoffs.candidates",
      input: { view: "Zoning plan" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Office zone in Zoning plan" }));
    await waitFor(() =>
      expect(j.mount.owner()?.doc.adopt["Zoning plan:21"].edit.value.checked).toBe(true),
    );
    await j.ready();
    const name = screen.getByRole("textbox", { name: "Zone name for Office zone in Zoning plan" });
    fireEvent.change(name, { target: { value: "West office" } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(j.mount.owner()?.doc.adopt["Zoning plan:21"].edit.value.name).toBe("West office"),
    );
    await j.ready();
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    await waitFor(
      () => expect(j.actions.some((row) => row.key === "takeoffs.initialize")).toBe(true),
      { timeout: 20000 },
    );
    await waitFor(
      () =>
        expect(j.mount.value().value.initialize.refusal).toBe(
          "The document already carries every shared parameter",
        ),
      { timeout: 20000 },
    );
    await j.ready();
    expect(j.mount.owner()?.doc.writeIntent["takeoffs.initialize"].edit.value).toEqual({
      stage: "Adoption",
    });
    fireEvent.click(screen.getByRole("button", { name: "adopt" }));
    await waitFor(() => expect(j.actions.map((row) => row.key), j.mount.action("adopt").failure ?? screen.queryByRole("alert")?.textContent ?? "").toContain("takeoffs.adopt"), { timeout: 20000 });
    expect(j.actions.map((row) => row.key)).toContain(
      commands["takeoffs.adopt"].writeBoundary.previewKey,
    );
    const doc = j.mount.owner()!.doc;
    expect(commands["takeoffs.adopt"].workIntent.derive(doc)).toEqual({
      views: [
        { view: "Zoning plan", items: [{ elementId: 21, name: "West office", systemTag: "" }] },
      ],
    });
    await j.ready();
    const data = adoptionData.parse(j.mount.value().value);
    expect(data.captures.length).toBeGreaterThan(0);
    const calls = j.nativeCalls.length;
    j.mount.page.query({ work: data.captures[0]!.id });
    await j.ready();
    expect(j.nativeCalls).toHaveLength(calls);
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "live" })).toBeTruthy();
    expect(j.mount.value(loaded).current).toBe(true);
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    fireEvent.click(screen.getByRole("button", {name:"live"}));
    await j.ready();
    expect(j.host.inputs.source).toMatchObject({capturing:true});
  } finally {
    await j.close();
  }
}, 60000);
