import { DUCTS_SUMMARY, DUCTS_WALK } from "@pe/agent-contracts/ducts-guide";

/** Documentation narrative; loading and Tutorial's map use HelpWorld. */
export function DuctsIntroduction() {
  return (
    <section aria-label="How Ducts works" className="flex max-w-3xl flex-col gap-3">
      <h2 className="t-small t-upper">How Ducts works</h2>
      <p>{DUCTS_SUMMARY}</p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {DUCTS_WALK.map(({ step, who, body }, i) => (
          <li key={step}>
            <details>
              <summary className="t-small t-upper">
                {i + 1}. {step}
              </summary>
              <p className="t-small text-ink-2">{who}</p>
              <p>{body}</p>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
