# M2.5 "Remote Access + Mobile" Implementation Plan

> **For agentic workers:** Same regime as M1/M2 plans: TDD, M1+M2 Global Constraints apply, no reviewer sub-agents, commit is part of the task.

**Goal:** The town is reachable from a phone through one Cloudflare tunnel: a production server serves the built client and the WebSocket on a single port, and the client is playable (viewable) on mobile screens.

## Task M2X-A: Single-origin production serve

**Files:**
- Modify: `packages/server/src/net/wsServer.ts` (accept an `http.Server` + path option), `packages/server/src/index.ts`
- Create: `packages/server/src/net/staticServer.ts`
- Modify: `packages/client/src/net/wsClient.ts` (+ its test), `packages/client/vite.config.ts`, `justfile`
- Test: extend `packages/server/test/wsServer.test.ts`; create `packages/server/test/staticServer.test.ts`

**Contract:**
- `startServer` gains `opts.staticDir?: string`. It creates ONE `http.Server` on `opts.port`: WebSocket upgrades ONLY on path `/ws`; all other GETs serve files from `staticDir` when set (hand-rolled static handler: index.html fallback for `/`, correct Content-Type for .html/.js/.css/.map/.png/.svg, 404 otherwise, path-traversal rejected — test with `GET /../etc/passwd` → 404). No new dependencies.
- Client WS URL: `const url = import.meta.env.DEV ? "ws://localhost:8790/ws" : \`\${location.protocol === "https:" ? "wss" : "ws"}://\${location.host}/ws\`;` — dev keeps two processes; vite.config.ts adds `server: { proxy: { "/ws": { target: "ws://localhost:8790", ws: true } } }` and wsClient connects to `/ws` relative in dev too if simpler — pick ONE approach, document in commit body.
- justfile: `serve` = build client (`pnpm --filter @agent-town/client build`) then `STATIC_DIR=packages/client/dist` run server; `serve-llm` = same with `LLM_PLANNER=1`.
- Existing wsServer tests updated to connect on `/ws`.

**Branch/commit:** `m2x-a-single-origin` / `feat(server): single-origin static + websocket serving`

## Task M2X-B: Mobile-friendly client

**Files:**
- Modify: `packages/client/index.html` (viewport meta: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`), `packages/client/src/main.ts`, `packages/client/src/render/*.ts` as needed
- Test: none automated (render layer); keep wsClient tests green.

**Contract:**
- Pixi `Application` uses `resizeTo: window`; a root world `Container` holds map+agent layers.
- Fit: on welcome and on resize, scale the world container so the full map fits the viewport (contain), centered.
- Touch/mouse: one-finger (or mouse) drag pans the world container; pinch zooms around the gesture midpoint (clamp zoom 0.5x–4x of fit scale); double-tap resets to fit. Use Pixi federated pointer events; no external gesture lib.
- HUD stays screen-fixed (not inside the world container), font size ≥ 14px, top-left with safe-area padding (`env(safe-area-inset-top)` via CSS on a DOM overlay OR pixi Text with margin — implementer's choice, state it in the commit body).
- Desktop behavior must not regress: wheel = zoom, drag = pan.

**Branch/commit:** `m2x-b-mobile-client` / `feat(client): responsive fit, touch pan/zoom, mobile hud`

## Task M2X-C (SUPERVISOR-RUN): Tunnel + phone smoke

- `just serve-llm`, then `cloudflared tunnel --url http://localhost:8790` (quick tunnel), verify the public URL serves the client and streams updates (ws probe against `wss://<url>/ws`), report URL to the user. Named-tunnel upgrade documented in README only if the user asks.
