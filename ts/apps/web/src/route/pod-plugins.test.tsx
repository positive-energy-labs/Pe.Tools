// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { pluginStatusSchema, podRouteDescriptorSchema } from "@pe/agent-contracts";
import { PodPlugins, type PluginsClient } from "./pod-plugins";

afterEach(cleanup);

const pods = [
  { id: "snowdon-circuits", name: "Snowdon Circuits" },
  { id: "duct-tools", name: "Duct tools" },
];

/** The host's four plugin doors over one inventory; every answer parses through its contract. */
function host() {
  let inventory = pluginStatusSchema.array().parse([
    { id: "pod:snowdon-circuits", status: "active" },
    { id: "pod:duct-tools", status: "disabled" },
    { id: "product:skills", status: "active" },
  ]);
  const sent: string[] = [];
  const set = (id: string, enabled: boolean) => {
    inventory = pluginStatusSchema
      .array()
      .parse(
        inventory.map((p) => (p.id === id ? { ...p, status: enabled ? "active" : "disabled" } : p)),
      );
    return Promise.resolve(inventory);
  };
  const client: PluginsClient = {
    list: () => Promise.resolve(inventory),
    routes: () =>
      Promise.resolve(
        podRouteDescriptorSchema.array().parse([
          {
            sourcePath: "routes/voltage-drop/index.js",
            name: "Voltage Drop",
            description: "Review voltage-drop proposals.",
            key: "route:@snowdon-circuits/routes/voltage-drop/index.js",
            packageId: "snowdon-circuits",
            workRoute: "pod.snowdon-circuits.voltage-drop",
            sha256: "a".repeat(64),
            trusted: true,
          },
        ]),
      ),
    update: (id, enabled) => {
      sent.push(`update ${id} ${enabled}`);
      return set(id, enabled);
    },
  };
  return { client, sent };
}

test("the switch is the one way to turn a Pod off: plugin.update, no Remove, and it names the route that goes", async () => {
  const { client, sent } = host();
  render(<PodPlugins pods={pods} client={client} />);
  const snowdon = await screen.findByRole("switch", { name: "Snowdon Circuits" });
  expect(snowdon.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("switch", { name: "Duct tools" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => snowdon.focus());
  expect((await screen.findByRole("tooltip")).textContent).toMatch(
    /serves its route Voltage Drop\. Off: the folder stays in Pods/,
  );

  fireEvent.click(snowdon);
  await waitFor(() => expect(sent).toEqual(["update pod:snowdon-circuits false"]));
  await waitFor(() => expect(snowdon.getAttribute("aria-checked")).toBe("false"));
});
