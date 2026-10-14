// @vitest-environment jsdom
import { Activity, useState, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  SettingsProvider,
  SettingsProjection,
  usePublishRouteOptions,
  useRouteOptions,
} from "./options";
import {
  createPageOptions,
  type PageOption,
  type SettingsOption,
  type GlobalOption,
  type SettingsPanel,
} from "./option-state";
import { useThemeMode, writeTheme } from "@pe/kit/theme";
import {
  registerGlobalOptions,
  readGlobalOptions,
  subscribeGlobalOptions,
} from "./option-catalogue";
import { defineRoute } from "#/route/manifest";

vi.mock("#/navigation/route-controls", () => ({ useIsPrimaryRoute: () => true }));
const host = vi.hoisted(() => ({ surface: "web" as "web" | "tray" | "pwa" }));
const go = vi.hoisted(() => vi.fn());
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => host }));
vi.mock("#/navigation/state", () => ({ useDestination: () => go }));
afterEach(cleanup);

const fixtureOptions: readonly PageOption<{ compact: boolean }>[] = [
  {
    id: "fixture-compact",
    label: "Compact fixture",
    scope: "page",
    kind: "boolean",
    surfaces: ["web", "pwa", "tray"],
    projections: ["quick", "form"],
    read: (page) => page.compact,
    patch: (compact) => ({ compact }),
  },
];
function FixtureOwner() {
  const [page, update] = useState({ compact: false });
  usePublishRouteOptions("fixture", "Fixture", fixtureOptions, page, (patch) =>
    update((prior) => ({ ...prior, ...patch })),
  );
  return <output data-testid="owner">{String(page.compact)}</output>;
}
test("quick and full projections edit the same page owner and hidden owners release", () => {
  let options: readonly SettingsOption[] = [];
  function Witness() {
    options = useRouteOptions()?.options ?? [];
    return null;
  }
  const tree = (mode: "visible" | "hidden") => (
    <SettingsProvider>
      <Activity mode={mode}>
        <FixtureOwner />
      </Activity>
      <Witness />
      <SettingsProjection quick />
      <SettingsProjection subject="fixture" />
    </SettingsProvider>
  );
  const view = render(tree("visible"));
  const controls = view.getAllByRole("switch", { name: "Compact fixture" });
  const former = options[0]!;
  fireEvent.click(controls[0]!);
  expect(view.getByTestId("owner").textContent).toBe("true");
  expect(
    view
      .getAllByRole("switch", { name: "Compact fixture" })
      .map((control) => control.getAttribute("aria-checked")),
  ).toEqual(["true", "true"]);
  if (former.kind === "boolean") act(() => former.binding.write(false));
  expect(view.getByTestId("owner").textContent).toBe("true");
  view.rerender(tree("hidden"));
  expect(view.queryAllByRole("switch", { name: "Compact fixture" })).toHaveLength(0);
  expect(view.getByText("Page controls stay in the page's Settings menu.")).toBeTruthy();
});

test("replacement and late cleanup cannot authorize the old page control", () => {
  const store = createPageOptions();
  const old = Symbol("old");
  const next = Symbol("next");
  const write = vi.fn();
  store.claim({ owner: old, route: "fixture", name: "Fixture", options: [] });
  const staleControl = () => store.write(old, write);
  store.claim({ owner: next, route: "fixture", name: "Fixture", options: [] });
  store.release(old);
  staleControl();
  expect(store.read()?.owner).toBe(next);
  expect(write).not.toHaveBeenCalled();
  store.write(next, write);
  expect(write).toHaveBeenCalledTimes(1);
  store.release(next);
  store.write(next, write);
  expect(write).toHaveBeenCalledTimes(1);
});

test("durable route bindings survive Page unmount and honor subject, surface, and projection", () => {
  let enabled = false;
  const listeners = new Set<() => void>();
  const binding = {
    read: () => enabled,
    write: (value: boolean) => {
      enabled = value;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const global: GlobalOption = {
    id: "fixture-global",
    label: "Durable fixture",
    scope: "route",
    kind: "boolean",
    surfaces: ["web"],
    projections: ["quick", "form"],
    binding,
  };
  const trayForm: GlobalOption = {
    ...global,
    id: "fixture-tray-form",
    label: "Tray form fixture",
    surfaces: ["tray"],
    projections: ["form"],
  };
  const manifest = defineRoute({
    key: "family",
    name: "Family fixture",
    options: fixtureOptions,
    globalOptions: [global, trayForm],
  });
  function PageOwner() {
    const [page, setPage] = useState({ compact: false });
    usePublishRouteOptions(manifest.key, manifest.name, manifest.options, page, (patch) =>
      setPage((prior) => ({ ...prior, ...patch })),
    );
    return null;
  }
  const tree = (mounted: boolean, subject = "family") => (
    <SettingsProvider>
      {mounted && <PageOwner />}
      <SettingsProjection quick subject={subject} />
      <SettingsProjection subject={subject} />
    </SettingsProvider>
  );
  const view = render(tree(true));
  fireEvent.click(view.getAllByRole("switch", { name: "Durable fixture" })[0]!);
  expect(enabled).toBe(true);
  expect(
    view
      .getAllByRole("switch", { name: "Durable fixture" })
      .map((control) => control.getAttribute("aria-checked")),
  ).toEqual(["true", "true"]);
  view.rerender(tree(false));
  expect(view.queryAllByRole("switch", { name: "Compact fixture" })).toHaveLength(0);
  expect(view.getAllByRole("switch", { name: "Durable fixture" })).toHaveLength(2);
  act(() => binding.write(false));
  expect(
    view
      .getAllByRole("switch", { name: "Durable fixture" })
      .map((control) => control.getAttribute("aria-checked")),
  ).toEqual(["false", "false"]);
  view.rerender(tree(false, "chat"));
  expect(view.queryAllByRole("switch", { name: "Durable fixture" })).toHaveLength(0);
  host.surface = "tray";
  view.rerender(tree(false));
  expect(view.queryAllByRole("switch", { name: "Durable fixture" })).toHaveLength(0);
  expect(view.getAllByRole("switch", { name: "Tray form fixture" })).toHaveLength(1);
  cleanup();
  host.surface = "web";
  registerGlobalOptions("family", "Family fixture", []);
});

test("late route imports notify once and preserve snapshots for identical descriptor references", () => {
  const notify = vi.fn();
  const unsubscribe = subscribeGlobalOptions(notify);
  const descriptor: GlobalOption = {
    id: "late-fixture",
    label: "Late fixture",
    scope: "machine",
    kind: "boolean",
    surfaces: ["web"],
    projections: ["form"],
    binding: { read: () => false, write: () => {} },
  };
  registerGlobalOptions("pea", "Late fixture", [descriptor]);
  const snapshot = readGlobalOptions();
  expect(snapshot.find((section) => section.route === "chat")?.options[0]).toBe(descriptor);
  registerGlobalOptions("chat", "Late fixture", [descriptor]);
  expect(readGlobalOptions()).toBe(snapshot);
  expect(notify).toHaveBeenCalledTimes(1);
  unsubscribe();
  registerGlobalOptions("chat", "Late fixture", []);
});

test("owner-declared custom forms project quick links and remain live after their Page unmounts", () => {
  let value = "first";
  const listeners = new Set<() => void>();
  const read = () => value;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  function Form() {
    const current = useSyncExternalStore(subscribe, read, read);
    return <output data-testid="custom-owner-value">{current}</output>;
  }
  const panel: SettingsPanel = {
    id: "custom-fixture",
    label: "Fixture form",
    scope: "route",
    surfaces: ["web"],
    render: Form,
  };
  defineRoute({ key: "family", name: "Family fixture", settingsPanels: [panel] });
  const tree = (mounted: boolean, section = panel.id, subject = "family") => (
    <SettingsProvider>
      {mounted && <FixtureOwner />}
      <SettingsProjection quick subject={subject} />
      <SettingsProjection subject={subject} section={section} />
    </SettingsProvider>
  );
  const view = render(tree(true));
  expect(view.getAllByTestId("custom-owner-value")).toHaveLength(1);
  fireEvent.click(view.getAllByRole("button", { name: panel.label })[0]!);
  expect(go).toHaveBeenCalledWith("/settings?subject=family&section=custom-fixture");
  view.rerender(tree(false));
  act(() => {
    value = "second";
    listeners.forEach((listener) => listener());
  });
  expect(view.getByTestId("custom-owner-value").textContent).toBe("second");
  view.rerender(tree(false, "other"));
  expect(view.queryByTestId("custom-owner-value")).toBeNull();
  view.rerender(tree(false, panel.id, "chat"));
  expect(view.queryByRole("button", { name: panel.label })).toBeNull();
  host.surface = "tray";
  view.rerender(tree(false));
  expect(view.queryByRole("button", { name: panel.label })).toBeNull();
  cleanup();
  host.surface = "web";
  registerGlobalOptions("family", "Family fixture", []);
});

function ThemeWitness({ id }: { id: string }) {
  const mode = useThemeMode();
  return <output data-testid={id}>{mode}</output>;
}
test("theme projections share one store and retain storage sync after first subscriber leaves", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const priorStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  window.localStorage.setItem("theme", "auto");
  const tree = (first: boolean) => (
    <>
      {first && <ThemeWitness id="first" />}
      <ThemeWitness id="second" />
      <SettingsProjection quick />
      <SettingsProjection />
    </>
  );
  const view = render(tree(true));
  fireEvent.click(view.getAllByRole("button", { name: "Dark" })[0]!);
  expect(view.getByTestId("first").textContent).toBe("dark");
  expect(view.getByTestId("second").textContent).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  view.rerender(tree(false));
  window.localStorage.setItem("theme", "light");
  const event = new Event("storage");
  Object.defineProperties(event, { key: { value: "theme" }, storageArea: { value: storage } });
  fireEvent(window, event);
  expect(view.getByTestId("second").textContent).toBe("light");
  expect(document.documentElement.style.colorScheme).toBe("light");
  cleanup();
  writeTheme("auto");
  if (priorStorage) Object.defineProperty(window, "localStorage", priorStorage);
});
