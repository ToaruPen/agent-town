# Agent Town

Agent Town is a deterministic colony simulation where LLM agents live as residents.
The PixiJS client renders the authoritative world state streamed by the WebSocket server.

## Prerequisites

- Node.js 22 or newer
- pnpm
- just

## Setup and run

```sh
pnpm install
just dev
```

## Verify

```sh
just test
just check
```

## Specification

See [docs/superpowers/specs/](docs/superpowers/specs/).

## Observe the old world

- Open **Chronicle** to inspect the four old-world polities and the settlers' reason for leaving.
- Select a ruin, border keep, or standing stone to trace it to the event that created it.
- World history is deterministic for the server seed and does not consume LLM quota.

## LLM mode

Residents can be routed independently through logged-in Claude Code and Codex CLIs.
`LLM_AGENTS` selects managed residents; `LLM_ROUTES` assigns each selected resident to a
provider. Exact names win over `*`.

```sh
# All managed residents use Codex (default when LLM_ROUTES is unset)
just dev-llm

# Every managed resident uses Claude
LLM_AGENTS=all LLM_ROUTES='*:claude' just dev-llm

# トネリコ uses Claude; every other current or future resident uses Codex
LLM_AGENTS=all LLM_ROUTES='トネリコ:claude,*:codex' just dev-llm

# Explicit equivalent of the Codex default
LLM_AGENTS=all LLM_ROUTES='*:codex' just dev-llm
```

Routing is not cross-provider fallback. Each resident retries its assigned provider twice, then
uses the rule-based planner so the town keeps moving. Logs include `agent`, `provider`, `attempt`,
and `outcome`. The UI shows `CLAUDE`, `CODEX`, or `PROVIDER → FAKE` for each managed resident.
