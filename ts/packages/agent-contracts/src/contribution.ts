import { z } from "zod";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A scratch Page is its folder as named: one URL segment, `--` reserved for `<pod>--<page>`. */
const pageFolder = /^[A-Za-z0-9](?:[A-Za-z0-9._]|-(?!-))*$/;
/** The canonical lowercase slug; a scratch Page named otherwise works and carries a warning. */
export const isCanonicalSlug = (value: string) => slug.test(value);
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
    if (packageId === "pages") return kind === "page" && pageFolder.test(path);
    if (packageId === "skills" || packageId === "product")
      return kind === "skill" && /^skills\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
    // Any `.cs` or `.csx` member a Pod declares, wherever it lives (pods map, contract C1).
    if (kind === "script") return /\.csx?$/i.test(path);
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

/** The Page behind one served URL segment: scratch folder or `<pod>--<page>`. */
export function pageKeyOf(slug: string): string | null {
  const [id, page, ...more] = slug.split("--");
  const key = page === undefined ? `page:@pages/${slug}` : `page:@${id}/pages/${page}`;
  return !more.length && parseContributionKey(key) ? key : null;
}

/** The served slug and URL for a canonical Page key. */
export function pageSlugOf(key: string): string | null {
  const ref = parseContributionKey(key);
  if (ref?.kind !== "page") return null;
  return ref.packageId === "pages"
    ? ref.path
    : `${ref.packageId}--${ref.path.slice("pages/".length)}`;
}
export function pageOpenUrl(key: string): string | null {
  const slug = pageSlugOf(key);
  return slug === null ? null : `/pages/${slug}/`;
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
export const scriptModeSchema = z.enum(["ReadOnly", "WriteTransaction", "NoTransaction"]);
export type ScriptMode = z.infer<typeof scriptModeSchema>;
/**
 * What a door may say to a declared script: its `input`, the mode and the timeout, nothing else
 * (pods map, contract C1). The door always names the mode (the declared one when the caller gave
 * none, ReadOnly when pod.json declares none) so the host can tell a read from a write before it
 * admits the run; native applies the same rule
 * to whatever reaches it (`PodManifest.ModeFor`). A write asked of a `ReadOnly` entrypoint throws.
 */
export function declaredScriptRun(
  row: { key: string; mode?: ScriptMode },
  sent: Record<string, unknown>,
): Record<string, unknown> {
  const permissionMode = sent.permissionMode ?? row.mode ?? "ReadOnly";
  if (row.mode === "ReadOnly" && permissionMode !== "ReadOnly")
    throw Error(
      `${row.key} is declared ReadOnly in pod.json; it cannot run as ${String(permissionMode)}.`,
    );
  return Object.fromEntries(
    Object.entries({
      input: sent.input,
      permissionMode,
      timeoutSeconds: sent.timeoutSeconds,
    }).filter(([, value]) => value !== undefined),
  );
}
export const contributionProjectionSchema = z
  .strictObject({
    key: contributionKeySchema,
    sourcePath: packageMemberPathSchema,
    title: z.string(),
    description: z.string(),
    projection: capabilityProjectionSchema.optional(),
    /** A script's declared mode. `ReadOnly` makes its row a read; absent, the caller chooses. */
    mode: scriptModeSchema.optional(),
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
