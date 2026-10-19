// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipHint,
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

test("a composed hint preserves the native element, id, class, ref and focus order", async () => {
  let element: HTMLSpanElement | null = null;
  const view = render(
    <TooltipProvider delay={0}>
      <TooltipHint content="Full measured path">
        <span
          id="measured-path"
          className="truncate"
          tabIndex={-1}
          ref={(node) => {
            element = node;
          }}
        >
          Path
        </span>
      </TooltipHint>
    </TooltipProvider>,
  );
  const trigger = screen.getByText("Path");
  expect(trigger.tagName).toBe("SPAN");
  expect(trigger.id).toBe("measured-path");
  expect(trigger.className).toBe("truncate");
  expect(trigger.tabIndex).toBe(-1);
  expect(element).toBe(trigger);
  expect(view.container.querySelector("button")).toBeNull();
  expect(trigger.hasAttribute("title")).toBe(false);
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => trigger.focus());
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toBe("Full measured path");
  expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
});

test("an absent hint leaves its child unchanged", () => {
  const view = render(
    <TooltipHint content={undefined}>
      <span>Path</span>
    </TooltipHint>,
  );
  expect(view.container.innerHTML).toBe("<span>Path</span>");
});

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
