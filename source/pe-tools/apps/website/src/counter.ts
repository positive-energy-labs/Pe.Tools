import { fn } from "@pe-tools/utils";

export function setupCounter(element: HTMLButtonElement) {
  let counter = 0;
  const setCounter = (count: number) => {
    counter = count;
    element.innerHTML = `Count is ${counter}`;
  };
  element.addEventListener("click", () => {
    setCounter(counter + 1);
    fn();
  });
  setCounter(0);
}
