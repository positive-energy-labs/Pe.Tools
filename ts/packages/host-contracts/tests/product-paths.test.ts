import { expect, test } from "vite-plus/test";
import { productPathNames } from "../src/contracts/product.ts";
import { parseDocumentsKnownFolder, productHomePath } from "../src/product-paths.ts";

const homeVariable = productPathNames.productHomeVariable;

// The real `reg query` output on a OneDrive-redirected profile: the value stays REG_EXPAND_SZ,
// so the redirection survives only if the reader expands it itself.
const oneDrive = [
  "",
  "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
  "    Personal    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Documents",
  "",
].join("\r\n");

test("an expanded OneDrive path is the resolved Documents folder", () => {
  expect(parseDocumentsKnownFolder(oneDrive, { USERPROFILE: "C:\\Users\\pea" })).toBe(
    "C:\\Users\\pea\\OneDrive\\Documents",
  );
});

test("a redirected literal path needs no expansion", () => {
  const literal = "    Personal    REG_SZ    D:\\Redirected\\Documents\r\n";
  expect(parseDocumentsKnownFolder(literal, {})).toBe("D:\\Redirected\\Documents");
});

test("an unreadable known folder fails loudly instead of falling back to the profile", () => {
  // The %USERPROFILE%/Documents fallback is a DIFFERENT content home, not a degraded answer.
  expect(() => parseDocumentsKnownFolder("ERROR: The system was unable to find...", {})).toThrow(
    "no Personal value",
  );
  expect(() => parseDocumentsKnownFolder(oneDrive, {})).toThrow("undefined variable 'USERPROFILE'");
});

test("the product home override names the home itself, read live, never from the cache", () => {
  const original = process.env[homeVariable];
  try {
    process.env[homeVariable] = "D:\\override";
    expect(productHomePath()).toBe("D:\\override");
    process.env[homeVariable] = "D:\\second";
    expect(productHomePath()).toBe("D:\\second");
  } finally {
    if (original === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = original;
  }
});
