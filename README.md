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

## LLM mode

One resident (Ash) can plan with a real LLM through the Claude Code CLI:

```sh
just dev-llm   # requires a logged-in `claude` CLI (subscription auth)
```

Watch the server log for `{"at":"llmPlanner","agent":"agent-1","outcome":"llm"}`.
LLM-driven residents render with a gold ring; "…" appears while they think.
All LLM failures fall back to the rule-based planner — the town never stalls.
