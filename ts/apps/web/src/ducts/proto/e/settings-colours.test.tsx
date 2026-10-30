// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import {
  ductsSettingFields,
  settingsSchema,
  type RouteSettingsSnapshot,
} from "@pe/agent-contracts";
import { ductsGraph } from "../../graph";
import { GraphSettingsFields } from "#/shell/settings-fields";
import { createSettingsOwner } from "#/shell/settings";

afterEach(cleanup);
function fixture(fail = false) {
  let saved: RouteSettingsSnapshot = {
    revision: 0,
    values: settingsSchema(ductsSettingFields).parse({}) as RouteSettingsSnapshot["values"],
  };
  const owner = createSettingsOwner(ductsSettingFields, {
    read: async () => saved,
    write: async (patch, revision) => {
      if (fail) throw Error("Settings changed elsewhere");
      expect(revision).toBe(saved.revision);
      saved = {
        revision: revision + 1,
        values: { ...saved.values, ...patch } as RouteSettingsSnapshot["values"],
      };
      return saved;
    },
    subscribe: () => () => {},
  });
  return owner;
}
test("the kernel colour picker persists settings and survives remount", async () => {
  const owner = fixture();
  const view = render(<GraphSettingsFields graph={ductsGraph} owner={owner} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Supply air colour").hasAttribute("disabled")).toBe(false),
  );
  expect(view.container.querySelectorAll('input[type="color"]')).toHaveLength(5);
  fireEvent.change(screen.getByLabelText("Supply air colour"), { target: { value: "#123456" } });
  await waitFor(() => expect(owner.read().values.supplyColour).toBe("#123456"));
  view.unmount();
  render(<GraphSettingsFields graph={ductsGraph} owner={owner} />);
  expect((screen.getByLabelText("Supply air colour") as HTMLInputElement).value).toBe("#123456");
});
test("a refused settings write explains why and retains the acknowledged value", async () => {
  const owner = fixture(true);
  render(<GraphSettingsFields graph={ductsGraph} owner={owner} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Return air colour").hasAttribute("disabled")).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Return air colour"), { target: { value: "#123456" } });
  await screen.findByText("Settings changed elsewhere");
  expect(owner.read().values.returnColour).toBe("#02bba4");
});
