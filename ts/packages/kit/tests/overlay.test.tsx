// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  Popover,
  SubjectPopoverContent as PopoverContent,
  PopoverTrigger,
  SubjectBox,
  sideAwayFrom,
  usePopoverSide,
} from "../src/components/lang/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../src/components/lang/hover-card";
import { SvgTip, TooltipHint, TooltipProvider } from "../src/components/lang/tooltip";
afterEach(cleanup);
const rect = (x: number, y: number, w = 20, h = 20) => new DOMRect(x, y, w, h);

test("away side separates from the subject regardless of popup width", () => {
  const subject = rect(100, 100, 200, 200);
  expect(sideAwayFrom(rect(150, 40), subject)).toBe("top");
  expect(sideAwayFrom(rect(150, 350), subject)).toBe("bottom");
  expect(sideAwayFrom(rect(50, 150), subject)).toBe("left");
  expect(sideAwayFrom(rect(350, 150), subject)).toBe("right");
  // Centres alone wrongly choose top here, where a wide popup can cross the subject.
  expect(sideAwayFrom(rect(70, 0, 20, 100), rect(100, 90, 20, 20))).toBe("left");
});

test("opening a hover card closes a popover, and Escape never reaches the page", async () => {
  const escape = vi.fn();
  render(
    <div onKeyDown={escape}>
      <Popover>
        <PopoverTrigger>A</PopoverTrigger>
        <PopoverContent aria-label="A content">first</PopoverContent>
      </Popover>
      <HoverCard>
        <HoverCardTrigger>B</HoverCardTrigger>
        <HoverCardContent aria-label="B content">second</HoverCardContent>
      </HoverCard>
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "A" }));
  expect(await screen.findByText("first")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "B" }));
  expect(await screen.findByText("second")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("first")).toBeNull());
  fireEvent.keyDown(screen.getByText("second"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("second")).toBeNull());
  expect(escape).not.toHaveBeenCalled();
});

test("subject context positions an ordinary trigger away and exposes facing side", async () => {
  function Row() {
    return <span>{usePopoverSide()}</span>;
  }
  render(
    <SubjectBox box={rect(100, 100, 200, 200)}>
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent facing>
          <Row />
        </PopoverContent>
      </Popover>
    </SubjectBox>,
  );
  const trigger = screen.getByRole("button", { name: "open" });
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect(150, 40));
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(document.querySelector('[data-facing][data-side="top"]')).toBeTruthy(),
  );
  expect(screen.getByText("top")).toBeTruthy();
});

test("SVG hints focus their containing mark and preserve its accessible description on cleanup", async () => {
  const view = render(
    <svg>
      <circle aria-label="mark" aria-description="original">
        <SvgTip content="round" />
      </circle>
    </svg>,
  );
  const mark = screen.getByLabelText("mark");
  expect(mark.getAttribute("tabindex")).toBe("0");
  await act(async () => {
    mark.dispatchEvent(new FocusEvent("focus"));
  });
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  expect(screen.getByText("round")).toBeTruthy();
  expect(mark.getAttribute("aria-description")).toBe("round");
  expect(document.querySelector("svg title")).toBeNull();
  view.unmount();
  expect(mark.getAttribute("aria-description")).toBe("original");
});

test("ordinary tooltips inherit the subject box", async () => {
  render(
    <TooltipProvider delay={0}>
      <SubjectBox box={rect(100, 100, 200, 200)}>
        <TooltipHint content="hint">
          <button>mark</button>
        </TooltipHint>
      </SubjectBox>
    </TooltipProvider>,
  );
  const mark = screen.getByRole("button", { name: "mark" });
  vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(rect(350, 150));
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => mark.focus());
  const tip = await screen.findByRole("tooltip");
  await waitFor(() => expect(tip.getAttribute("data-side")).toBe("right"));
});

test("an SVG hint opens on pointer dwell and closes on leave", async () => {
  render(
    <svg>
      <path aria-label="edge" d="M0 0 L10 10">
        <SvgTip content="edge" />
      </path>
    </svg>,
  );
  const mark = screen.getByLabelText("edge");
  fireEvent.pointerEnter(mark);
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  fireEvent.pointerLeave(mark);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

test("the slot closes a controlled sibling even when its caller leaves open true", async () => {
  render(
    <>
      <Popover open>
        <PopoverTrigger>A</PopoverTrigger>
        <PopoverContent>controlled first</PopoverContent>
      </Popover>
      <Popover defaultOpen>
        <PopoverTrigger>B</PopoverTrigger>
        <PopoverContent>default second</PopoverContent>
      </Popover>
    </>,
  );
  await waitFor(() =>
    expect(document.querySelectorAll('[data-slot="popover-content"][data-open]')).toHaveLength(1),
  );
  expect(screen.getByText("controlled first").hasAttribute("data-open")).toBe(false);
  expect(screen.getByText("default second")).toBeTruthy();
});
