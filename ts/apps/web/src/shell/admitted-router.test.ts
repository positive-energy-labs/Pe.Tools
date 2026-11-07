// @vitest-environment jsdom
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { expect, test } from "vite-plus/test";
import { module as fans } from "../fans/route.ts";
import { module as ducts } from "../ducts/route.ts";
import { fansLink } from "../fans/route.ts";
import { ductsLink, localId } from "../ducts/identity.ts";
import { jsonCodec } from "@pe/agent-contracts";
import { admittedRouteSearch } from "./admitted-pane.tsx";

test("fan and system links survive router parsing, validation and URL canonicalization", () => {
  const fan = "9cb9f188-28aa-4094-8b76-785395cc35e1-00000001@2";
  const system = "SA Office, North";
  const binding = { fixture: "scene", thread: "thread-1" };
  for (const { module, field, link, expected } of [
    { module: fans, field: "fan", link: fansLink([fan], binding), expected: localId("ducts-fan", fan) },
    { module: ducts, field: "system", link: ductsLink([system], binding), expected: localId("ducts-system", system) },
  ] as const) {
    const linked = new URL(link, "https://fixture.invalid");
    const parsed = defaultParseSearch(linked.search);
    const validated = admittedRouteSearch(module.data)(parsed);
    const canonical = new URL(linked.pathname + defaultStringifySearch(validated), linked);
    expect(canonical.searchParams.get(field)).toBe(linked.searchParams.get(field));
    const codec = field === "fan" ? jsonCodec(fans.spec.fields.fan.schema) : jsonCodec(ducts.spec.fields.system.schema);
    expect(codec.decode(canonical.searchParams.get(field) ?? "")).toEqual({
      ok: true, value: { kind: "ids", ids: [expected] },
    });
    expect(canonical.searchParams.get("fixture")).toBe("scene");
    expect(canonical.searchParams.get("thread")).toBe("thread-1");
  }
});
