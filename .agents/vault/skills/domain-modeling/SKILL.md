---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, building or editing a glossary (package Shared Language or feature GLOSSARY.md), or recording or editing an ADR.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline, challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* a glossary for vocabulary is not this skill, that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Where glossaries live, scoped, never central

A single central glossary was tried and failed: vocabulary matters most in the weeds, and a root file is never open when you're there. Glossaries are **scoped to where the confusion happens**:

- **Package-scoped terms** → that package's `AGENTS.md` `Shared Language` table (the long-standing house mechanism, extend it, don't invent a sibling).
- **Feature-scoped / cross-package terms** → `docs/features/<name>/GLOSSARY.md`, created lazily on the first resolved term, format per [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md). Glossary only, no implementation details, no spec content.

This skill owns building and sharpening both. ADR placement, numbering, and the promotion bar are owned **per the `docs` skill**; this skill supplies the template ([ADR-FORMAT.md](./ADR-FORMAT.md)) and the judgement for when to offer one mid-conversation.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the scoped glossary (nearest `AGENTS.md` Shared Language, or the feature's `GLOSSARY.md`), call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y, which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account', do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible, which is right?"

### Update the glossary inline

When a term is resolved, update the owning glossary right there, package terms into that `AGENTS.md` Shared Language row, feature terms into `GLOSSARY.md`. Don't batch these up, capture them as they happen.

A glossary is totally devoid of implementation details, never a spec, a scratch pad, or a repository for implementation decisions.

### Offer ADRs sparingly

The promotion bar is the `docs` skill's: an ADR is for a decision that constrains *other* features. On top of that bar, only offer to create one mid-conversation when all three are true:

1. **Hard to reverse**, the cost of changing your mind later is meaningful
2. **Surprising without context**, a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**, there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR, a feature-scoped decision is a Decided line in the feature's `LEDGER.md` instead. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
