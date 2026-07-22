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
