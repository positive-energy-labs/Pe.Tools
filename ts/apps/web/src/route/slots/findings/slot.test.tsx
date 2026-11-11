// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { local } from "@pe/agent-contracts/slots";
import { findingCommand, route, paneLayout, scrollBody } from "@pe/web/route";
import { subjectCode, uniqueIdSchema } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { makeAtomRegistry } from "../../../shell/owner";
import { SheetPane } from "../sheet/pane.tsx";

afterEach(cleanup);
const pipe = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72") });

// A Pod's route, as a Pod declares it: only `@pe/web/route`, a sheet whose rows are its pipes.
const sheet = { bindings: {
  sized: local(z.number(), "subject", { label: "Pipe size", rows: () => [pipe] }),
  slot: local(z.string(), "subject", { rows: () => ["fanFlow"] }),
} };
const pod = route({
  key: "pod-sizing", name: "Sizing", directory: { group: "Pods", summary: "Size pipes", label: "Sizing", icon: "Table2",
    exposure: "Main", surfaces: { web: "full", pwa: "full", tray: false }, aliases: [], runtimeNeed: "Revit", listed: true, satellites: [] },
  fields: {}, sheet, panes: { main: { title: "Sizing", purpose: "Size pipes", body: "scroll", draw: () => scrollBody(null) } },
  layout: paneLayout("main"),
} as never);

test("a Pod's sheet row keyed by a SubjectRef shows the person's Finding verb, which runs the kernel's findings.write command", async () => {
  expect((pod.spec.commands as Record<string, { entry: string }>).finding?.entry).toBe(findingCommand.entry);
  const run = vi.fn(async (_id: string, _input: unknown) => null);
  const ctx = { cells: { doc: {}, at: () => ({ owner: { route: "pod-sizing", label: "Sizing" }, refusal: null, value: {}, transitions: () => [], stage: async () => null, clear: async () => null }) },
    page: { read: () => ({}) }, value: { status: "ready", current: true, value: {} }, write: (id: string) => ({ run: (input: unknown) => run(id, input) }) };
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot: sheet }} /></RegistryContext>);
  // The pipe row has the verb; the slot-name row ("fanFlow") is no subject and has none.
  expect(screen.getAllByRole("button", { name: /^Write a finding on / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Write a finding on Pipe size"]);
  fireEvent.click(screen.getByRole("button", { name: "Write a finding on Pipe size" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "finding text" }), { target: { value: "riser undersized" } });
  fireEvent.click(screen.getByRole("button", { name: "Write note on Pipe size" }));
  await vi.waitFor(() => expect(run).toHaveBeenCalledWith("finding", expect.objectContaining({ subject: pipe, kind: "note", text: "riser undersized" })));
});
