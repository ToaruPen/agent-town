import { WS_PORT } from "@agent-town/shared";

import { startServer } from "./net/wsServer.js";

const llmPlannerEnabled = process.env.LLM_PLANNER === "1";

startServer({ port: WS_PORT, seed: Date.now() % 2 ** 31, llmPlannerEnabled });
