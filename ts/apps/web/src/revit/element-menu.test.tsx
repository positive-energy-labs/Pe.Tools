// @vitest-environment jsdom
import { revitTarget } from "@pe/kit/lang/row";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ElementMenu, showInRevit } from "./element-menu";
import {
  elementTargetOf,
  prepareElements,
  revitReferences,
  revitScope,
  showElementsMessage,
} from "./element-target";

const { submit } = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  submitAction: submit,
}));
const documentRef = { session: "original-session", openId: "original-lifetime" };
const scope = { document: documentRef, source: "native" } as const;
afterEach(() => {
  cleanup();
  submit.mockReset();
});

test.each([
  null,
  documentRef,
  { document: null, source: "native" },
  ...["fixture", "saved", "dry-run"].map((source) => ({ document: documentRef, source })),
])("missing or non-native observation refuses without admission: %j", async (badScope) => {
  const result = await showInRevit({ ids: [42], scope: badScope as typeof scope }, false);
  expect(result.kind).toBe("refused");
  expect(submit).not.toHaveBeenCalled();
});

test.each(
  [[], [0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1]].map((ids) => ({ ids })),
)("invalid IDs refuse before admission: %j", async ({ ids }) => {
  expect((await showInRevit({ ids, scope }, true)).kind).toBe("refused");
  expect(submit).not.toHaveBeenCalled();
});

test("paired IDs retain exact destination, expected identity and structured partial failures", async () => {
  const data = {
    shown: [42],
    missing: [43],
    viewId: 9,
    viewName: "3D",
    note: "Selected 1.",
    boxed: [42],
    hidden: [42],
    identityVerified: [42],
    issues: [{ elementId: 44, code: "IdentityMismatch", message: "Captured identity changed." }],
  };
  submit.mockResolvedValue({ id: "action-1", state: "succeeded", result: data });
  const result = await showInRevit(
    {
      ids: [43],
      refs: [
        { kind: "Element", elementId: 42, uniqueId: "captured-42" },
        { elementId: 44, uniqueId: "old-44" },
      ],
      scope,
    },
    false,
  );
  expect(submit.mock.calls[0]?.[0]).toMatchObject({
    kind: "operation",
    key: "revit.context.show-elements",
    destination: { kind: "document", ref: documentRef },
    input: {
      elementIds: [43, 42, 44],
      expectedUniqueIds: { 42: "captured-42", 44: "old-44" },
      selectOnly: false,
    },
  });
  expect(result).toMatchObject({ kind: "action", data });
  expect(showElementsMessage(result)).toContain("Captured identity changed.");
});

test("kind, linked path and conflicting expected identities refuse", () => {
  for (const refs of [
    [{ kind: "Category", elementId: 1 }],
    [{ kind: "Document", elementId: 1 }],
    [{ kind: "Family", elementId: 1 }],
    [{ elementId: 1, documentKey: "linked-document" }],
    [{ elementId: 1, linkInstanceIds: [2] }],
    [
      { elementId: 1, uniqueId: "a" },
      { elementId: 1, uniqueId: "b" },
    ],
    [{ elementId: null }],
  ])
    expect(prepareElements({ ids: [], refs, scope }, false).kind).toBe("refused");
});

test("native handle document keys must match the displayed observation", () => {
  const refs = [{ elementId: 42, uniqueId: "captured", documentKey: "project:path:original" }];
  expect(
    prepareElements({ ids: [], refs, scope: { ...scope, documentKey: "project:path:other" } }, true)
      .kind,
  ).toBe("refused");
  expect(
    prepareElements(
      { ids: [], refs, scope: { ...scope, documentKey: "project:path:original" } },
      true,
    ).kind,
  ).toBe("ready");
});

test("nearest observation boundary prevents parent inheritance, malformed IDs are never filtered away", () => {
  const rendered = render(
    <div {...revitScope(scope)}>
      <div {...revitScope(null)}>
        <button {...revitTarget([42])}>nested</button>
      </div>
      <button data-revit-ids="42,,43">malformed</button>
      <button {...revitReferences([{ elementId: 7, uniqueId: "seven" }])}>reference</button>
    </div>,
  );
  const nested = elementTargetOf(rendered.getByText("nested"))!;
  expect(nested.scope).toBeNull();
  expect(prepareElements(nested, false).kind).toBe("refused");
  expect(prepareElements(elementTargetOf(rendered.getByText("malformed"))!, false).kind).toBe(
    "refused",
  );
  expect(prepareElements(elementTargetOf(rendered.getByText("reference"))!, true)).toMatchObject({
    kind: "ready",
    request: { expectedUniqueIds: { 7: "seven" } },
  });
});

test("BX needs both keys, targets pointer or focus, leaves double-click and typing free", async () => {
  submit.mockResolvedValue({ id: "action-1", state: "running" });
  const view = render(
    <div {...revitScope(scope)}>
      <ElementMenu />
      <button {...revitTarget([42])}>target</button>
      <input aria-label="edit" />
    </div>,
  );
  const target = view.getByText("target");
  target.focus();
  fireEvent.keyDown(document, { key: "x" });
  fireEvent.doubleClick(target);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "b" });
  fireEvent.keyDown(document, { key: "x" });
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  view.getByLabelText("edit").focus();
  fireEvent.keyDown(document, { key: "b" });
  fireEvent.keyDown(document, { key: "x" });
  expect(submit).toHaveBeenCalledTimes(1);
  target.focus();
  fireEvent.pointerOver(target);
  fireEvent.keyDown(document, { key: "b" });
  fireEvent.keyDown(document, { key: "x" });
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
});

test("right-click Select uses the same exact observation and never invokes a box", async () => {
  submit.mockResolvedValue({ id: "action-select", state: "running" });
  const view = render(
    <div {...revitScope(scope)}>
      <ElementMenu />
      <button {...revitTarget([42])}>target</button>
    </div>,
  );
  fireEvent.contextMenu(view.getByText("target"), { clientX: 20, clientY: 30 });
  fireEvent.click(await view.findByText("Select", { exact: true }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0]?.[0]).toMatchObject({
    destination: { kind: "document", ref: documentRef },
    input: { elementIds: [42], selectOnly: true },
  });
});
