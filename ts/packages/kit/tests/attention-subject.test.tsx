// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { decode } from "@pe/agent-contracts";
import { elementKey } from "../src/components/lang/attention";
import { FactChip } from "../src/components/lang/chip";
import { Row } from "../src/components/lang/row";
import { AttentionFixture } from "./attention-fixture";

afterEach(cleanup);

test("an element's attention key is its UniqueId SubjectRef code", () => {
  const ref = decode(elementKey("0f1e2d3c-0000-4a5b-8c9d-aaaaaaaaaaaa-0001a2b3"));
  expect(ref.ok && ref.value).toMatchObject({
    keyKind: "UniqueId",
    key: "0f1e2d3c-0000-4a5b-8c9d-aaaaaaaaaaaa-0001a2b3",
  });
});

test("an ElementId is never identity: it is refused as an attention key", () => {
  expect(() => elementKey("5")).toThrow();
});

test("two elements sharing an ElementId (other document, or a stale id) mint different keys", () => {
  const { container } = render(
    <AttentionFixture>
      <Row label="a" revit={[5]} uniqueIds={["uid-a"]} />
      <FactChip title="b" revit={[5]} uniqueIds={["uid-b"]}>
        b
      </FactChip>
    </AttentionFixture>,
  );
  const keys = [...container.querySelectorAll("[data-subject]")].map((n) =>
    n.getAttribute("data-subject"),
  );
  expect(keys).toEqual([elementKey("uid-a"), elementKey("uid-b")]);
  // The ElementId stays the select payload.
  expect(container.querySelectorAll('[data-revit-ids="5"]')).toHaveLength(2);
});
