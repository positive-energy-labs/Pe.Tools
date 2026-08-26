import { product, type Feeds } from "#/targeting/model";

export const SETTINGS_SLOTS = {
  workspace: {
    key: "workspace",
    under: null,
    joiner: "",
    placeholder: "a workspace",
    multi: false,
    needs: "a settings workspace",
    dir: null,
    liveness: null,
  },
  module: {
    key: "module",
    under: "workspace",
    joiner: "",
    placeholder: "a module",
    multi: false,
    needs: "a settings module",
    dir: null,
    liveness: null,
  },
  root: {
    key: "root",
    under: "module",
    joiner: "",
    placeholder: "a root",
    multi: false,
    needs: "a settings root",
    dir: null,
    liveness: null,
  },
  file: {
    key: "file",
    under: "root",
    joiner: "editing",
    placeholder: "a settings file",
    multi: false,
    needs: "an authoring file",
    dir: "duplex",
    liveness: "detached",
  },
} as const;

export type SettingsSlot = keyof typeof SETTINGS_SLOTS;

export const SETTINGS_PRODUCT = (
  feeds: Feeds<SettingsSlot>,
  actions: {
    open(): Promise<string | void>;
    refresh(): Promise<string | void>;
    validate(): Promise<string | void>;
    save(): Promise<string | void>;
  },
) =>
  product(
    "settings",
    "settings",
    SETTINGS_SLOTS,
  )({
    feeds,
    stages: [
      {
        key: "document",
        label: "document",
        verbs: [
          {
            key: "open",
            label: "open",
            demands: ["file"],
            kind: "act",
            run: () => actions.open(),
            refuse: () => null,
            needs: "a settings file",
          },
          {
            key: "refresh",
            label: "re-read",
            demands: ["file"],
            kind: "act",
            run: () => actions.refresh(),
            refuse: () => null,
            needs: "a settings file",
          },
          {
            key: "validate",
            label: "validate",
            demands: ["file"],
            kind: "act",
            run: () => actions.validate(),
            refuse: () => null,
            needs: "a settings file",
          },
          {
            key: "save",
            label: "save",
            demands: ["file"],
            kind: "commit",
            run: () => actions.save(),
            refuse: () => null,
            needs: "a valid settings file",
          },
        ],
      },
    ],
    panes: [{ key: "fields", label: "fields", draws: ["file"] }],
  });
