# 0014 — Pea talks to any OpenAI-compatible endpoint

Date: 2026-09-30. Status: accepted. Source: kaitpw, inference-routing conversation.

> Superseded in part, 2026-10-09 (host ledger, MACHINE CONTROL PLANE ruling 7): inbound share of the
> installed host over the user's tailnet is a product switch (`share.ts` owns one Tailscale Serve
> mapping; `request-identity.ts` verifies the Serve identity header before every handler). The
> inference-endpoint rule below is untouched: Pea still talks to one OpenAI-compatible endpoint and
> how a user reaches a private endpoint stays hosting advice.


## Context

Pea needs inference on machines that are not the developer's PC: a Revit runner laptop, a shared
office laptop, a coworker's install. Each case had been imagined as its own feature (a Tailscale
link, a key-sharing scheme, a "Pea Cloud" gateway, Clerk sign-in). Pea's model layer is Mastra
(`createMastraCodeGateway` in `ts/packages/runtime/src/pea-runtime.ts`). Mastra reads
`OPENAI_BASE_URL` and `OPENAI_API_KEY` from the process environment, and `peaModelAllowlist`
already lists `openai/*` models. A subscription proxy (CLIProxyAPI over a ChatGPT login) was proven
on 2026-09-30 to answer `/v1/chat/completions` behind a plain key. Every imagined case reduces to
one pair of values.

## Decision

**Pea talks to any OpenAI-compatible endpoint. The product concept is one endpoint URL plus one key.**

- Pea stores one inference endpoint `{ baseUrl, apiKey }` and proves it (models list, then one
  completion) before it is saved. Nothing in Pea knows or asks what stands behind the URL.
- A subscription proxy on a spare laptop, a VPS, Ollama, OpenRouter, a company gateway, and a future
  Positive Energy gateway are all the same thing to Pea: an endpoint. How a user reaches a private one
  (Tailscale, LAN) is hosting advice in a doc, never a product concept.
- Identity is a separate, later decision. A sign-in (Clerk or other) would only hand the browser a
  session that a gateway exchanges for upstream credit. It is not built until a gateway exists. No
  stub buttons.

## Consequences

- The agent cluster gains one settings surface and one host probe, and no provider-specific code.
  A proposal for a Tailscale integration, a key-distribution feature, or a provider picker is
  re-litigating this ADR.
- Coworkers today paste an endpoint and a key. That fragility is accepted until a gateway with
  sign-in replaces the key, and the replacement changes nothing in Pea's model layer.
- Mastra's env contract is now load-bearing. If a Mastra upgrade stops honouring `OPENAI_BASE_URL`,
  the endpoint setting breaks and the host probe must say so.
