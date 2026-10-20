// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { List } from "@pe/kit/lang/list-popup";

afterEach(cleanup);
const items = ["plain", "explained", "duplicate"];
function Fixture({ footer }: { footer?: React.ReactNode }) {
  return (
    <List
      items={items}
      keyOf={(s) => s}
      labelOf={(s) => s}
      aria-label="items"
      empty="empty"
      row={(item) => ({ label: item, meta: "3 rows" })}
      detail={(item) =>
        item === "explained"
          ? "Why this condition matters"
          : item === "duplicate"
            ? "3 rows"
            : undefined
      }
      footer={footer}
    />
  );
}

test("description sections exist only for distinct explanations on the cursor row", () => {
  const { container } = render(<Fixture />);
  expect(container.querySelector("[data-list-detail]")).toBeNull();
  fireEvent.mouseMove(screen.getByRole("option", { name: /explained/ }));
  expect(container.querySelector("[data-list-detail]")?.textContent).toBe(
    "Why this condition matters",
  );
  fireEvent.mouseMove(screen.getByRole("option", { name: /^plain/ }));
  expect(container.querySelector("[data-list-detail]")).toBeNull();
  fireEvent.mouseMove(screen.getByRole("option", { name: /duplicate/ }));
  expect(container.querySelector("[data-list-detail]")).toBeNull();
});

test("an empty footer has no space or separator, including empty layout groups", () => {
  const { container, rerender } = render(
    <Fixture
      footer={
        <>
          <div>
            <span>{false}</span>
            {null}
          </div>{" "}
        </>
      }
    />,
  );
  expect(container.querySelector("[data-list-footer]")).toBeNull();
  rerender(<Fixture footer={<button>Restore defaults</button>} />);
  expect(container.querySelector("[data-list-footer]")?.textContent).toBe("Restore defaults");
  rerender(<Fixture footer={null} />);
  expect(container.querySelector("[data-list-footer]")).toBeNull();
});
