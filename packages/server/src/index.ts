import { WS_PORT } from "@agent-town/shared";

import { startServer } from "./net/wsServer.js";

function optionalPositiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`invalid ${name}: ${value}; expected a positive integer`);
  }
  return parsed;
}

const configuredPort = process.env.PORT;
const port = configuredPort === undefined ? WS_PORT : Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`invalid PORT: ${configuredPort}`);
}

const staticDir = process.env.STATIC_DIR;
const seed = optionalPositiveInteger("SEED", process.env.SEED) ?? Math.max(1, Date.now() % 2 ** 31);

startServer({
  port,
  seed,
  ...(staticDir === undefined ? {} : { staticDir }),
});
