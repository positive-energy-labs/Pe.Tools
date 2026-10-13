// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { CommandPalette } from "./command-palette";
import { useState } from "react";
import { Input } from "./input";

afterEach(cleanup);
test("the shared palette focuses search, filters and opens through one selection callback", async () => {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      aria-label="Destinations"
      items={[
        { id: "one", name: "Family audit" },
        { id: "two", name: "Pea thread" },
      ]}
      keyOf={(item) => item.id}
      labelOf={(item) => item.name}
      filter="substring"
      searchAbove={0}
      searchPlaceholder="Find destination"
      empty="Nothing observed"
      row={(item) => ({ label: item.name })}
      onPick={onPick}
    />,
  );
  const search = await screen.findByPlaceholderText("Find destination");
  await waitFor(() => expect(document.activeElement).toBe(search));
  fireEvent.change(search, { target: { value: "Pea" } });
  const option = await screen.findByRole("option", { name: /Pea thread/ });
  expect(screen.queryByRole("option", { name: /Family audit/ })).toBeNull();
  fireEvent.click(option);
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
test("anchored palette keeps one input owner and reuses filtering, refusal, keys and Escape", async () => {
  const onPick = vi.fn();
  function Fixture() {
    const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(true);
    return (
      <>
        <Input
          ref={setAnchor}
          role="combobox"
          aria-label="Route finder"
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span data-testid="outside">Outside palette</span>
        <CommandPalette
          presentation="anchored"
          anchor={anchor}
          query={query}
          open={open}
          onOpenChange={setOpen}
          aria-label="Anchored destinations"
          items={[
            { id: "one", name: "Family audit", refusal: null },
            { id: "two", name: "Saved Work", refusal: "Not resumable" },
            { id: "three", name: "Pea thread", refusal: null },
          ]}
          keyOf={(item) => item.id}
          labelOf={(item) => item.name}
          filter="substring"
          empty="Nothing observed"
          row={(item) => ({ label: item.name, refusal: item.refusal })}
          onPick={onPick}
        />
      </>
    );
  }
  render(<Fixture />);
  const owner = screen.getByRole("combobox", { name: "Route finder" });
  owner.focus();
  await screen.findByRole("option", { name: /Saved Work/ });
  expect(document.querySelectorAll("input")).toHaveLength(1);
  expect(document.activeElement).toBe(owner);
  fireEvent.click(screen.getByRole("option", { name: /Saved Work/ }));
  expect(onPick).not.toHaveBeenCalled();
  expect(owner.getAttribute("aria-expanded")).toBe("true");
  fireEvent.change(owner, { target: { value: "Pea" } });
  await screen.findByRole("option", { name: /Pea thread/ });
  expect(screen.queryByRole("option", { name: /Family audit/ })).toBeNull();
  fireEvent.keyDown(owner, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
  expect(onPick.mock.calls[0][0].id).toBe("three");
  await waitFor(() => expect(owner.getAttribute("aria-expanded")).toBe("false"));
  fireEvent.focus(owner);
  await screen.findByRole("option", { name: /Pea thread/ });
  fireEvent.keyDown(owner, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(owner.getAttribute("aria-expanded")).toBe("false"));
  expect(document.activeElement).toBe(owner);
  fireEvent.focus(owner);
  await screen.findByRole("option", { name: /Pea thread/ });
  fireEvent.mouseDown(screen.getByTestId("outside"));
  fireEvent.mouseUp(screen.getByTestId("outside"));
  fireEvent.click(screen.getByTestId("outside"));
  await waitFor(() => expect(owner.getAttribute("aria-expanded")).toBe("false"));
});
