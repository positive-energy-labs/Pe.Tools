import { expect, test } from "vite-plus/test";
import { parseTarget } from "./route-target";

test.each(['{"kind":"open"', ' {"kind":"wrong"}', '[{"kind":"open"}]'])(
  "access-063: JSON target %s is never reinterpreted as a session",
  (raw) => {
    expect(parseTarget(raw)).toMatchObject({ kind: "invalid", raw });
  },
);
