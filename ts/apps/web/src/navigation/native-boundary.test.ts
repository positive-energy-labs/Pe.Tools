import { expect, test } from "vite-plus/test";
import { nativeNavigationHistory } from "./surface-host";

test("renderer refuses a native history frame outside its contract", () => {
  expect(
    nativeNavigationHistory({
      type: "navigation-history",
      canGoBack: true,
      canGoForward: false,
      unexpected: true,
    }),
  ).toBeNull();
});
