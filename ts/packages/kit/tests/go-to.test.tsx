// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { GoToPopup } from "../src/components/lang/go-to";
import { SubjectTextContext } from "../src/components/lang/reach";
import { hovered } from "../src/components/lang/attention";
import { kitRegistry } from "./attention-fixture";

afterEach(cleanup);
const items = Array.from({ length: 12 }, (_, id) => ({
  key: `e${id}`,
  name: `Supply ${id}`,
  id,
  group: "Elements",
  detail: "round duct",
}));

test("go-to builds only when opened, caps groups, searches words and previews through reach", async () => {
  const build = vi.fn(() => items);
  const onGo = vi.fn();
  const registry = kitRegistry();
  render(
    <SubjectTextContext value={{ doc: "kit", nameOf: () => null }}>
      <GoToPopup items={build} onGo={onGo} />
    </SubjectTextContext>,
  );
  expect(build).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", { name: "go to a subject" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "/", code: "Slash" });
  const input = await screen.findByRole("combobox", { name: "go to a subject search" });
  expect(build).toHaveBeenCalledOnce();
  expect(screen.getAllByRole("option")).toHaveLength(9); // Eight elements and the kit's more row.
  fireEvent.mouseMove(screen.getByText("Supply 3"));
  await waitFor(() => expect(registry.get(hovered)?.key ?? null).toBe("e:3"));
  fireEvent.change(input, { target: { value: "round 11" } });
  const match = await screen.findByText("Supply 11");
  fireEvent.click(match);
  expect(onGo).toHaveBeenCalledWith(items[11]);
  await waitFor(() => expect(registry.get(hovered)?.key ?? null).toBeNull());
  expect(build).toHaveBeenCalledOnce();
});

test("go-to resolves an unlisted id and clears callback preview on Escape", async () => {
  const onGo = vi.fn();
  const hover = vi.fn();
  const outside = { key: "outside", name: "Unlisted", id: 900 };
  render(
    <GoToPopup
      items={() => items}
      onGo={onGo}
      hover={hover}
      resolveId={(text) => (text.trim() === "900" ? outside : null)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "go to a subject" }));
  const input = await screen.findByRole("combobox", { name: "go to a subject search" });
  fireEvent.change(input, { target: { value: "900" } });
  fireEvent.click(await screen.findByText("go to matching subject"));
  expect(onGo).toHaveBeenCalledWith(outside);
  expect(hover).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole("button", { name: "go to a subject" }));
  fireEvent.mouseMove(await screen.findByText("Supply 2"));
  expect(hover).toHaveBeenLastCalledWith(items[2]);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "go to a subject search" }), {
    key: "Escape",
  });
  await waitFor(() => expect(hover).toHaveBeenLastCalledWith(null));
});
