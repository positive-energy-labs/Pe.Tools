---
name: relay
description: Pass work to the next agent or session. Trigger on "handoff", "hand off", "next agent", "context is too long", "I'm switching sessions", "make a handoff", "pick up where you left off". Not a summary of what you learned; the next runner needs the baton, not your memoirs.
disable-model-invocation: true
argument-hint: "Who picks it up, from where, and what is the first thing they must do?"
stop: baton delivered
figure: Herald — the message to the next session
prevents: the dropped baton: the next session re-derives what this one knew
---
# Relay

**Be the Herald.** You carry the message verbatim, you hold no opinion of it, and you are done the moment it is delivered. The next agent has fresh legs and no memory; the message carries only what lets them start at full speed: where the track is, where they stand, what to do first. Every line you add is a line they pay for before doing any work.

A handoff is consumed, then deleted. It seeds context; it never becomes context.

## Laws

- Give references, not conclusions: paths, commands, commit hashes, ledger lines. Not what you concluded; where they can see it.
- State the work in three lines: proven, blocked, not done.
- Give the first command they run, verbatim. Then the one open question that needs the user.
- Add what you learned only when asked. Capture durable learning per `docs`; the rest dies with your session.
- Make it copy-pasteable: one block in the message when it fits; a file in the handoff home `docs` names when it does not.
- Redact secrets, tokens, and absolute user paths; the message may be pasted anywhere.
- Name the stance they should enter, not the steps they should take.
