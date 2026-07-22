import { WS_PORT } from "@agent-town/shared";

import { startServer } from "./net/wsServer.js";

const llmPlannerEnabled = process.env.LLM_PLANNER === "1";
const configuredPort = process.env.PORT;
const port = configuredPort === undefined ? WS_PORT : Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`invalid PORT: ${configuredPort}`);
}
const staticDir = process.env.STATIC_DIR;

startServer({
  port,
  seed: Date.now() % 2 ** 31,
  llmPlannerEnabled,
  ...(staticDir === undefined ? {} : { staticDir }),
});
