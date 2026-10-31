/** A pressure-gaining part counts 0 ft; its dp stays signed (FC-23 13890167: ER5-1 Cb -2.65). */
import { expect, it } from "vite-plus/test";
import { withEquivalentLength } from "./equivalent-length.ts";
import type { Row } from "./losses.ts";

it("never gives a negative length to a part that gains pressure", () => {
  const rows = [
    { kind: "friction", dp: 0.0001, lengthFt: 17, rate: 0.000585 },
    { kind: "fitting", dp: -0.003423 },
  ] as unknown as Row[];
  const [, gain] = withEquivalentLength(rows, 0.08);
  expect(gain!.eqFt).toBe(0);
  expect(gain!.dp).toBe(-0.003423);
});
