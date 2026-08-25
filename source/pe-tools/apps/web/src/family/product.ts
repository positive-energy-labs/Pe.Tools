import type { Product, Verb } from "#/targeting/model";

export const FAMILY_PRODUCT = (verbs: Record<"open" | "save" | "capture" | "build", Pick<Verb, "run" | "refuse">>): Product => ({
  key: "family",
  name: "family",
  links: [
    {
      key: "session",
      joiner: "editing",
      placeholder: "a Revit session",
      needs: "a bound Revit family editor session",
      dir: "duplex",
      liveness: "attached",
    },
    {
      key: "profile",
      joiner: "on",
      placeholder: "a family profile",
      needs: "a family document path visible to the bound session",
      dir: "duplex",
      liveness: "detached",
    },
  ],
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
        { key: "capture", label: "capture evidence", demands: ["session"], ...verbs.capture },
        {
          key: "build",
          label: "build .rfa",
          demands: ["session", "profile"],
          commit: true,
          ...verbs.build,
        },
      ],
    },
  ],
  panes: [
    { key: "sheet", label: "sheet", draws: ["profile"] },
    { key: "anatomy", label: "anatomy", draws: ["profile"] },
    { key: "drill", label: "drill", draws: ["session", "profile"] },
    { key: "inspector", label: "inspector", draws: ["profile"] },
  ],
});
