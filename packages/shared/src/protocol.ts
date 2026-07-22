import type { AgentState, Position, Tile, WorldState } from "./world.js";

export type ServerMessage =
  | { type: "welcome"; state: WorldState }
  | {
      type: "update";
      tick: number;
      agents: AgentState[];
      stockpile: { pos: Position; wood: number; food: number };
      deaths: WorldState["deaths"];
      changedTiles: { index: number; tile: Tile }[];
    };

export type ClientMessage = { type: "hello" };

export function encodeMessage(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

export function decodeServerMessage(raw: string): ServerMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isServerMessage(parsed)) throw new Error(`invalid server message: ${raw.slice(0, 120)}`);
  return parsed;
}

export function decodeClientMessage(raw: string): ClientMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isClientMessage(parsed)) throw new Error(`invalid client message: ${raw.slice(0, 120)}`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasRequiredKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => key in value);
}

function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value)) return false;
  if (value.type === "welcome") return hasRequiredKeys(value, ["state"]);
  if (value.type === "update") {
    return hasRequiredKeys(value, ["tick", "agents", "stockpile", "deaths", "changedTiles"]);
  }
  return false;
}

function isClientMessage(value: unknown): value is ClientMessage {
  return isRecord(value) && value.type === "hello";
}
