// @vitest-environment jsdom
/** The Situation ladder on the one list: it opens on the first unbound rung, a pick binds that
 * rung and advances, a multi rung stays open, and a rung that cannot list says why. */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Ladder, type Rung } from "./ladder";

afterEach(cleanup);

function Head({ onViews }: { onViews: (views: string[]) => void }) {
  const [document, setDocument] = useState<string | null>(null);
  const [views, setViews] = useState<string[]>([]);
  const levels: Rung[] = [
    {
      key: "session",
      label: "pe.app-26",
      placeholder: "choose a session",
      options: [{ id: "pe.app-26", label: "pe.app-26" }],
      pick: () => {},
    },
    {
      key: "document",
      label: document === "a" ? "projectA.rvt" : document === "b" ? "Demo.rvt" : null,
      placeholder: "choose a document",
      options: [
        { id: "a", label: "projectA.rvt" },
        { id: "b", label: "Demo.rvt" },
      ],
      picked: (id) => id === document,
      pick: setDocument,
    },
    {
      key: "views",
      label: document ? (views.length ? views.join(", ") : null) : null,
      placeholder: "choose views",
      options: document
        ? [
            { id: "L1", label: "Level 1" },
            { id: "L2", label: "Level 2" },
          ]
        : null,
      note: "choose a document first",
      multi: true,
      picked: (id) => views.includes(id),
      pick: (id) => {
        const next = views.includes(id) ? views.filter((v) => v !== id) : [...views, id];
        setViews(next);
        onViews(next);
      },
    },
  ];
  return <Ladder levels={levels} />;
}

const options = () => screen.queryAllByRole("option").map((row) => row.textContent);

test("opens on the first unbound rung, binds per rung, and a multi rung stays open", async () => {
  const onViews = vi.fn();
  render(<Head onViews={onViews} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Choose document" })));
  const search = await screen.findByLabelText("Choose document search");
  expect(options()).toEqual(["projectA.rvt", "Demo.rvt"]);
  expect(document.activeElement).toBe(search);

  await act(async () => fireEvent.keyDown(search, { key: "ArrowDown" }));
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  // The document rung is bound and the ladder is on views, still open.
  expect(screen.getByRole("button", { name: "projectA.rvt" })).toBeTruthy();
  expect(options()).toEqual(["☐Level 1", "☐Level 2"]);

  await act(async () => fireEvent.keyDown(search, { key: "ArrowDown" }));
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  expect(onViews).toHaveBeenLastCalledWith(["L1"]);
  expect(options()).toEqual(["☑Level 1", "☐Level 2"]);
});

test("a rung that cannot list says why instead of drawing rows", async () => {
  render(<Head onViews={() => {}} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Choose document" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "choose views" })));
  expect(screen.getByRole("status").textContent).toBe("choose a document first");
  expect(options()).toEqual([]);
});

test("the trigger button carries the ladder's name: 'Choose pod' reaches the DOM", () => {
  const pod = (label: string | null): Rung[] => [
    {
      key: "pod",
      label,
      placeholder: "choose a pod",
      options: [{ id: "rw", label: "rw" }],
      pick: () => {},
    },
  ];
  render(<Ladder levels={pod(null)} />);
  expect(screen.getByRole("button", { name: "Choose pod" }).textContent).toContain("choose a pod");
  cleanup();
  // Bound, the face is the value; the name still says what the control chooses.
  render(<Ladder levels={pod("rw")} />);
  expect(screen.getByRole("button", { name: "Choose pod" }).textContent).toContain("rw");
});
