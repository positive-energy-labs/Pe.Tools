import type { Product } from "#/targeting/model";
import { fileTerminal } from "#/targeting/trunks";

export const SETTINGS_FILE_TERMINAL = fileTerminal("file", "duplex");

export const SETTINGS_PRODUCT = (actions: {
  open(): Promise<string | void>;
  refresh(): Promise<string | void>;
  validate(): Promise<string | void>;
  save(): Promise<string | void>;
}): Product => ({
  key: "settings",
  name: "settings",
  links: [
    { key: "workspace", joiner: "", placeholder: "a workspace", needs: "a settings workspace" },
    {
      key: "module",
      parent: "workspace",
      joiner: "",
      placeholder: "a module",
      needs: "a settings module",
    },
    { key: "root", parent: "module", joiner: "", placeholder: "a root", needs: "a settings root" },
    { ...SETTINGS_FILE_TERMINAL.link, parent: "root" },
  ],
  stages: [
    {
      key: "document",
      label: "document",
      verbs: [
        { key: "open", label: "open", demands: ["file"], run: actions.open },
        { key: "refresh", label: "re-read", demands: ["file"], run: actions.refresh },
        { key: "validate", label: "validate", demands: ["file"], run: actions.validate },
        { key: "save", label: "save", demands: ["file"], commit: true, run: actions.save },
      ],
    },
  ],
  panes: [{ key: "fields", label: "fields", draws: ["file"] }],
});
