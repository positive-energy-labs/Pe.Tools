// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../src/components/lang/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
} from "../src/components/lang/popover";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "../src/components/lang/hover-card";
import { Button } from "../src/components/lang/button";

afterEach(cleanup);

test.each([
  ["tooltip", Tooltip, TooltipTrigger, TooltipContent],
  ["popover", Popover, PopoverTrigger, PopoverContent],
  ["hover-card", HoverCard, HoverCardTrigger, HoverCardContent],
] as const)("closed %s never renders its heavy body", (_, Root, Trigger, Content) => {
  const heavy = vi.fn(() => <div>Heavy preview</div>);
  const Heavy = heavy;
  const view = render(
    <TooltipProvider>
      <Root>
        <Trigger>Trigger</Trigger>
        <Content>
          <Heavy />
        </Content>
      </Root>
    </TooltipProvider>,
  );
  expect(heavy).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll('[data-slot$="content"]')).toHaveLength(0);
  expect(screen.queryByText("Heavy preview")).toBeNull();
});

test.each([
  ["popover", Popover, PopoverTrigger, PopoverContent],
  ["hover-card", HoverCard, HoverCardTrigger, HoverCardContent],
] as const)(
  "%s opens by click, admits interaction, closes and unmounts",
  async (_, Root, Trigger, Content) => {
    const picked = vi.fn();
    render(
      <Root>
        <Trigger>Open</Trigger>
        <Content aria-label="Details">
          <button onClick={picked}>Pick</button>
          <PopoverClose>Close</PopoverClose>
        </Content>
      </Root>,
    );
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(await screen.findByText("Pick"));
    expect(picked).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(screen.queryByText("Pick")).toBeNull());
  },
);

test("a refused Button exposes its explanation on focus without a native title", async () => {
  const click = vi.fn();
  render(
    <TooltipProvider delay={0}>
      <Button label="Apply" refusal="Document is closed" onClick={click}>
        Apply
      </Button>
    </TooltipProvider>,
  );
  const button = screen.getByRole("button", { name: "Apply" });
  expect(button.hasAttribute("title")).toBe(false);
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => button.focus());
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  expect(screen.getByText("Document is closed")).toBeTruthy();
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
});
