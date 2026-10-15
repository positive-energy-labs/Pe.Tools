import { describe, expect, test } from "vite-plus/test";
import { admitFiles, ATTACHMENT_LIMITS } from "./use-attachments";

const file = (name: string, size = 1) => ({ name, size }) as File;

describe("admitFiles", () => {
  test("refuses over-size files and files past the count, naming each", () => {
    const big = file("big.png", ATTACHMENT_LIMITS.fileBytes + 1);
    const result = admitFiles([big, file("a.txt"), file("b.txt"), file("c.txt")], 8);
    expect(result.admitted.map((f) => f.name)).toEqual(["a.txt", "b.txt"]);
    expect(result.refusal).toBe(
      "Not added: big.png (over the 5 MB limit per file); c.txt (10 files per message at most)",
    );
  });

  test("admits everything that fits with no refusal", () => {
    expect(admitFiles([file("a.txt")], 0)).toEqual({
      admitted: [expect.anything()],
      refusal: undefined,
    });
  });
});
