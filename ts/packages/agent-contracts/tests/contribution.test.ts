import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { callerSchema } from "../src/caller.ts";
import { capabilityKindSchema, capabilitySchema, parseRouteKey } from "../src/capability.ts";
import { memberWork, podMemberSchema } from "../src/settings.ts";
import {
  contributionKey,
  contributionSourcePath,
  packageIdSchema,
  packageProjectionSchema,
  isCanonicalSlug,
  parseContributionKey,
  type ContributionReference,
} from "../src/contribution.ts";
import { mentionOf, mentionSchema, parseDocumentKey } from "../src/mention.ts";
import { machineFixture } from "./machine-fixture.ts";

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

test("packaged catalog rows and mentions preserve admitted revision and refuse competing identity", () => {
  const member = {
    key: "member:@snowdon-ducts/settings/checks.json",
    kind: "member" as const,
    title: "Checks",
    description: "Read checks",
    needs: "nothing" as const,
    mutates: false,
    actor: "any" as const,
    input: {},
    source: "packages",
    rank: 0,
    package: { id: "snowdon-ducts", path: "settings/checks.json", sha256 },
  };
  expect(capabilitySchema.safeParse(member).success).toBe(true);
  for (const row of [
    { ...member, mutates: true },
    { ...member, needs: "document" },
    { ...member, key: "pod:folder.checks" },
    { ...member, package: undefined },
    { ...member, package: { ...member.package, id: "foreign" } },
    { ...member, kind: "script" },
  ])
    expect(capabilitySchema.safeParse(row).success).toBe(false);
  const mention = mentionOf(member, { at: "2026-10-13T14:00:00Z", machine: machineFixture() });
  expect(mentionSchema.parse(mention).facts).toMatchObject({
    packageId: "snowdon-ducts",
    sourcePath: "settings/checks.json",
    sha256,
    mutates: false,
  });
  expect(
    mentionSchema.safeParse({ ...mention, key: "member:snowdon-ducts/settings/checks.json" })
      .success,
  ).toBe(false);
  expect(mentionSchema.safeParse({ ...mention, kind: "script" }).success).toBe(false);
  expect(parseRouteKey("route:families.propose")).toEqual({ route: "families", member: "propose" });
  expect(parseDocumentKey("doc:session/open/id")).toEqual({
    session: "session",
    openId: "open/id",
  });
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

test("a scratch Page key is its folder as named when that is one safe URL segment", () => {
  for (const folder of ["todo", "Odd_Name", "v1.2", "Q3-Report"])
    expect(parseContributionKey(`page:@pages/${folder}`), folder).toEqual({
      kind: "page",
      packageId: "pages",
      path: folder,
    });
  for (const folder of ["a--b", "Has Space", "..", ".hidden", "x.", "-x", "a/b", "a%20b", "con"])
    expect(parseContributionKey(`page:@pages/${folder}`), folder).toBeNull();
  expect(isCanonicalSlug("odd-name")).toBe(true);
  expect(isCanonicalSlug("Odd_Name")).toBe(false);
});

test("contribution kinds replace the folder-based Pod action kind", () => {
  expect(capabilityKindSchema.safeParse("pod").success).toBe(false);
  for (const kind of ["script", "page", "skill", "member"])
    expect(capabilityKindSchema.safeParse(kind).success).toBe(true);
});

test("member identity uses the manifest id and canonical path", () => {
  expect(memberWork({ pod: "snowdon-ducts", path: "settings/checks.json" })).toBe(
    "member:@snowdon-ducts/settings/checks.json",
  );
  for (const member of [
    { pod: "Folder", path: "settings/checks.json" },
    { pod: "snowdon-ducts", path: "settings/../checks.json" },
  ])
    expect(podMemberSchema.safeParse(member).success).toBe(false);
});
