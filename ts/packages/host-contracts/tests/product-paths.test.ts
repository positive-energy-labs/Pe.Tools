import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { productPathNames } from "../src/contracts/product.ts";
import {
  parseDocumentsKnownFolder,
  productHomePath,
  testHomeRootVariable,
} from "../src/product-paths.ts";

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
    process.env[homeVariable] = join(tmpdir(), "override");
    expect(productHomePath()).toBe(join(tmpdir(), "override"));
    process.env[homeVariable] = join(tmpdir(), "second");
    expect(productHomePath()).toBe(join(tmpdir(), "second"));
  } finally {
    if (original === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = original;
  }
});

test("under a test run no product home may resolve outside the temp directory", () => {
  const original = process.env[homeVariable];
  try {
    expect(process.env[testHomeRootVariable]).toBeTruthy();
    process.env[homeVariable] = "C:\Users\someone\Documents\Pe.Tools";
    expect(() => productHomePath()).toThrow("Test isolation");
    delete process.env[homeVariable];
    expect(() => productHomePath()).toThrow("Test isolation"); // the unset override is the real home
  } finally {
    if (original === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = original;
  }
});
