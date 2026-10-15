import { expect, test } from "vite-plus/test";
import { nativeMessageSchema } from "@pe/host-contracts/native-adapter";
import { nativeNavigationHistory } from "./surface-host";

test.each([
  [true, false],
  [false, true],
  [false, false],
  [true, true],
])(
  "renderer projects the admitted history frame: back=%s forward=%s",
  (canGoBack, canGoForward) => {
    const frame = nativeMessageSchema.parse({
      type: "navigation-history",
      canGoBack,
      canGoForward,
    });
    expect(nativeNavigationHistory(frame)).toEqual({ canGoBack, canGoForward });
  },
);

test("renderer refuses a native history frame outside its contract", () => {
  const frame = nativeMessageSchema.parse({
    type: "navigation-history",
    canGoBack: true,
    canGoForward: false,
  });
  const invalid = { ...frame, unexpected: true };
  expect(() => nativeMessageSchema.parse(invalid)).toThrow();
  expect(nativeNavigationHistory(invalid)).toBeNull();
  expect(
    nativeNavigationHistory(
      nativeMessageSchema.parse({ type: "navigation-request", url: "/open" }),
    ),
  ).toBeNull();
});
