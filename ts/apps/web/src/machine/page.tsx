import type { AppSurface, Machine, Reading } from "@pe/agent-contracts";
import { MachineBody } from "./body";
import type { GroupKey } from "./model";

export function MachinePage({
  reading,
  fixture,
  shell,
  section,
  session,
  onSection,
}: {
  reading: Reading<Machine>;
  fixture: boolean;
  shell: AppSurface;
  section?: GroupKey;
  session?: string;
  onSection?: (section: GroupKey | undefined) => void;
}) {
  return (
    <main
      data-surface="page"
      className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] px-3 py-2"
      aria-label="machine"
    >
      <MachineBody
        reading={reading}
        fixture={fixture}
        shell={shell}
        group={section}
        session={session}
        onGroup={onSection}
      />
    </main>
  );
}
