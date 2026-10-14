// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { MachineNotice } from "@pe/agent-contracts";

import { OsNotices, setOsNotices } from "./os-notices";

type Follow = Parameters<typeof import("./notice-follow").followNotices>[0];
let follow: Follow | undefined;
const stop = vi.fn();
vi.mock("./notice-follow", () => ({
  followNotices: (options: Follow) => {
    follow = options;
    return stop;
  },
}));
vi.mock("#/navigation/surface-host", () => ({
  useSurfaceHost: () => ({ surface: "web", native: false }),
}));

const finished: MachineNotice = {
  id: "n1",
  revision: 1,
  title: "Pea finished · ducts",
  body: "Resized 41 of 43.",
  href: "/pea?thread=t1",
  act: { kind: "reply", threadId: "t1" },
};
const raised: { title: string; options: NotificationOptions }[] = [];
let permission: NotificationPermission;

beforeEach(() => {
  follow = undefined;
  raised.length = 0;
  permission = "granted";
  stop.mockReset();
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  vi.stubGlobal(
    "Notification",
    class {
      static get permission() {
        return permission;
      }
      static requestPermission = vi.fn(async () => permission);
      onclick: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions) {
        raised.push({ title, options });
      }
      close() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("nothing follows until the person opts in, and denial leaves it off", async () => {
  render(<OsNotices />);
  expect(follow).toBeUndefined();
  permission = "denied";
  expect(await setOsNotices(true)).toBe("denied");
  expect(follow).toBeUndefined();
  permission = "granted";
  await act(async () => void (await setOsNotices(true)));
  expect(follow).toBeDefined();
});

test("a card item becomes an OS notification only while no tray follows, once", async () => {
  render(<OsNotices />);
  await act(async () => void (await setOsNotices(true)));
  act(() => follow!.onTray(true));
  act(() => follow!.onNotice(finished));
  expect(raised).toEqual([]);
  act(() => follow!.onTray(false));
  act(() => follow!.onNotice({ ...finished, id: "n2" }));
  expect(raised).toHaveLength(1);
  expect(raised[0]).toMatchObject({
    title: "Pea finished · ducts",
    options: { body: "Resized 41 of 43.", tag: "n2" },
  });
  // The same revision again (a replay) is already acknowledged.
  act(() => follow!.onNotice({ ...finished, id: "n2" }));
  expect(raised).toHaveLength(1);
});

test("the thread the window is showing and focused on raises nothing", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  history.replaceState(null, "", "/pea?thread=t1");
  try {
    render(<OsNotices />);
    await act(async () => void (await setOsNotices(true)));
    act(() => follow!.onNotice(finished));
    expect(raised).toEqual([]);
  } finally {
    history.replaceState(null, "", "/");
  }
});
