// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { product } from "@pe/fans-contract/product";
import { module } from "../route.ts";
import {
  roster,
  snapshot,
  targetChange,
  targetPaths,
  type JourneyDoc,
  type TargetProduct,
  typedSubjectDoor,
} from "../../../../tests/e2e/mounted.test-support.tsx";

// The recorded Chadds walk, and the same walk under another fan mark standing in for Snowdon.
const marks = { chadds: "MUAS-1", again: "MUAS-1", snowdon: "SNOW-1" } satisfies Record<
  JourneyDoc,
  string
>;
const fans: TargetProduct = {
  module,
  reads: Object.values(product.readings).map(({ handle }) => handle.key),
  native: (doc) => (key) => {
    const capture = key === "ducts.snapshot.roster" ? roster : snapshot;
    return JSON.parse(JSON.stringify(capture).replaceAll("MUAS-1", marks[doc]));
  },
  // The roster is a virtual list and jsdom has no layout, so no row is drawn to press: the fan is
  // opened through the subject door a row press calls, from this document's own roster reading.
  async use(doc, j) {
    const slow = { timeout: 20000 };
    const mount = j.mount()!;
    const option = await waitFor(() => {
      const read = mount.value(module.spec.subject!.read);
      const found =
        "value" in read &&
        module.spec
          .subject!.options(read.value as never)
          .find((row) => row.label.includes(marks[doc]));
      expect(found).toBeTruthy();
      return found as { id: string };
    }, slow);
    await act(() => typedSubjectDoor(mount)!.toggle(option.id));
    await waitFor(() => expect(j.search().get("fan")).toContain(option.id), slow);
  },
  shows: (doc) => new RegExp(marks[doc]),
};

test.each(targetPaths)("Fans: %s leaves the old document's fan behind", (path) =>
  targetChange(fans, path),
);
