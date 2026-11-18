import { expect, it } from "vite-plus/test";

import { healWords, outcomeWords } from "./words.ts";

it("says only the outcomes that happened, and what an empty answer means", () => {
  expect(outcomeWords({ counts: { planned: 3, refused: 0, applied: 2 } } as never)).toBe(
    "3 planned · 2 applied",
  );
  expect(outcomeWords({ counts: { planned: 0 } } as never)).toBe("nothing to write");
  expect(healWords({ counts: { planned: 0 } } as never)).toBe("nothing to heal");
});
