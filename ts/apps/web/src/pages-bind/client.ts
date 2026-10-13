import type { PageSlot, PageTargetReading } from "@pe/agent-contracts";

import { hostFetch } from "#/host/runtime";

/**
 * The human door to a Page's binding (ADR 0017 D10). The picker runs in the app, so the host reads
 * this request as a person; a click inside the Page itself never could prove one.
 */
const answer = async (response: Response): Promise<PageTargetReading> => {
  const body = (await response.json().catch(() => null)) as
    | (PageTargetReading & { message?: never })
    | { message?: string; error?: string }
    | null;
  if (!response.ok)
    throw new Error(
      (body && "message" in body && body.message) ||
        (body && "error" in body && body.error) ||
        `the host answered ${response.status}`,
    );
  return body as PageTargetReading;
};

export const readPageTarget = async (slug: string) =>
  answer(await hostFetch(`/pages/${encodeURIComponent(slug)}/target`));

export const bindPage = async (slug: string, slot: PageSlot) =>
  answer(
    await hostFetch(`/pe/pages/${encodeURIComponent(slug)}/binding`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slot),
    }),
  );
