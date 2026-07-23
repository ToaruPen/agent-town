import type { Position } from "./world.js";

export type WorldMapTerrain = "sea" | "plains" | "forest" | "hills" | "mountains";

export interface WorldMapCell {
  terrain: WorldMapTerrain;
  polityId: string | null;
}

export interface WorldCity {
  id: string;
  name: string;
  pos: Position;
  polityId: string;
  isCapital: boolean;
  foundedByEventId: string;
}

export interface WorldTradeRoute {
  id: string;
  cityIds: [string, string];
  establishedByEventId: string;
}

export interface WorldBorderChange {
  id: string;
  pos: Position;
  formerPolityId: string;
  currentPolityId: string;
  establishedByEventId: string;
}

export interface WorldMap {
  width: number;
  height: number;
  cells: WorldMapCell[];
  cities: WorldCity[];
  tradeRoutes: WorldTradeRoute[];
  borderChanges: WorldBorderChange[];
  settlementFrontierPos: Position;
}
