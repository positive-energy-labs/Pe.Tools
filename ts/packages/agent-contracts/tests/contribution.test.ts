import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { callerSchema } from "../src/caller.ts";
import {
  contributionKey,
  contributionSourcePath,
  packageIdSchema,
  packageProjectionSchema,
  parseContributionKey,
  type ContributionReference,
} from "../src/contribution.ts";

const vectors = JSON.parse(
  readFileSync(new URL("./contribution-vectors.json", import.meta.url), "utf8"),
) as {
  keys: (ContributionReference & { key: string; sourcePath: string })[];
  rejectedKeys: string[];
  sourcePaths: { accepted: string[]; rejected: string[] };
};
const sha256 = "a".repeat(64);

test("golden keys round-trip exactly with entry-file projections and no legacy decoder", () => {
  for (const { key, sourcePath, ...reference } of vectors.keys) {
    expect(parseContributionKey(key)).toEqual(reference);
    expect(contributionKey(reference)).toBe(key);
    expect(contributionSourcePath(reference)).toBe(sourcePath);
  }
  for (const key of vectors.rejectedKeys) expect(parseContributionKey(key), key).toBeNull();
  for (const path of vectors.sourcePaths.accepted)
    expect(parseContributionKey(`script:@snowdon-ducts/${path}`), path).not.toBeNull();
  for (const path of vectors.sourcePaths.rejected)
    expect(parseContributionKey(`script:@snowdon-ducts/${path}`), path).toBeNull();
});

test("a renamed folder does not change any contribution; collisions and foreign members refuse", () => {
  const contributions = vectors.keys
    .filter((key) => key.packageId === "snowdon-ducts")
    .map(({ key, sourcePath }) => ({ key, sourcePath, title: key, description: "" }));
  const pod = {
    id: "snowdon-ducts",
    folder: "original",
    contributions,
    diagnostics: [],
    members: contributions.map(({ sourcePath }) => ({ path: sourcePath, sha256, sizeBytes: 1 })),
  };
  expect(
    packageProjectionSchema.parse({ ...pod, folder: "renamed-folder-v2" }).contributions,
  ).toEqual(packageProjectionSchema.parse(pod).contributions);
  expect(
    packageProjectionSchema.safeParse({
      ...pod,
      members: [...pod.members, { ...pod.members[0], path: "src/census.cs" }],
    }).success,
  ).toBe(false);
  expect(
    packageProjectionSchema.safeParse({
      ...pod,
      contributions: [...contributions, contributions[0]],
    }).success,
  ).toBe(false);
  expect(packageProjectionSchema.safeParse({ ...pod, id: "different" }).success).toBe(false);
  expect(packageProjectionSchema.safeParse({ ...pod, members: [] }).success).toBe(false);
  for (const id of ["pages", "skills", "product", "Folder", "two--parts", "snowdon-ducts "])
    expect(packageIdSchema.safeParse(id).success).toBe(false);
});

test("Page callers refuse unsafe or noncanonical packaged references", () => {
  for (const page of [
    "page:@pod/pages/../other",
    "page:@pod/pages\\tour",
    "page:@pod/arbitrary",
    "page:@pages/tour/",
  ])
    expect(callerSchema.safeParse({ kind: "page", page }).success, page).toBe(false);
});
