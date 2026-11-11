import { expect, test } from "vite-plus/test";
import { productPathNames } from "../src/contracts/product.ts";
import {
  parseDocumentsKnownFolder,
  sharedRoot,
  testHomeRootVariable,
  userRoot,
} from "../src/product-paths.ts";

const homeVariable = productPathNames.productHomeVariable;

// The real `reg query` output on a OneDrive-redirected profile: the value stays REG_EXPAND_SZ,
// so the redirection survives only if the reader expands it itself.
const oneDrive = [
  "",
  "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
  "    Personal    REG_EXPAND_SZ    %USERPROFILE%\OneDrive\Documents",
  "",
].join("\r\n");

test("an expanded OneDrive path is the resolved Documents folder", () => {
  expect(parseDocumentsKnownFolder(oneDrive, { USERPROFILE: "C:\Users\pea" })).toBe(
    "C:\Users\pea\OneDrive\Documents",
  );
});

test("an unreadable known folder fails loudly instead of falling back to the profile", () => {
  // The %USERPROFILE%/Documents fallback is a DIFFERENT content home, not a degraded answer.
  expect(() => parseDocumentsKnownFolder("ERROR: The system was unable to find...", {})).toThrow(
    "no Personal value",
  );
  expect(() => parseDocumentsKnownFolder(oneDrive, {})).toThrow("undefined variable 'USERPROFILE'");
});

test("under a test run no content home may resolve outside the temp directory", () => {
  const original = process.env[homeVariable];
  try {
    expect(process.env[testHomeRootVariable]).toBeTruthy();
    process.env[homeVariable] = "C:UserssomeoneDocumentsPe.Tools";
    expect(() => userRoot()).toThrow("Test isolation");
    delete process.env[homeVariable];
    expect(() => userRoot()).toThrow("Test isolation"); // the unset override is the real Documents home
    process.env[productPathNames.sharedRootVariable] = "S:\Pe.Tools";
    expect(() => sharedRoot()).toThrow("Test isolation");
  } finally {
    delete process.env[productPathNames.sharedRootVariable];
    if (original === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = original;
  }
});
