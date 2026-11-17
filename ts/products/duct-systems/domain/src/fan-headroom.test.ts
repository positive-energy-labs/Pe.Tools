import { describe, expect, it } from "vite-plus/test";

import { fanLoad } from "./fan-headroom.ts";

describe("fanLoad", () => {
  it("is required over available, over only past the rating", () => {
    expect(fanLoad(0.5, 1)).toMatchObject({ state: "rated", ratio: 0.5, over: false });
    expect(fanLoad(1, 1)).toMatchObject({ ratio: 1, over: false });
    expect(fanLoad(1.5, 1)).toMatchObject({ ratio: 1.5, over: true });
  });
  it("is unrated, never zero or full, without a positive rating", () => {
    expect(fanLoad(0.5, null).state).toBe("unrated");
    expect(fanLoad(0.5, 0).state).toBe("unrated");
    expect(fanLoad(null, 1).state).toBe("unrated");
  });
});
