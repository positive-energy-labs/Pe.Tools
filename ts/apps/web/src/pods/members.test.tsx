// W45 review F-W45-2: the Pods pane words a kept-example refusal without validator jargon. Members renders each
// diagnostic through podDiagnostic (drawing.tsx), so the words are tested at that one seam, with no context cast.
import { expect, test } from "vite-plus/test";
import { podDiagnostic } from "../route/readable-refusal";

test.each([
  ["Hydronic was kept with your changes. Only the example update was skipped because its authored members differ.", "Hydronic was kept with your changes"],
  [JSON.stringify([{ code: "invalid_type", path: ["example"], message: "unrecognized_keys" }]), "Example update kept: its provenance could not be verified. Your Pod was preserved."],
])("a kept-example refusal reads without validator jargon: %s", (message, visible) => {
  const words = podDiagnostic({ code: "ShippedExampleUpdateKept", message });
  expect(words).toContain(visible);
  expect(words).not.toMatch(/invalid_type|unrecognized_keys/);
});
