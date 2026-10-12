import type { ParsedDocView, PodMember } from "@pe/agent-contracts";

export const assetUrl = (pod: string, path: string) =>
  `/pe/family-spec?${new URLSearchParams({ pod, path })}`;

/** Resolve portable paths only at the presentation boundary; persisted JSON never holds host URLs. */
export function displaySpec(doc: ParsedDocView, member: PodMember): ParsedDocView {
  const dir = member.path.slice(0, member.path.lastIndexOf("/") + 1);
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      screenshotUrl: page.screenshotUrl ? assetUrl(member.pod, dir + page.screenshotUrl) : null,
    })),
    images: doc.images.map((image) => ({ ...image, url: assetUrl(member.pod, dir + image.url) })),
  };
}
