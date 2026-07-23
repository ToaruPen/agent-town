import {
  type Position,
  WORLD_MAP_CAPITAL_RADIUS_PX,
  WORLD_MAP_CELL_SIZE_PX,
  WORLD_MAP_CITY_RADIUS_PX,
  WORLD_MAP_POLITY_ALPHA,
  WORLD_MAP_SELECTED_POLITY_ALPHA,
  WORLD_MAP_SETTLEMENT_RADIUS_PX,
  type WorldHistory,
  type WorldMapTerrain,
} from "@agent-town/shared";

const TERRAIN_VIEW = {
  sea: { label: "海", color: "#1b3442" },
  plains: { label: "平地", color: "#7d8c62" },
  forest: { label: "森", color: "#465f4d" },
  hills: { label: "丘陵", color: "#80745e" },
  mountains: { label: "山地", color: "#aaa08d" },
} as const satisfies Readonly<Record<WorldMapTerrain, { label: string; color: string }>>;

export interface WorldMapCellViewModel {
  pos: Position;
  terrain: WorldMapTerrain;
  terrainLabel: string;
  terrainColor: string;
  polityId: string | null;
  polityColor: string | null;
  polityAlpha: number;
}

export interface WorldMapCityViewModel {
  id: string;
  name: string;
  pos: Position;
  polityId: string;
  isCapital: boolean;
  isHighlighted: boolean;
}

export interface WorldMapRouteViewModel {
  id: string;
  from: Position;
  to: Position;
  isHighlighted: boolean;
}

export interface WorldMapViewModel {
  width: number;
  height: number;
  cells: WorldMapCellViewModel[];
  cities: WorldMapCityViewModel[];
  tradeRoutes: WorldMapRouteViewModel[];
  settlement: {
    pos: Position;
    label: "現在地";
  };
  selectedPolityId: string | null;
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function cellAlpha(polityId: string | null, selectedPolityId: string | null): number {
  if (polityId === null) return 0;
  return polityId === selectedPolityId ? WORLD_MAP_SELECTED_POLITY_ALPHA : WORLD_MAP_POLITY_ALPHA;
}

function buildCells(
  history: WorldHistory,
  selectedPolityId: string | null,
): WorldMapCellViewModel[] {
  const { width } = history.worldMap;
  const polityColors = new Map(
    history.polities.map(({ id, color }) => [id, hexColor(color)] as const),
  );
  return history.worldMap.cells.map(({ terrain, polityId }, index) => ({
    pos: { x: index % width, y: Math.floor(index / width) },
    terrain,
    terrainLabel: TERRAIN_VIEW[terrain].label,
    terrainColor: TERRAIN_VIEW[terrain].color,
    polityId,
    polityColor: polityId === null ? null : (polityColors.get(polityId) ?? null),
    polityAlpha: cellAlpha(polityId, selectedPolityId),
  }));
}

function buildCities(
  history: WorldHistory,
  selectedPolityId: string | null,
): WorldMapCityViewModel[] {
  return history.worldMap.cities.map(({ id, name, pos, polityId, isCapital }) => ({
    id,
    name,
    pos,
    polityId,
    isCapital,
    isHighlighted: polityId === selectedPolityId,
  }));
}

function buildRoutes(
  history: WorldHistory,
  selectedPolityId: string | null,
): WorldMapRouteViewModel[] {
  const cities = new Map(history.worldMap.cities.map((city) => [city.id, city]));
  return history.worldMap.tradeRoutes.flatMap(({ id, cityIds }) => {
    const from = cities.get(cityIds[0]);
    const to = cities.get(cityIds[1]);
    if (from === undefined || to === undefined) return [];
    return [
      {
        id,
        from: from.pos,
        to: to.pos,
        isHighlighted: from.polityId === selectedPolityId || to.polityId === selectedPolityId,
      },
    ];
  });
}

export function buildWorldMapViewModel(
  history: WorldHistory,
  selectedPolityId: string | null,
): WorldMapViewModel {
  return {
    width: history.worldMap.width,
    height: history.worldMap.height,
    cells: buildCells(history, selectedPolityId),
    cities: buildCities(history, selectedPolityId),
    tradeRoutes: buildRoutes(history, selectedPolityId),
    settlement: {
      pos: history.worldMap.settlementFrontierPos,
      label: "現在地",
    },
    selectedPolityId,
  };
}

export function worldMapPositionFromPointer(
  view: WorldMapViewModel,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number,
): Position | null {
  const relativeX = clientX - bounds.left;
  const relativeY = clientY - bounds.top;
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    relativeX < 0 ||
    relativeY < 0 ||
    relativeX >= bounds.width ||
    relativeY >= bounds.height
  ) {
    return null;
  }
  return {
    x: Math.floor((relativeX / bounds.width) * view.width),
    y: Math.floor((relativeY / bounds.height) * view.height),
  };
}

export function polityIdAtWorldMapPosition(view: WorldMapViewModel, pos: Position): string | null {
  if (
    !Number.isInteger(pos.x) ||
    !Number.isInteger(pos.y) ||
    pos.x < 0 ||
    pos.y < 0 ||
    pos.x >= view.width ||
    pos.y >= view.height
  ) {
    return null;
  }
  const cell = view.cells[pos.y * view.width + pos.x];
  return cell?.terrain === "sea" ? null : (cell?.polityId ?? null);
}

function cellOrigin(pos: Position): Position {
  return {
    x: pos.x * WORLD_MAP_CELL_SIZE_PX,
    y: pos.y * WORLD_MAP_CELL_SIZE_PX,
  };
}

function cellCenter(pos: Position): Position {
  const origin = cellOrigin(pos);
  return {
    x: origin.x + WORLD_MAP_CELL_SIZE_PX / 2,
    y: origin.y + WORLD_MAP_CELL_SIZE_PX / 2,
  };
}

function drawTerrain(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  for (const cell of view.cells) {
    const origin = cellOrigin(cell.pos);
    context.fillStyle = cell.terrainColor;
    context.fillRect(origin.x, origin.y, WORLD_MAP_CELL_SIZE_PX, WORLD_MAP_CELL_SIZE_PX);
  }
}

function drawPolityOverlays(
  context: CanvasRenderingContext2D,
  cells: WorldMapCellViewModel[],
): void {
  const previousAlpha = context.globalAlpha;
  for (const cell of cells) {
    if (cell.polityColor === null) continue;
    const origin = cellOrigin(cell.pos);
    context.globalAlpha = cell.polityAlpha;
    context.fillStyle = cell.polityColor;
    context.fillRect(origin.x, origin.y, WORLD_MAP_CELL_SIZE_PX, WORLD_MAP_CELL_SIZE_PX);
  }
  context.globalAlpha = previousAlpha;
}

function drawRoutes(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  context.lineCap = "round";
  for (const route of view.tradeRoutes) {
    const from = cellCenter(route.from);
    const to = cellCenter(route.to);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = route.isHighlighted ? "#fff176" : "#c8b88a";
    context.lineWidth = route.isHighlighted ? 2 : 1;
    context.stroke();
  }
}

function drawCities(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  for (const city of view.cities) {
    const center = cellCenter(city.pos);
    const radius = city.isCapital ? WORLD_MAP_CAPITAL_RADIUS_PX : WORLD_MAP_CITY_RADIUS_PX;
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fillStyle = city.isHighlighted ? "#fff176" : "#f1e8ce";
    context.fill();
    context.strokeStyle = "#141b1e";
    context.lineWidth = 1;
    context.stroke();
  }
}

function drawSettlement(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  const center = cellCenter(view.settlement.pos);
  const radius = WORLD_MAP_SETTLEMENT_RADIUS_PX;
  context.beginPath();
  context.moveTo(center.x, center.y - radius);
  context.lineTo(center.x + radius, center.y);
  context.lineTo(center.x, center.y + radius);
  context.lineTo(center.x - radius, center.y);
  context.closePath();
  context.fillStyle = "#f0d57b";
  context.fill();
  context.strokeStyle = "#141b1e";
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.moveTo(center.x - radius, center.y - radius);
  context.lineTo(center.x + radius, center.y + radius);
  context.moveTo(center.x + radius, center.y - radius);
  context.lineTo(center.x - radius, center.y + radius);
  context.strokeStyle = "#fff8dc";
  context.stroke();

  context.fillStyle = "#fff8dc";
  context.textBaseline = "middle";
  context.fillText(view.settlement.label, center.x + radius * 2, center.y);
}

export function renderWorldMapCanvas(canvas: HTMLCanvasElement, view: WorldMapViewModel): void {
  canvas.width = view.width * WORLD_MAP_CELL_SIZE_PX;
  canvas.height = view.height * WORLD_MAP_CELL_SIZE_PX;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.imageSmoothingEnabled = false;
  drawTerrain(context, view);
  drawPolityOverlays(context, view.cells);
  drawRoutes(context, view);
  drawCities(context, view);
  drawSettlement(context, view);
}
