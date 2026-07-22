dev:
    npx concurrently -k "pnpm --filter @agent-town/server dev" "pnpm --filter @agent-town/client dev"
dev-llm:
    LLM_PLANNER=1 npx concurrently -k "pnpm --filter @agent-town/server dev" "pnpm --filter @agent-town/client dev"
test *ARGS:
    pnpm vitest run {{ARGS}}
check:
    pnpm biome check . && pnpm -r exec tsc
fmt:
    pnpm biome check --write .
