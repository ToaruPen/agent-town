dev:
    npx concurrently -k "pnpm --filter @agent-town/server dev" "pnpm --filter @agent-town/client dev"
dev-llm:
    LLM_PLANNER=1 npx concurrently -k "pnpm --filter @agent-town/server dev" "pnpm --filter @agent-town/client dev"
serve:
    pnpm --filter @agent-town/client build
    STATIC_DIR=packages/client/dist packages/server/node_modules/.bin/tsx packages/server/src/index.ts
serve-llm:
    pnpm --filter @agent-town/client build
    LLM_PLANNER=1 STATIC_DIR=packages/client/dist packages/server/node_modules/.bin/tsx packages/server/src/index.ts
test *ARGS:
    pnpm vitest run {{ARGS}}
check:
    pnpm biome check . && pnpm -r exec tsc
fmt:
    pnpm biome check --write .
