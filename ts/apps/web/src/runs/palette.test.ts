import { describe, expect, it } from "vite-plus/test";

import { RESIDUE_TREATMENT } from "./palette";
import law from "./visual-law.json";

describe.each(["void", "excluded"] as const)("%s residue treatment", (kind) => {
  it("uses the law's outline and hatch without a solid fill", () => {
    const treatment = RESIDUE_TREATMENT[kind];

    expect(treatment.fill).toBeNull();
    expect(treatment.outline).toEqual({
      color: `rgba(${law[kind].outline.rgba.join(",")})`,
      widthPx: law[kind].outline.widthPx,
    });
    expect(treatment.hatch).toEqual({
      angleDeg: law[kind].hatch.angleDeg,
      color: `rgba(${law[kind].hatch.rgba.join(",")})`,
      spacingPx: law[kind].hatch.spacingPx,
      widthPx: law[kind].hatch.widthPx,
    });
  });
});
