// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useEffect } from "react";
import { defineRoutePlugin } from "@pe/kit/route-registry";

vi.mock("#/route/builtin-routes", async () => {
  const { createRouteRegistry } = await import("@pe/kit/route-registry");
  return { publicRoutes: createRouteRegistry() };
});
import { publicRoutes } from "#/route/builtin-routes";
import { useChatPluginHost } from "./route-panes";

afterEach(cleanup);

test("removing a public route unmounts its kept pane and removes its discovery and action owner", () => {
  const stopped = vi.fn();
  function Hosted() {
    useEffect(() => stopped, []);
    return <span>Registered public surface</span>;
  }
  const remove = publicRoutes.register(
    defineRoutePlugin({
      manifest: { key: "external", name: "External", runs: ["external.apply"] },
      hosted: Hosted,
    }),
  );
  function Pane() {
    const { slot, kept } = useChatPluginHost("external", "thread1");
    return (
      <>
        <div ref={slot} />
        {kept}
      </>
    );
  }
  render(<Pane />);
  expect(screen.getByText("Registered public surface")).toBeTruthy();
  act(() => {
    void remove();
  });
  expect(screen.queryByText("Registered public surface")).toBeNull();
  expect(stopped).toHaveBeenCalledOnce();
  expect(publicRoutes.keys()).not.toContain("external");
  expect(publicRoutes.actionRoute("external.apply")).toBeNull();
});
