// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
  declareMembers,
  rung,
  setHovered,
  cite,
  type SubjectKey,
} from "../src/components/lang/attention";
import { kitRegistry } from "./attention-fixture";

test("kit names no feature's subject kinds and builds no plural keys", () => {
  const source = readFileSync(`${__dirname}/../src/components/lang/attention.tsx`, "utf8");
  expect(source).not.toMatch(/["`](run|leg|system|room|issue):/);
  expect(source).not.toMatch(/JSON\.(stringify|parse)\(keys|JSON\.parse\(key\.slice/);
  expect(source).not.toMatch(/SubjectKind/);
});

test("a plural row lights through its declared members, and its members light through it", () => {
  const registry = kitRegistry();
  const release = declareMembers(
    registry,
    "kit",
    new Map<SubjectKey, SubjectKey[]>([["card:a", ["e:1", "e:2"]]]),
  );
  const card = rung({ doc: "kit", key: "card:a" });
  const one = rung({ doc: "kit", key: "e:1" });
  const three = rung({ doc: "kit", key: "e:3" });
  setHovered(registry, { doc: "kit", key: "e:1" });
  expect([registry.get(card), registry.get(three)]).toEqual(["hover", "rest"]);
  setHovered(registry, { doc: "kit", key: "card:a" });
  expect(registry.get(one)).toBe("hover");
  setHovered(registry, null);
  cite(registry, {
    owner: "t",
    refs: [{ doc: "kit", key: "e:2", name: "x", number: 1 }],
    focus: null,
  });
  expect(registry.get(card)).toBe("reach");
  release();
  expect(registry.get(card)).toBe("rest");
});
