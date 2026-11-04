import { expect, test } from "vite-plus/test";
import { systemsEmpty } from "./screen";

const coverage = (read: number, of: number) => ({ read, of, reading: [], readAll: null });

test("an unread scope never claims the document has no systems", () => {
  expect(systemsEmpty(coverage(0, 373)).message).toBe("None of 373 systems read yet");
  expect(systemsEmpty(coverage(0, 0)).message).toBe("No duct systems in this scope");
  expect(systemsEmpty(null).message).toBe("No duct systems in this scope");
});
