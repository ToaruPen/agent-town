import { SEASONS, SPEED_MULTIPLIERS } from "./constants.js";
import type {
  DirectiveBlockedReason,
  DirectiveId,
  DirectiveKind,
  DirectiveOption,
  NationId,
  NationState,
  NationWorldState,
  Season,
  SpeedMultiplier,
  WorldCellChange,
} from "./nation.js";

export type ServerMessage =
  | { type: "welcome"; state: NationWorldState }
  | { type: "clock"; tick: number; year: number; season: Season; speed: SpeedMultiplier }
  | {
      type: "season";
      tick: number;
      year: number;
      season: Season;
      nations: NationState[];
      changedCells: WorldCellChange[];
    }
  | {
      type: "orders";
      tick: number;
      nationId: NationId; // always the receiving client's own nation
      autoPilot: boolean;
      options: DirectiveOption[];
      queued: { id: DirectiveId; kind: DirectiveKind; targetCityId: string | null } | null;
      chancellorChoice: {
        id: DirectiveId;
        kind: DirectiveKind;
        targetCityId: string | null;
      } | null;
      rejected: DirectiveBlockedReason | "notYourNation" | "unknownNation" | null;
    };

export type ClientMessage =
  | { type: "hello" }
  | { type: "selectNation"; nationId: NationId }
  | { type: "issueDirective"; kind: DirectiveKind; targetCityId: string | null }
  | { type: "cancelDirective"; directiveId: DirectiveId }
  | { type: "setSpeed"; speed: SpeedMultiplier }
  | { type: "setAutoPilot"; enabled: boolean };

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

function hasWorldMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasRequiredKeys(value, [
      "width",
      "height",
      "cells",
      "cities",
      "tradeRoutes",
      "borderChanges",
      "settlementFrontierPos",
    ])
  );
}

function hasWorldHistory(value: unknown): boolean {
  return isRecord(value) && hasWorldMap(value.worldMap);
}

function isSeason(value: unknown): value is Season {
  return typeof value === "string" && SEASONS.some((season) => season === value);
}

function isSpeed(value: unknown): value is SpeedMultiplier {
  return typeof value === "number" && SPEED_MULTIPLIERS.some((speed) => speed === value);
}

function isTargetCityId(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isDirectiveKind(value: unknown): value is DirectiveKind {
  switch (value) {
    case "clearFarmland":
    case "developTimber":
    case "openMine":
    case "growCity":
    case "encourageStores":
    case "holdFestival":
      return true;
    default:
      return false;
  }
}

function hasChancellorChoiceId(value: unknown): boolean {
  return value === null || (isRecord(value) && typeof value.id === "string");
}

function isTickMessage(value: Record<string, unknown>): boolean {
  return typeof value.tick === "number" && typeof value.year === "number" && isSeason(value.season);
}

function isNationWorldState(value: unknown): value is NationWorldState {
  return (
    isRecord(value) &&
    isTickMessage(value) &&
    isSpeed(value.speed) &&
    hasWorldHistory(value.history) &&
    Array.isArray(value.nations) &&
    (value.playerNationId === null || typeof value.playerNationId === "string")
  );
}

function isOrdersMessage(value: Record<string, unknown>): boolean {
  return (
    hasRequiredKeys(value, [
      "tick",
      "nationId",
      "autoPilot",
      "options",
      "queued",
      "chancellorChoice",
      "rejected",
    ]) &&
    typeof value.tick === "number" &&
    typeof value.nationId === "string" &&
    typeof value.autoPilot === "boolean" &&
    Array.isArray(value.options) &&
    hasChancellorChoiceId(value.chancellorChoice)
  );
}

function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value)) return false;
  if (value.type === "welcome") return isNationWorldState(value.state);
  if (value.type === "clock") return isTickMessage(value) && isSpeed(value.speed);
  if (value.type === "season") {
    return (
      isTickMessage(value) && Array.isArray(value.nations) && Array.isArray(value.changedCells)
    );
  }
  return value.type === "orders" && isOrdersMessage(value);
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "hello":
      return true;
    case "selectNation":
      return typeof value.nationId === "string";
    case "issueDirective":
      return isDirectiveKind(value.kind) && isTargetCityId(value.targetCityId);
    case "cancelDirective":
      return typeof value.directiveId === "string";
    case "setSpeed":
      return isSpeed(value.speed);
    case "setAutoPilot":
      return typeof value.enabled === "boolean";
    default:
      return false;
  }
}
