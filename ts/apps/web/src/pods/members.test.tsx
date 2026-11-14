// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Members } from "./drawing";

afterEach(cleanup);
test.each([
  ["Hydronic was kept with your changes. Only the example update was skipped because its authored members differ.", "Hydronic was kept with your changes"],
  [JSON.stringify([{ code: "invalid_type", path: ["example"], message: "unrecognized_keys" }]), "Example update kept: its provenance could not be verified. Your Pod was preserved."],
])("Members shows a kept-example refusal without validator jargon: %s", (message, visible) => {
  const ctx = {
    page: { read: () => ({ member: { kind: "ids", ids: [] }, runs: "member" }), query() {} },
    value: { state: "ready", value: { pods: [{ id: "hydronic", name: "Hydronic", version: "0.1.0", members: [], diagnostics: [{ code: "ShippedExampleUpdateKept", message }] }] } },
  } as unknown as Parameters<typeof Members>[0]["ctx"];
  render(<Members ctx={ctx} />);
  const pane = screen.getAllByRole("alert").map(node => node.textContent).join(" ");
  expect(pane).toContain(visible);
  expect(pane).not.toMatch(/invalid_type|unrecognized_keys/);
});
