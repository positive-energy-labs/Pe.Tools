import { expect, test } from "vite-plus/test";
import { address, workKeySchema } from "../src/index.ts";

test("WorkKey declares exactly one binding and refuses competing identities", () => {
  const route = "family";
  const target = address("C:\\Models\\A.rvt");
  const open = { session: "session", openId: "document" };
  for (const key of [
    { binding: "address", route, target },
    { binding: "open", route, target: null, open },
    { binding: "workspace", route, target: null, work: "named" },
    { binding: "host", route, target: null },
  ])
    expect(workKeySchema.safeParse(key).success).toBe(true);
  for (const key of [
    { binding: "address", route, target, open },
    { binding: "open", route, target, open },
    { binding: "workspace", route, target: null, work: "named", open },
    { binding: "workspace", route, target, work: "named" },
    { binding: "host", route, target },
    { route, target },
  ])
    expect(workKeySchema.safeParse(key).success).toBe(false);
});
