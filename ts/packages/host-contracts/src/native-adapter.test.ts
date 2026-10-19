import { expect, test } from "vite-plus/test";
import {
  nativeAdapterSchema,
  rendererMessageSchema,
  nativeMessageSchema,
} from "./native-adapter.ts";
import { hostDescriptor, hostDescriptorSchema } from "./host-descriptor.ts";
import { readFileSync } from "node:fs";
import { z } from "zod";

test("native commands reject malformed and unknown fields before dispatch", () => {
  for (const value of [
    { type: "navigate-history", direction: "sideways" },
    { type: "chrome-ready", admin: true },
    { type: "notice-card", height: -1 },
    { type: "notice-card", height: 1.5 },
    { type: "panel-pin", pinned: 1 },
    { type: "panel-hide", unpinnedOnly: "false" },
    { type: "open-window", url: "" },
    { type: "unknown" },
  ])
    expect(rendererMessageSchema.safeParse(value).success).toBe(false);
  expect(rendererMessageSchema.parse({ type: "navigate-history", direction: "back" })).toEqual({
    type: "navigate-history",
    direction: "back",
  });
});

test("native events reject incomplete notices and panel state", () => {
  for (const value of [
    { type: "navigation-request", url: 1 },
    { type: "navigation-history", canGoBack: true },
    { type: "panel-state", pinned: "true" },
    { type: "notice", notice: { id: "n", revision: 1 } },
  ])
    expect(nativeMessageSchema.safeParse(value).success).toBe(false);
  expect(
    nativeMessageSchema.safeParse({
      type: "notice",
      notice: { id: "n", revision: 1, title: "Done", body: "" },
    }).success,
  ).toBe(true);
});

test("tray embeds the JSON schema generated from the same TypeScript authority", () => {
  const embedded = JSON.parse(
    readFileSync(new URL("./native-adapter.schema.json", import.meta.url), "utf8"),
  );
  expect(embedded).toEqual(z.toJSONSchema(nativeAdapterSchema, { reused: "ref" }));
});

test("host features travel with the release version", () => {
  expect(hostDescriptorSchema.parse(hostDescriptor("2026.10.13"))).toEqual({
    version: "2026.10.13",
    features: { peApi: 1, nativeAdapter: 2 },
  });
  expect(hostDescriptorSchema.safeParse({ version: "v1" }).success).toBe(false);
});
