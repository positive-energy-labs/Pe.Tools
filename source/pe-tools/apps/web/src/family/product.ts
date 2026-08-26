import type { Product, Verb } from "#/targeting/model";
import { profileTerminal, worldTrunk } from "#/targeting/trunks";

const profile = profileTerminal("duplex");

export const FAMILY_PRODUCT = (
  verbs: Record<"open" | "save" | "capture" | "build", Pick<Verb, "run" | "refuse">>,
): Product => ({
  key: "family",
  name: "family",
  links: [worldTrunk.link, { ...profile.link, parent: "world" }],
  stages: [
    {
      key: "author",
      label: "author",
      verbs: [
        { key: "open", label: "open", demands: ["profile"], ...verbs.open },
        {
          key: "save",
          label: "save profile",
          demands: ["profile"],
          commit: true,
          ...verbs.save,
        },
      ],
    },
    {
      key: "evidence",
      label: "evidence",
      verbs: [
        { key: "capture", label: "capture evidence", demands: ["world"], ...verbs.capture },
        {
          key: "build",
          label: "build .rfa",
          demands: ["world", "profile"],
          commit: true,
          ...verbs.build,
        },
      ],
    },
  ],
  panes: [
    { key: "sheet", label: "sheet", draws: ["profile"] },
    { key: "anatomy", label: "anatomy", draws: ["profile"] },
    { key: "drill", label: "drill", draws: ["world", "profile"] },
    { key: "inspector", label: "inspector", draws: ["profile"] },
  ],
});
