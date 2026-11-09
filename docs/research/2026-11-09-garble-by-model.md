# Run-together text in agent messages, by model

Date: 2026-11-09. Source: `.artifacts/runs/retro-20261109-corpus/t3_events.jsonl` (5,657 agent-to-agent messages, 6,343 final replies, window 2026-10-26 to 2026-11-09), model per thread from `threads.json`. Script: `garble.py` in the session scratchpad, not retained; the rule is restated here so the measurement can be rebuilt.

The owner noticed "strange, ID-like wording" in messages between hub and child agents. Hypothesis tested: it is a GPT-family habit that a word or character cap in the brief triggers.

## Rule

A garble token is a whitespace-delimited token of 22 or more characters with at least two lowercase-to-uppercase or letter-to-digit transitions, excluding URLs, paths, hex, UUIDs, identifiers made of underscores, dots or dashes, and code spans. The garble rate of a message is garble tokens per 100 words. Tokens shorter than 22 characters ("Boundedprobesstop") are not counted, so GPT figures understate the effect.

## Result

| family | message type | messages | share with a garble token | mean per 100 words |
|---|---|---|---|---|
| GPT (gpt-6.1-sol, gpt-6-astra) | agent to agent | 2,578 | 18.0% | 0.570 |
| GPT | reply to owner | 145 | 0% | 0 |
| GPT | reply to parent | 1,800 | 0.3% | 0.018 |
| Claude (opus-5-5, fable-5-1) | agent to agent | 1,679 | 2.5% | 0.023 |
| Claude | reply to owner | 545 | 0.2% | 0 |
| Claude | reply to parent | 3,766 | 0.1% | 0 |

gpt-6.1-sol alone: 2,425 agent-to-agent messages, 18.4% with a garble token. Every Claude hit inspected was a real identifier such as `tsOnlyOperationCatalog`, not run-together prose.

Examples, all gpt-6.1-sol agent-to-agent:

```
ExpectedproductionLOC0,
Partialsolc1homeREADONLY(noruntime,
PriorUIactorignoredthisandcommittedrootdespitecorrectT3allocation;
CurrentlyreadingstandaloneFC24
```

The cap half of the hypothesis is not supported. None of the ten worst threads had a word, character or line cap in its launch brief. Those briefs were themselves run together ("Parent keepsSDK/runtime/slot/triage/verdict"), so the habit passes from a parent Sol to its children, or it is Sol's own.

## What this cannot show

Caps set in skills or system prompts are invisible here. Model is per thread, not per message, and 1,382 messages from mixed-model threads are excluded. Garble is confounded with role, because Sol ran most bounded runner threads. Cause is not separated: a cap, Sol's style, or copying a garbled parent brief all fit.

## What changed because of it

`delegate` now says to forward a child's message in your own plain words, never verbatim. Driver and purger briefs carry no word cap.
