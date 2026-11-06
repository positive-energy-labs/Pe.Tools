import { expect, test } from "vite-plus/test";
import { memberWork, settingsRouteState } from "@pe/agent-contracts";
import { compositionInput, compositionReadInput } from "./inputs";
import { podsSeeds } from "./graph-seeds";
import { DEMO_MEMBER_SPECS } from "./seeds";
import { familyFixtures as browserFixtures } from "../family/authored-families";
import { familyFixtures as producerFixtures } from "../../scripts/route-projection-fixtures";
import { podsNeutralBodies } from "./neutral";

const page = podsSeeds.browse.page;
const spec = DEMO_MEMBER_SPECS.get(`${page.pod}|${page.path}`)!;
const read = { member: page, content: spec.content, sha256: "fixture", schemaJson: spec.schema };
const basis = podsSeeds.browse.works[memberWork(page)]!;

test("the Node projection adapter exposes the same canonical fixture bytes as the browser raw loader", () => {
  expect(producerFixtures).toEqual(browserFixtures);
});

test("save-new receipt projection moves only declared Page fields, never its file hash", () => {
  expect(
    podsNeutralBodies.saveNewLands.run({
      file: { pod: page.pod, path: "settings/new.json", sha256: "saved-hash" },
    }),
  ).toEqual({ pod: page.pod, path: "settings/new.json" });
});

test("composition projects the real Pod fixture or accepted Work without changing exact editor bytes", () => {
  expect(compositionReadInput.parse(compositionInput({ page, work: null }, read))).toEqual({
    ...page,
    content: spec.content,
  });
  const content = ' {\n  "name" : "reviewed", "retained": true\n}\n';
  const work = settingsRouteState.schema.parse({
    ...basis,
    fields: { "": { edit: { value: content } } },
  });
  expect(compositionInput({ page, work }, read)).toEqual({ ...page, content });
  expect(work.basis?.sha256).toBe("fixture");
});

test("composition does not leak edits from another member Work into the selected file", () => {
  const work = settingsRouteState.schema.parse({
    ...basis,
    basis: { ...basis.basis, member: { pod: "another-pod", path: "settings/other.json" } },
    fields: { "": { edit: { value: '{"wrong":"member"}' } } },
  });
  expect(compositionInput({ page, work }, read)).toEqual({ ...page, content: read.content });
});

test("missing member evidence, source files and invalid editor JSON do not acquire composition", () => {
  expect(compositionInput({ page, work: basis }, null)).toBeNull();
  expect(compositionInput({ page: { ...page, path: "index.html" }, work: basis }, read)).toBeNull();
  const work = settingsRouteState.schema.parse({
    ...basis,
    fields: { "": { edit: { value: "{" } } },
  });
  expect(compositionInput({ page, work }, read)).toBeNull();
});
