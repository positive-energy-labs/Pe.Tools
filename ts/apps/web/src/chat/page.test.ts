import { afterEach, expect, test, vi } from "vite-plus/test";
import { peaSettingFields } from "@pe/agent-contracts";
import { admitChat } from "./admission";
import { chatData, selectedThreads, threadIdentity } from "./graph";
import { selectionCodec } from "#/shell/page-port";
import { sourceRouteServices } from "#/shell/source-route-services";
import { createRouteShell } from "#/shell/admitted-mount";
import { createSettingsOwner } from "#/shell/settings";
import { placeInput } from "#/shell/admitted-place.test-fixture";
const closes: (() => void)[] = [];
afterEach(() => closes.splice(0).forEach((close) => close()));
const inert = () =>
  sourceRouteServices(
    Object.fromEntries(
      Object.keys(chatData.readings).map((id) => [id, { kind: "use" as const, open() {} }]),
    ),
  );
test("restored all stays dynamic as the roster grows; explicit subsets keep their identities", async () => {
  let search = new URLSearchParams("selected=all");
  const route = await admitChat(() => ({ thread: "" }));
  const mount = createRouteShell(inert()).mount(
    route,
    placeInput({
      read: () => search,
      write(next) {
        search = next;
      },
      subscribe: () => () => {},
    }),
  );
  closes.push(mount.dispose);
  expect(mount.page.read().selected).toBe("all");
  const roster = [{ id: "first" }];
  expect(selectedThreads(mount.page.read().selected, roster)).toEqual(["first"]);
  roster.push({ id: "later" });
  expect(selectedThreads(mount.page.read().selected, roster)).toEqual(["first", "later"]);
  mount.controls.query("mode", "world");
  expect(search.get("selected")).toBe("all");
  mount.page.select([{ kind: "thread", id: threadIdentity("first")! }]);
  const subset = mount.page.read().selected;
  expect(selectedThreads(subset, roster)).toEqual(["first"]);
  expect(JSON.parse(search.get("selected")!)).toEqual(subset);
  expect(selectionCodec(chatData, ["thread"]).decode("all").ok).toBe(false);
  const codec = selectionCodec(chatData, ["thread"], true);
  expect(
    codec.normalize([
      { kind: "thread", id: threadIdentity("first")! },
      { kind: "thread", id: threadIdentity("first")! },
    ]),
  ).toEqual({ ok: true, value: subset });
  expect(codec.normalize([{ kind: "thread", id: "invented-native-id" }]).ok).toBe(false);
});
test("autoApprove uses the existing acknowledged settings owner and stays off the Page URL", async () => {
  let acknowledge!: (value: { revision: number; values: { autoApprove: boolean } }) => void;
  const write = vi.fn(
    () =>
      new Promise<{ revision: number; values: { autoApprove: boolean } }>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const settings = createSettingsOwner(peaSettingFields, {
    read: async () => ({ revision: 4, values: { autoApprove: false } }),
    write,
    subscribe: () => () => {},
  });
  const route = await admitChat(() => ({ thread: "" }));
  let search = new URLSearchParams();
  const mount = createRouteShell(inert(), settings).mount(
    route,
    placeInput({
      read: () => search,
      write(next) {
        search = next;
      },
      subscribe: () => () => {},
    }),
  );
  closes.push(mount.dispose);
  await vi.waitFor(() => expect(mount.page.read().autoApprove).toBe(false));
  mount.page.set("autoApprove", true);
  expect(write).toHaveBeenCalledWith({ autoApprove: true }, 4, expect.any(AbortSignal));
  expect(mount.page.read().autoApprove).toBe(false);
  acknowledge({ revision: 5, values: { autoApprove: true } });
  await vi.waitFor(() => expect(mount.page.read().autoApprove).toBe(true));
  mount.controls.query("mode", "world");
  expect(search.has("autoApprove")).toBe(false);
  expect(settings.read().revision).toBe(5);
});
