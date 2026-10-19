import { peClient } from "#/host/pe-client";
import type { PageChoice, PageTargetReading } from "@pe/agent-contracts";

/**
 * The human door to a Page's binding (ADR 0017 D10). The picker runs in the app, so the host reads
 * this request as a person; a click inside the Page itself never could prove one.
 */
export const readPageTarget = async (slug: string) =>
  (await peClient.call("page.target", { params: { slug } })) as unknown as PageTargetReading;

export const bindPage = async (slug: string, body: PageChoice) =>
  (await peClient.call("page.bind", { params: { slug }, body })) as unknown as PageTargetReading;
