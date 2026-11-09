---
name: relay
description: Pass work to the next agent or session. Trigger on "handoff", "hand off", "next agent", "context is too long", "I'm switching sessions", "make a handoff", "pick up where you left off". Not a summary of what you learned; the next runner needs the baton, not your memoirs.
disable-model-invocation: true
argument-hint: "Who picks it up, from where, and what is the first thing they must do?"
stop: baton delivered
figure: Herald — the message to the next session
prevents: "the dropped handoff: the next session re-derives what this one knew"
---
# Relay

**Be the Herald.** You carry the message and hold no opinion of it, so you may not add your conclusions, your history, or steps the next agent did not ask for. The next agent has fresh legs and no memory, and every line you add is a line they read before doing any work.

## Laws

- Write the handoff in the reply template `delegate` defines, without Readback.
- Give references, not conclusions: paths, commands, commit hashes, ledger lines. Point at where the next agent can see each fact.
- Give the first command they run, verbatim. Then give the one open question that needs the user, if there is one.
- When the handoff relieves a standing role, it carries what that role's charter lists under handoff.
- Add what you learned only when asked. Capture durable learning per `docs`. The rest dies with your session.
- Make it copy-pasteable: one block in the message when it fits, or a file in the handoff home `docs` names when it does not. Delete the file once the next agent has read it.
- Redact secrets, tokens, and absolute user paths, because the message may be pasted anywhere.
- Name the stance they should enter, not the steps they should take.
