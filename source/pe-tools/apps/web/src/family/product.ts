import type { Product } from "#/targeting/model";

export const FAMILY_PRODUCT = (actions: {
  open: () => Promise<string | void>;
  save: () => Promise<string | void>;
  capture: () => Promise<string | void>;
  build: () => Promise<string | void>;
}): Product => ({
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
        { key: "open", label: "open", demands: ["profile"], run: actions.open },
        {
          key: "save",
          label: "save profile",
          demands: ["profile"],
          commit: true,
          run: actions.save,
        },
      ],
    },
    {
      key: "evidence",
      label: "evidence",
      verbs: [
        { key: "capture", label: "capture evidence", demands: ["session"], run: actions.capture },
        {
          key: "build",
          label: "build .rfa",
          demands: ["session", "profile"],
          commit: true,
          run: actions.build,
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
