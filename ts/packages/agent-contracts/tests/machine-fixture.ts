import type { Machine, MachineAttachment, MachineAttachmentDocument } from "../src/machine.ts";

const at = "2026-10-12T12:00:00.000Z";
const leg = { observedAtUtc: at, attemptedAtUtc: at, error: null };
type Attachment = Pick<MachineAttachment, "session"> & {
  documents: readonly Omit<MachineAttachmentDocument, "access" | "session">[] | null;
};
export function machineFixture(attachments: readonly Attachment[] = []): Machine {
  return {
    observedAtUtc: at,
    host: null,
    share: null,
    providers: null,
    access: null,
    legs: { sessions: leg, attachments: leg },
    update: {
      plan: null,
      receipt: null,
      requestId: null,
      admittedPlanId: null,
      planLeg: leg,
      receiptLeg: leg,
    },
    revit: {
      years: [2025],
      unclassifiedAttachments: [],
      sessions: attachments.map((attachment, index) => ({
        whose: "you",
        row: {
          case: "controlled-active",
          id: `sdk-${index}`,
          year: 2025,
          observedAtUtc: at,
          execution: { allowed: true, code: null, detail: null },
          detail: "",
          dialogs: null,
          origin: "test",
          project: null,
          worktree: "C:/test",
          process: { pid: index + 1, processStartUtc: at, executable: "Revit.exe" },
          shape: {
            payload: "installed",
            purpose: "interactive",
            reload: "none",
            posture: "foreground",
            quarantine: false,
          },
          receipt: {
            payload: "installed",
            buildStamp: null,
            generationId: null,
            generationRoot: "C:/test/installed",
            overridePath: null,
            receiptPath: "test.json",
          },
          bridge: {
            bridge: "ready",
            documents: [],
            modal: null,
            privateBytes: null,
            queue: null,
            sessionDescriptor: null,
            unresponsive: false,
          },
        },
        documents: null,
        documentsLeg: leg,
        attachment: {
          ...attachment,
          pid: index + 1,
          processStartUtcUnixMs: Date.parse(at),
          documents:
            attachment.documents?.map((doc) => ({
              ...doc,
              session: attachment.session,
              access: { kind: "read" },
            })) ?? null,
        },
      })),
    },
  };
}
