/**
 * What every page wears outside its route: the version chip (the machine drawer's door) and the
 * feedback picker. The tray window (`/machine`) wears neither; it is the machine body alone.
 */
import { FeedbackPicker } from "#/components/feedback-picker";
import { VersionChip } from "#/machine/drawer";

export function AppChrome({ pathname }: { pathname: string }) {
  if (pathname === "/machine") return null;
  return (
    <>
      <VersionChip />
      <FeedbackPicker />
    </>
  );
}
