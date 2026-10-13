import { z } from "zod";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const namespaceIdSchema = z
  .string()
  .regex(slug)
  .refine((id) => id.trim() === id);
export const reservedPackageIds = ["pages", "skills", "product"] as const;
/** Installed identity comes from pod.json, never its folder or version. */
export const packageIdSchema = namespaceIdSchema.refine(
  (id) => !reservedPackageIds.some((reserved) => reserved === id),
  "Reserved package namespace",
);
export const contributionKindSchema = z.enum(["script", "page", "skill", "member"]);
export type ContributionKind = z.infer<typeof contributionKindSchema>;

/** Exact portable spelling; never normalize untrusted keys into another member. */
export const packageMemberPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      path.normalize("NFC") === path &&
      !/[\\<>:"|?*%#]/.test(path) &&
      path
        .split("")
        .every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
      path
        .split("/")
        .every(
          (segment) =>
            segment.length > 0 &&
            segment !== "." &&
            segment !== ".." &&
            segment.trim() === segment &&
            !segment.endsWith(".") &&
            !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
        ),
    "Expected an exact portable package-relative path",
  );

export const contributionReferenceSchema = z
  .strictObject({
    kind: contributionKindSchema,
    packageId: namespaceIdSchema,
    path: packageMemberPathSchema,
  })
  .refine(({ kind, packageId, path }) => {
    if (packageId === "pages") return kind === "page" && slug.test(path);
    if (packageId === "skills" || packageId === "product")
      return kind === "skill" && /^skills\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
    if (kind === "script") return /^src\/.+\.cs$/i.test(path) && path.startsWith("src/");
    if (kind === "page") return /^pages\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
    if (kind === "skill") return /^skills\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
    return true;
  }, "Contribution kind does not match its namespace or entry path");
export type ContributionReference = z.infer<typeof contributionReferenceSchema>;

export function parseContributionKey(key: string): ContributionReference | null {
  const match = /^([^:]+):@([^/]+)\/(.+)$/.exec(key);
  if (!match || match[0] !== key) return null;
  const result = contributionReferenceSchema.safeParse({
    kind: match[1],
    packageId: match[2],
    path: match[3],
  });
  return result.success ? result.data : null;
}

export function contributionKey(reference: ContributionReference): string {
  const { kind, packageId, path } = contributionReferenceSchema.parse(reference);
  return `${kind}:@${packageId}/${path}`;
}
export const contributionKeySchema = z
  .string()
  .refine((key) => parseContributionKey(key) !== null, "Expected a canonical contribution key");
export const pageKeySchema = contributionKeySchema.refine(
  (key) => parseContributionKey(key)?.kind === "page",
  "Expected a Page key",
);

export const packageMemberSchema = z.strictObject({
  path: packageMemberPathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
});
export type PackageMember = z.infer<typeof packageMemberSchema>;
export const packageDiagnosticSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  path: z.string().optional(),
});
export type PackageDiagnostic = z.infer<typeof packageDiagnosticSchema>;

/** Host-derived navigation metadata cannot grant execution authority. */
export const capabilityProjectionSchema = z.strictObject({
  openUrl: z.string().min(1).optional(),
  pane: z.string().min(1).optional(),
});
export type CapabilityProjection = z.infer<typeof capabilityProjectionSchema>;
/** The exact admitted entry bytes behind a catalog row, including directory entrypoints. */
export const contributionSourceSchema = z.strictObject({
  id: namespaceIdSchema,
  path: packageMemberPathSchema,
  sha256: packageMemberSchema.shape.sha256,
});
export type ContributionSource = z.infer<typeof contributionSourceSchema>;
export const contributionProjectionSchema = z
  .strictObject({
    key: contributionKeySchema,
    sourcePath: packageMemberPathSchema,
    title: z.string(),
    description: z.string(),
    projection: capabilityProjectionSchema.optional(),
  })
  .refine(({ key, sourcePath }) => {
    const reference = parseContributionKey(key);
    return reference !== null && contributionSourcePath(reference) === sourcePath;
  }, "Entry bytes do not match the contribution key");
export type ContributionProjection = z.infer<typeof contributionProjectionSchema>;

export function contributionSourcePath(reference: ContributionReference): string {
  if (reference.kind === "page") return `${reference.path}/index.html`;
  if (reference.kind === "skill") return `${reference.path}/SKILL.md`;
  return reference.path;
}

/** Inventory metadata only; captured bytes stay in the host's bounded capture. */
export const packageProjectionSchema = z
  .strictObject({
    id: packageIdSchema,
    folder: z.string().min(1),
    members: z.array(packageMemberSchema),
    contributions: z.array(contributionProjectionSchema),
    diagnostics: z.array(packageDiagnosticSchema),
  })
  .superRefine((value, ctx) => {
    const paths = new Set<string>();
    for (const member of value.members) {
      const folded = member.path.toLowerCase();
      if (paths.has(folded))
        ctx.addIssue({ code: "custom", message: `Case-colliding member: ${member.path}` });
      paths.add(folded);
    }
    const keys = new Set<string>();
    for (const contribution of value.contributions) {
      if (
        parseContributionKey(contribution.key)?.packageId !== value.id ||
        !value.members.some((member) => member.path === contribution.sourcePath) ||
        keys.has(contribution.key)
      )
        ctx.addIssue({
          code: "custom",
          message: `Contribution is not a unique admitted member: ${contribution.key}`,
        });
      keys.add(contribution.key);
    }
  });
export type PackageProjection = z.infer<typeof packageProjectionSchema>;
