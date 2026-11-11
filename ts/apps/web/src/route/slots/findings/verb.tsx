import { useState } from "react";
import { FINDING_KINDS, type FindingInput, type FindingKind } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { Button, ButtonIcon } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { Switcher } from "@pe/kit/lang/switcher";

const KIND_SAYS: Record<FindingKind, string> = {
  note: "note: what you saw, with no verdict",
  claim: "claim: something that holds or not, ruled yes, no or not this",
  check: "check: a test the subject passes or fails",
};

/**
 * The person's row verb for findings (ADR 0035 rule 9): a finding on this row's subject, written
 * through the route's `findings.write` command, where the host stamps the author from the caller.
 * A kind with verdicts refuses until one is chosen; nothing is defaulted for the person.
 */
export function FindingVerb({
  subject,
  name,
  write,
}: {
  subject: SubjectRefCode;
  /** The row's own name, for the trigger's label. */
  name: string;
  write: (finding: FindingInput) => Promise<unknown>;
}) {
  const [kind, setKind] = useState<FindingKind>("note");
  const [verdict, setVerdict] = useState("");
  const [text, setText] = useState("");
  const verdicts: readonly string[] = FINDING_KINDS[kind];
  const refusal = !text.trim()
    ? "Write what you found"
    : verdicts.length && !verdicts.includes(verdict)
      ? `Choose this ${kind}'s verdict`
      : null;
  return (
    <Popover>
      <PopoverTrigger aria-label={`Write a finding on ${name}`}>Finding</PopoverTrigger>
      <SubjectPopoverContent aria-label={`Finding on ${name}`} className="flex flex-col gap-1.5 p-(--gutter)">
        {/* A row's verb slot compacts its Buttons to icons; the popover's own verbs keep their words. */}
        <ButtonIcon value={null}>
        <Switcher<FindingKind>
          ariaLabel="finding kind"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setVerdict("");
          }}
          options={(Object.keys(FINDING_KINDS) as FindingKind[]).map((k) => ({ value: k, label: k, title: KIND_SAYS[k] }))}
        />
        {verdicts.length ? (
          <Switcher<string>
            ariaLabel="verdict"
            value={verdict}
            onChange={setVerdict}
            options={verdicts.map((v) => ({ value: v, label: v, title: `verdict: ${v}` }))}
          />
        ) : null}
        <Input aria-label="finding text" value={text} onChange={(event) => setText(event.target.value)} />
        <Button
          kind="commit"
          label={`Write ${kind} on ${name}`}
          refusal={refusal}
          onPress={async () => {
            try {
              await write({
                id: crypto.randomUUID(),
                subject,
                kind,
                text: text.trim(),
                place: {},
                ...(verdicts.length ? { verdict } : {}),
              });
              setText("");
            } catch (error) {
              return { message: error instanceof Error ? error.message : String(error) };
            }
          }}
        >
          Write
        </Button>
        </ButtonIcon>
      </SubjectPopoverContent>
    </Popover>
  );
}
