/** Shared human scope gesture used by H1 and J6. The option includes its staged-cell count. */
export async function pickFansWriteScope(
  fan: string,
  press: (scope: string, pattern: string) => Promise<unknown>,
  wait: (scope: string, pattern: string) => Promise<unknown>,
) {
  const scope = '[data-choice-cell="Write scope"]';
  const label = fan.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await press(scope, "^None");
  await press('[role="listbox"]', `^${label} · \\d+ staged`);
  await wait(scope, `^${label} · `);
}
