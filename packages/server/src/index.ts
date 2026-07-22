import { WS_PORT } from "@agent-town/shared";

import { startServer } from "./net/wsServer.js";

startServer({ port: WS_PORT, seed: Date.now() % 2 ** 31 });
