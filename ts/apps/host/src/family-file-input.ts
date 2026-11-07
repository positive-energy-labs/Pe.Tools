import { z } from "zod";
import { podMemberSchema, parsedDocViewSchema } from "@pe/agent-contracts";
import { familySpecAsset } from "./family-spec.ts";
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
export const readFamilySpec = async (raw: unknown) => {
    const member = podMemberSchema.parse(raw);
    const asset = (path: string) =>
      familySpecAsset(
        new URL(`http://host/family/spec?${new URLSearchParams({ ...member, path })}`),
      );
    const link = await asset(`${member.path}.spec.json`);
    if (link.status === 404) return { doc: null, error: null };
    try {
      if (!link.ok) throw Error(await link.text());
      const path = z.object({ path: z.string() }).parse(await link.json()).path;
      const stored = await asset(path);
      if (!stored.ok)
        throw Error(
          `Saved PDF evidence is unavailable (${stored.status}); attach the cut sheet again`,
        );
      return { doc: parsedDocViewSchema.parse(await stored.json()), error: null };
    } catch (error) {
      return { doc: null, error: message(error) };
    }
};
