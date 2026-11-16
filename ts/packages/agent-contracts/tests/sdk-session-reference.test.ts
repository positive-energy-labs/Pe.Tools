import { expect, it } from "vite-plus/test";
import {
  sdkSessionReferenceSchema,
  sdkSessionSelectionSchema,
  sdkSessionTargetSchema,
} from "../src/sdk-session.ts";

const exact = { session: "4242", processIncarnation: { pid: 42, startedAt: 1000 } };

it("retains an exact public SDK id and process separately from a selection", () => {
  expect(sdkSessionReferenceSchema.parse(exact)).toEqual(exact);
  expect(sdkSessionTargetSchema.parse(exact)).toEqual(exact);
  expect(sdkSessionSelectionSchema.safeParse(exact).success).toBe(false);
  expect(sdkSessionTargetSchema.parse({ id: "4242" })).toEqual({ id: "4242" });
});

it.each([
  { session: "4242" },
  { session: "4242", processIncarnation: { pid: 42 } },
  { session: "", processIncarnation: { pid: 42, startedAt: 1000 } },
  { ...exact, processIncarnation: { pid: 0, startedAt: 1000 } },
  { ...exact, processIncarnation: { pid: 42, startedAt: 0 } },
  { ...exact, processIncarnation: { pid: 42, startedAt: 1.5 } },
  { ...exact, processIncarnation: { pid: 42, startedAt: Number.MAX_SAFE_INTEGER + 1 } },
  { ...exact, id: "other" },
])("refuses incomplete or mixed exact identity %#", (value) => {
  expect(sdkSessionTargetSchema.safeParse(value).success).toBe(false);
});
