import { MastraClient } from "@mastra/client-js";
import { redirect } from "@tanstack/react-router";
import { z } from "zod";

import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";
import { landThread } from "#/workbench/land-thread";

const peInfoSchema = z.object({ controllerId: z.string(), resourceId: z.string() });

export async function withThread({
  location,
}: {
  location: { pathname: string; searchStr: string };
}) {
  const search = new URLSearchParams(location.searchStr);
  if (search.get("thread")?.trim()) return;
  const config = resolveWorkbenchConfig();
  const response = await fetch(peUrl(config, "/info"));
  if (!response.ok) throw new Error(`Workbench connection failed (${response.status}).`);
  const info = peInfoSchema.parse(await response.json());
  const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(
    info.controllerId,
  );
  search.set(
    "thread",
    await landThread({ session: controller.session(info.resourceId) }),
  );
  throw redirect({ href: `${location.pathname}?${search}`, replace: true });
}
