import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@pe/kit/lang/dialog";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { Switcher } from "@pe/kit/lang/switcher";
import {
  FINDINGS_DOORS,
  FINDING_KINDS,
  type Finding,
  type FindingKind,
} from "@pe/agent-contracts/slots";
import {
  decode,
  subjectCode,
  subjectOf,
  subjectRefCodeSchema,
  type SubjectRefCode,
} from "@pe/agent-contracts/subject-ref";
import type { TypedMount } from "../../../shell/typed-mount.ts";
import { subjectName } from "../subject-name.ts";

/** Exact subjects and their parts share a notes surface. Non-subject attention keys never join. */
export function notesOn(findings: readonly Finding[], subject: SubjectRefCode) {
  return findings.filter(
    (f) =>
      f.subject === subject || subjectCode({ ...subjectOf(f.subject), sub: undefined }) === subject,
  );
}

/** Mounted once by the shell. The menu carries only the subject, never a route-owned finding verb. */
export function Notes({
  mount,
}: {
  mount: Pick<TypedMount, "findings" | "kernelVerb" | "value"> & {
    spec: Pick<TypedMount["spec"], "key" | "subject" | "core">;
  };
}) {
  const [subject, setSubject] = useState<SubjectRefCode | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<FindingKind>("note");
  const [verdict, setVerdict] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const { route, code } = event.detail;
      if (route === mount.spec.key && typeof code === "string" && decode(code).ok) {
        setSubject(subjectRefCodeSchema.parse(code));
        setText("");
        setFailure(null);
      }
    };
    document.addEventListener("pe:findings", open);
    return () => document.removeEventListener("pe:findings", open);
  }, [mount.spec.key]);
  const roster = mount.spec.subject;
  const read = roster ? mount.value(roster.read ?? mount.spec.core) : null;
  const names = roster && read && "value" in read ? roster.options(read.value) : [];
  const run = async (key: "say" | "rule" | "retract", input: unknown) => {
    try {
      await mount.kernelVerb(FINDINGS_DOORS[key]).run(input);
      setFailure(null);
      return true;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const say = mount.kernelVerb(FINDINGS_DOORS.say);
  return (
    <Dialog
      open={subject !== null}
      onOpenChange={(open) => {
        if (!open) setSubject(null);
      }}
    >
      {subject ? (
        <DialogContent>
          <DialogTitle>Findings on {subjectName(subject, names)}</DialogTitle>
          {notesOn(mount.findings(), subject).map((f) => (
            <section key={f.id} aria-label={subjectName(f.subject, names)}>
              <p>{f.text}</p>
              <p>
                {f.said.by} · <time dateTime={f.said.at}>{f.said.at}</time>
              </p>
              {f.kind !== "note" ? (
                <>
                  <p>
                    {f.verdict
                      ? `${f.verdict.value} · ${f.verdict.by} · ${f.verdict.at}`
                      : "Unruled"}
                  </p>
                  <Switcher<string>
                    ariaLabel={`Ruling on ${f.text}`}
                    value={f.verdict?.value ?? ""}
                    options={FINDING_KINDS[f.kind].map((value) => ({
                      value,
                      label: value,
                      title: value,
                    }))}
                    onChange={(value) => void run("rule", { id: f.id, value })}
                  />
                  <Button
                    label={`Withdraw ruling on ${f.text}`}
                    refusal={mount.kernelVerb(FINDINGS_DOORS.rule).refusal}
                    onPress={async () => {
                      await run("rule", { id: f.id, value: null });
                    }}
                  >
                    Withdraw ruling
                  </Button>
                </>
              ) : null}
              <Button
                label={`Retract ${f.text}`}
                refusal={mount.kernelVerb(FINDINGS_DOORS.retract).refusal}
                onPress={async () => {
                  await run("retract", { id: f.id });
                }}
              >
                Retract
              </Button>
            </section>
          ))}
          {!notesOn(mount.findings(), subject).length ? <p>No findings on this subject.</p> : null}
          <Switcher<FindingKind>
            ariaLabel="finding kind"
            value={kind}
            onChange={(kind) => {
              setKind(kind);
              setVerdict("");
            }}
            options={(["note", "claim", "check"] as const).map((value) => ({
              value,
              label: value,
              title: value,
            }))}
          />
          {kind !== "note" ? (
            <Switcher<string>
              ariaLabel="verdict"
              value={verdict}
              onChange={setVerdict}
              options={FINDING_KINDS[kind].map((value) => ({ value, label: value, title: value }))}
            />
          ) : null}
          <Input
            aria-label="finding text"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            label="Write finding"
            refusal={say.refusal ?? (!text.trim() ? "Write what you found" : null)}
            onPress={async () => {
              if (
                await run("say", {
                  subject,
                  kind,
                  text: text.trim(),
                  ...(verdict ? { verdict } : {}),
                })
              )
                setText("");
            }}
          >
            Write
          </Button>
          {failure ? <p role="alert">{failure}</p> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
