import { AttentionDocument } from "@pe/kit/lang/attention";
// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { local } from "@pe/agent-contracts/slots";
import { route, paneLayout, scrollBody } from "@pe/web/route";
import { subjectCode, uniqueIdSchema } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { makeAtomRegistry } from "../../../shell/owner";
import { SheetPane } from "../sheet/pane.tsx";

afterEach(cleanup);
const pipe = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72") });

// A Pod's route, as a Pod declares it: only `@pe/web/route`, a sheet whose rows are its pipes.
const sheet = { bindings: {
  sized: local({ kind: "number" }, "subject", { label: "Pipe size", rows: () => [pipe] }),
  slot: local({ kind: "enum", shape: z.string(), choices: [] }, "subject", { rows: () => ["fanFlow"] }),
} };
const pod = route({
  key: "pod-sizing", name: "Sizing", directory: { group: "Pods", summary: "Size pipes", label: "Sizing", icon: "Table2",
    exposure: "Main", surfaces: { web: "full", pwa: "full", tray: false }, aliases: [], runtimeNeed: "Revit", listed: true, satellites: [] },
  fields: {}, sheet, panes: { main: { title: "Sizing", purpose: "Size pipes", body: "scroll", draw: () => scrollBody(null) } },
  layout: paneLayout("main"),
} as never);

test("a Pod sheet mentions a subject row and never a binding slot name", () => {
  expect(pod.spec.verbs).toEqual({});
  const ctx = { cells: { doc: {}, at: () => ({ owner: { route: "pod-sizing", label: "Sizing" }, refusal: null, value: {}, transitions: () => [], stage: async () => null, clear: async () => null }) },
    page: { read: () => ({}) }, value: { state: "ready", value: {} } };
  const { container } = render(<RegistryContext value={makeAtomRegistry()}><AttentionDocument value="s/o"><SheetPane ctx={{ draw: ctx as never, slot: sheet }} /></AttentionDocument></RegistryContext>);
  expect([...container.querySelectorAll("[data-subject]")].map(node => node.getAttribute("data-subject"))).toEqual([pipe]);
});
