// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Button } from "../src/components/lang/button";
import { Row } from "../src/components/lang/row";
import { SearchControl } from "../src/components/lang/search-control";

afterEach(cleanup);

test("a container supplies its buttons' kind; a stated kind and the worded default still hold", () => {
  render(
    <>
      <Button label="bare">bare</Button>
      <SearchControl
        chips={<Button label="chip">chip</Button>}
        trail={<Button label="not">not</Button>}
      >
        <input aria-label="search" />
      </SearchControl>
      <Row
        label="row"
        lines={2}
        sub={
          <>
            <Button label="link">link</Button>
            <Button kind="framed" label="pick">
              pick
            </Button>
          </>
        }
      />
    </>,
  );
  const kind = (name: string) => screen.getByRole("button", { name }).getAttribute("data-kind");
  expect(["bare", "chip", "not", "link", "pick"].map(kind)).toEqual([
    "framed",
    "quiet",
    "framed",
    "quiet",
    "framed",
  ]);
});
