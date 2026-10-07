import type { FamilyDocument, SettingsFieldState, SettingsSnapshot } from "@pe/agent-contracts";
import { parsedDocViewSchema, type ParsedDocView, type PodMember } from "@pe/agent-contracts";
import { assetUrl } from "#/family/spec";

export type FieldState = SettingsFieldState;
export type FamilySnapshot = Omit<SettingsSnapshot, "member"> & {
  member?: SettingsSnapshot["member"];
};
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;

export async function openSpec(member: PodMember): Promise<ParsedDocView | null> {
  const sidecar = await fetch(assetUrl(member.pod, `${member.path}.spec.json`));
  if (sidecar.status === 404) return null;
  if (!sidecar.ok) throw Error("The family spec link could not be opened");
  const link = (await sidecar.json()) as { path: string };
  const response = await fetch(assetUrl(member.pod, link.path));
  if (!response.ok) throw Error("The attached spec JSON could not be opened");
  return parsedDocViewSchema.parse(await response.json());
}
