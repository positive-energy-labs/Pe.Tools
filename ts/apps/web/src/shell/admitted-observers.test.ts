import { expect, test, vi } from "vite-plus/test";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { createAdmittedObservers } from "./admitted-observers";
const graph = {
  subject: { field: "id", show: "show" },
  subjectText: "text",
  predicates: { allowed: "predicate" },
  layout: { kind: "gate", when: "allowed", child: { kind: "pane", id: "main" } },
} as unknown as RouteGraphJson;
test("observers validate booleans and strings, freeze global context and cache gates", () => {
  const predicate = vi.fn((ctx) => {
    expect(Object.keys(ctx)).toEqual(["page", "work", "readings"]);
    expect(Object.isFrozen(ctx.page)).toBe(true);
    return ctx.page.id === "yes";
  });
  const observer = createAdmittedObservers(graph, {
    predicate: { run: predicate },
    show: { run: String },
    text: { run: (ctx) => String(ctx.work?.name) },
  });
  expect(predicate).not.toHaveBeenCalled();
  observer.update({ page: { id: "yes" }, work: { name: "work" }, readings: {} });
  expect(observer.visible("main")).toBe(true);
  expect(observer.subject()).toBe("yes");
  expect(observer.text()).toBe("work");
  observer.visible("main");
  expect(predicate).toHaveBeenCalledOnce();
  observer.update({ page: { id: "no" }, work: null, readings: {} });
  expect(observer.visible("main")).toBe(false);
  expect(() =>
    createAdmittedObservers(graph, { predicate: { run: () => "true" } }).update({ page: {} }),
  ).toThrow();
  expect(() =>
    createAdmittedObservers({ ...graph, predicates: {} }, { show: { run: () => 1 } }).update({
      page: {},
    }),
  ).toThrow();
  expect(() =>
    createAdmittedObservers(
      { ...graph, subject: { ...graph.subject!, show: undefined }, predicates: {} },
      { text: { run: () => [] } },
    ).update({ page: {} }),
  ).toThrow();
});
