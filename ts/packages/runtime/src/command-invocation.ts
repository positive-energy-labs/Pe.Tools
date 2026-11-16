import { Schema } from "effect";
import {
  CommandFailure,
  CommandObservation,
  InertTicket,
  InvocationRecord,
  type CommandRef,
  type NewCommand,
} from "../../agent-contracts/src/command-authority.ts";

/** The slot owner serializes callers and durably replaces bytes, or refuses. It never erases ACKed refs. */
export interface InvocationSlot {
  exclusive<A>(body: () => Promise<A>): Promise<A>;
  read(): Promise<unknown | undefined>;
  write(record: InvocationRecord): Promise<void>;
}
export interface CommandTransport {
  allocate(intent: NewCommand): Promise<unknown>;
  submit(ref: CommandRef): Promise<unknown>;
  read(ref: CommandRef): Promise<unknown>;
}
const decodeRecord = Schema.decodeUnknownSync(InvocationRecord);
const decodeTicket = Schema.decodeUnknownSync(InertTicket);
const decodeObservation = Schema.decodeUnknownSync(CommandObservation);
const sameIntent = (a: NewCommand, b: NewCommand) => a.key === b.key && a.input === b.input;
const corresponding = (ref: CommandRef, observation: CommandObservation) => {
  if (observation.ref.id !== ref.id) throw new CommandFailure({ problem: "conflict", ref });
  return observation;
};

/** One protocol for Page, MCP and CLI; transport failure preserves SubmissionPending and its ref. */
export function commandInvocation(slot: InvocationSlot, transport: CommandTransport) {
  const load = async () => {
    const raw = await slot.read();
    if (raw === undefined) return undefined;
    const record = decodeRecord(raw);
    if (record._tag === "Accepted" || record._tag === "Terminal")
      corresponding(record.ticket.ref, record.observation);
    return record;
  };
  const unavailable = (ref: CommandRef | null): never => {
    throw new CommandFailure({ problem: "unavailable", ref });
  };
  const submit = async (record: InvocationRecord): Promise<CommandObservation> => {
    if (record._tag === "Allocating" || record._tag === "Unavailable")
      return unavailable(record._tag === "Unavailable" ? record.ref : null);
    if (record._tag === "Terminal") return corresponding(record.ticket.ref, record.observation);
    const { ticket } = record;
    // This durable write is mandatory even for a retry of an already accepted invocation.
    await slot.write({ _tag: "SubmissionPending", ticket });
    let observation: CommandObservation;
    try {
      observation = decodeObservation(await transport.submit(ticket.ref));
    } catch (error) {
      if (error instanceof CommandFailure && error.problem === "unavailable")
        await slot.write({ _tag: "Unavailable", ref: ticket.ref });
      if (error instanceof CommandFailure) throw error;
      throw new CommandFailure({ problem: "observation-lost", ref: ticket.ref, cause: error });
    }
    corresponding(ticket.ref, observation);
    try {
      await slot.write({
        _tag:
          observation.state === "terminal" || observation.state === "stopped"
            ? "Terminal"
            : "Accepted",
        ticket,
        observation,
      });
    } catch (cause) {
      throw new CommandFailure({ problem: "observation-lost", ref: ticket.ref, cause });
    }
    return observation;
  };
  return {
    /** A new user act uses a new durable slot. Occupied slots cannot replace an old command. */
    new: (intent: NewCommand) =>
      slot.exclusive(async () => {
        let record = await load();
        if (record && record._tag !== "Allocating")
          throw new CommandFailure({
            problem: "conflict",
            ref: "ticket" in record ? record.ticket.ref : record.ref,
          });
        if (record && !sameIntent(record.intent, intent))
          throw new CommandFailure({ problem: "conflict", ref: null });
        // Allocating is inert. A lost reply may orphan only inert host rows.
        await slot.write({ _tag: "Allocating", intent });
        const ticket = decodeTicket(await transport.allocate(intent));
        if (!sameIntent(ticket.authored, intent) || ticket.intent.key !== intent.key)
          throw new CommandFailure({ problem: "conflict", ref: ticket.ref });
        record = { _tag: "Allocated", ticket };
        await slot.write(record);
        return submit(record);
      }),
    retry: () =>
      slot.exclusive(async () => {
        const record = await load();
        // Missing, corrupt or merely allocating is never proof of a previously submitted ref.
        if (!record) return unavailable(null);
        return submit(record);
      }),
    observe: (ref: CommandRef) =>
      transport
        .read(ref)
        .then(decodeObservation)
        .then((observation) => corresponding(ref, observation)),
  };
}
