// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";

import { FAMILY_DEMO_PODS } from "#/family/manifest";
import { DEMO_PODS } from "#/route/seeds";

import { DEMO_MEMBER_SPECS } from "#/routes/pods";

describe("/pods demo lane", () => {
  it("seeds every JSON member with its own bytes", () => {
    const keys = [...DEMO_PODS, ...FAMILY_DEMO_PODS].flatMap((pod) =>
      pod.members.filter((m) => m.path.startsWith("settings/")).map((m) => `${pod.id}|${m.path}`),
    );
    const contents = keys.map((key) => DEMO_MEMBER_SPECS.get(key)?.content);
    expect(contents.every((content) => typeof content === "string" && content.length)).toBe(true);
    expect(new Set(contents).size).toBe(keys.length);
  });
});
