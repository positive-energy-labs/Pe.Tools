import type { PeaWorldDescriptor } from "@pe/agent-contracts";

export function WorldBadge({ world }: { world?: PeaWorldDescriptor }) {
  if (!world || world.storage.kind !== "local-unversioned") return null;
  const detail = `Pea is using ${world.root}. Files persist locally. Mesa checkpoints, history, diffs, and cross-machine reopen are unavailable. Commands are not OS-isolated.`;
  return (
    <span className="truncate text-ink-2" title={detail} aria-label={detail}>
      Local folder · unversioned · this machine only
    </span>
  );
}
