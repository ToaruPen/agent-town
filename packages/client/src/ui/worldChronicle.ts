import type { CulturalValue, HistoryEventKind, Polity, WorldHistory } from "@agent-town/shared";

import {
  buildWorldMapViewModel,
  polityIdAtWorldMapPosition,
  renderWorldMapCanvas,
  worldMapPositionFromPointer,
} from "./worldMapView.js";

const CULTURAL_VALUE_LABELS: Record<CulturalValue, string> = {
  commerce: "交易",
  faith: "信仰",
  knowledge: "知識",
  kinship: "血縁",
  mutualAid: "相互扶助",
  order: "秩序",
  stewardship: "保全",
  valor: "武勇",
};

export interface ChronicleOriginViewModel {
  homelandName: string;
  reason: string;
  inheritedValues: string[];
}

export interface ChroniclePolityViewModel {
  name: string;
  color: number;
  foundingMyth: string;
  traumaTitles: string[];
  taboo: string;
  ambition: string;
  governance: string;
  values: ChronicleValueViewModel[];
  isHomeland: boolean;
}

export interface ChronicleValueViewModel {
  label: string;
  strengthenedBy: ChronicleValueCauseViewModel[];
}

export interface ChronicleValueCauseViewModel {
  year: number;
  title: string;
}

export interface ChronicleEventViewModel {
  year: number;
  kind: HistoryEventKind;
  title: string;
  summary: string;
  causes: string[];
}

export interface WorldChronicleViewModel {
  eraLabel: string;
  origin: ChronicleOriginViewModel | null;
  polities: ChroniclePolityViewModel[];
  events: ChronicleEventViewModel[];
}

export interface WorldChronicleController {
  show(history: WorldHistory): void;
  close(): void;
  isOpen(): boolean;
}

function eventTitles(history: WorldHistory, eventIds: string[]): string[] {
  const titles = new Map(history.events.map(({ id, title }) => [id, title]));
  return eventIds.flatMap((id) => {
    const title = titles.get(id);
    return title === undefined ? [] : [title];
  });
}

function strongestValues(polity: Polity) {
  return polity.values
    .toSorted((left, right) => right.weight - left.weight || left.value.localeCompare(right.value))
    .slice(0, 3);
}

function valueCauses(history: WorldHistory, eventIds: string[]): ChronicleValueCauseViewModel[] {
  return eventIds.slice(-2).flatMap((eventId) => {
    const event = history.events.find(({ id }) => id === eventId);
    return event === undefined ? [] : [{ year: event.year, title: event.title }];
  });
}

function rankedValues(history: WorldHistory, polity: Polity): ChronicleValueViewModel[] {
  return strongestValues(polity).map(({ value, changedByEventIds }) => ({
    label: CULTURAL_VALUE_LABELS[value],
    strengthenedBy: valueCauses(history, changedByEventIds),
  }));
}

function formativeWounds(history: WorldHistory, eventIds: string[]): string[] {
  return [...new Set(eventTitles(history, eventIds))].slice(-3);
}

function originView(history: WorldHistory): ChronicleOriginViewModel | null {
  const origin = history.settlementOrigin;
  if (origin === null) return null;
  const homeland = history.polities.find(({ id }) => id === origin.homelandPolityId);
  if (homeland === undefined) return null;
  return {
    homelandName: homeland.name,
    reason: origin.reason,
    inheritedValues: origin.inheritedValues.map((value) => CULTURAL_VALUE_LABELS[value]),
  };
}

function polityView(history: WorldHistory, polity: Polity): ChroniclePolityViewModel {
  return {
    name: polity.name,
    color: polity.color,
    foundingMyth: polity.foundingMyth,
    traumaTitles: formativeWounds(history, polity.formativeTraumaEventIds),
    taboo: polity.taboo,
    ambition: polity.ambition,
    governance: polity.governance,
    values: rankedValues(history, polity),
    isHomeland: history.settlementOrigin?.homelandPolityId === polity.id,
  };
}

function eventView(history: WorldHistory, eventId: string): ChronicleEventViewModel | null {
  const event = history.events.find(({ id }) => id === eventId);
  if (event === undefined) return null;
  return {
    year: event.year,
    kind: event.kind,
    title: event.title,
    summary: event.summary,
    causes: eventTitles(history, event.causeIds),
  };
}

function featuredEventIds(history: WorldHistory): Set<string> {
  const featured = new Set(
    history.events
      .filter(({ kind }) => ["anomaly", "founding", "migration", "war"].includes(kind))
      .map(({ id }) => id),
  );
  const departure = history.events.find(
    ({ id }) => id === history.settlementOrigin?.departureEventId,
  );
  for (const causeId of departure?.causeIds ?? []) featured.add(causeId);
  for (const landmark of history.landmarks) featured.add(landmark.foundedByEventId);
  for (const polity of history.polities) {
    for (const value of strongestValues(polity)) {
      for (const eventId of value.changedByEventIds.slice(-2)) featured.add(eventId);
    }
  }
  return featured;
}

export function buildWorldChronicleViewModel(history: WorldHistory): WorldChronicleViewModel {
  const featured = featuredEventIds(history);
  const sortedEventIds = history.events
    .filter(({ id }) => featured.has(id))
    .toSorted((left, right) => left.year - right.year || left.id.localeCompare(right.id))
    .map(({ id }) => id);

  return {
    eraLabel: `開拓以前の${history.currentYear - history.startYear}年間`,
    origin: originView(history),
    polities: history.polities.map((polity) => polityView(history, polity)),
    events: sortedEventIds.flatMap((id) => {
      const event = eventView(history, id);
      return event === null ? [] : [event];
    }),
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function labelledText(label: string, value: string): HTMLElement {
  const row = element("p", "world-chronicle__detail");
  row.append(
    element("span", "world-chronicle__detail-label", label),
    element("span", "world-chronicle__detail-value", value),
  );
  return row;
}

function originSection(origin: ChronicleOriginViewModel | null): HTMLElement {
  const section = element("section", "world-chronicle__origin");
  section.append(element("h3", "world-chronicle__section-title", "旅立ち"));
  if (origin === null) {
    section.append(element("p", "world-chronicle__empty", "開拓の由来は記録されていません。"));
    return section;
  }
  section.append(
    element("p", "world-chronicle__homeland", origin.homelandName),
    element("p", "world-chronicle__origin-reason", origin.reason),
    labelledText("受け継いだ価値観", origin.inheritedValues.join(" · ")),
  );
  return section;
}

function polityCard(polity: ChroniclePolityViewModel): HTMLElement {
  const card = element(
    "article",
    `world-chronicle__polity${polity.isHomeland ? " world-chronicle__polity--homeland" : ""}`,
  );
  card.style.setProperty("--polity-color", `#${polity.color.toString(16).padStart(6, "0")}`);
  card.append(
    element("h4", "world-chronicle__polity-name", polity.name),
    culturalValueList(polity.values),
    labelledText("建国譚", polity.foundingMyth),
    labelledText("統治", polity.governance),
    labelledText("禁忌", polity.taboo),
    labelledText("悲願", polity.ambition),
  );
  if (polity.traumaTitles.length > 0) {
    card.append(labelledText("刻まれた傷", polity.traumaTitles.join(" · ")));
  }
  return card;
}

function historicalYear(year: number): string {
  return year < 0 ? `−${Math.abs(year)}` : String(year);
}

function valueCauseText(causes: ChronicleValueCauseViewModel[]): string {
  return causes.map(({ year, title }) => `${historicalYear(year)} · ${title}`).join("; ");
}

function culturalValueList(values: ChronicleValueViewModel[]): HTMLElement {
  const list = element("ul", "world-chronicle__values");
  for (const value of values) {
    const item = element("li", "world-chronicle__value");
    item.append(element("span", "world-chronicle__value-label", value.label));
    if (value.strengthenedBy.length > 0) {
      item.append(
        element(
          "span",
          "world-chronicle__value-cause",
          `影響 ${valueCauseText(value.strengthenedBy)}`,
        ),
      );
    }
    list.append(item);
  }
  return list;
}

function politySection(polities: ChroniclePolityViewModel[]): HTMLElement {
  const section = element("section", "world-chronicle__polities");
  section.append(element("h3", "world-chronicle__section-title", "旧世界の勢力"));
  const grid = element("div", "world-chronicle__polity-grid");
  grid.append(...polities.map(polityCard));
  section.append(grid);
  return section;
}

function eventItem(event: ChronicleEventViewModel): HTMLElement {
  const item = element("li", `world-chronicle__event world-chronicle__event--${event.kind}`);
  const heading = element("div", "world-chronicle__event-heading");
  heading.append(
    element("time", "world-chronicle__event-year", `${historicalYear(event.year)}年`),
    element("h4", "world-chronicle__event-title", event.title),
  );
  item.append(heading, element("p", "world-chronicle__event-summary", event.summary));
  if (event.causes.length > 0) item.append(labelledText("原因", event.causes.join(" · ")));
  return item;
}

function eventSection(events: ChronicleEventViewModel[]): HTMLElement {
  const section = element("section", "world-chronicle__timeline");
  section.append(element("h3", "world-chronicle__section-title", "記録された時代"));
  const list = element("ol", "world-chronicle__events");
  list.append(...events.map(eventItem));
  section.append(list);
  return section;
}

function chroniclePanel(view: WorldChronicleViewModel): HTMLElement {
  const panel = element("div", "world-chronicle__chronicle-panel");
  panel.id = "world-chronicle-chronicle-panel";
  panel.hidden = true;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "world-chronicle-chronicle-tab");
  panel.append(originSection(view.origin), politySection(view.polities), eventSection(view.events));
  return panel;
}

interface LegendItem {
  label: string;
  modifier: string;
  symbol: string;
}

function legendList(title: string, items: LegendItem[]): HTMLElement {
  const group = element("section", "world-chronicle__legend-group");
  group.append(element("h4", "world-chronicle__legend-title", title));
  const list = element("ul", "world-chronicle__legend-list");
  for (const item of items) {
    const listItem = element("li", "world-chronicle__legend-item");
    const symbol = element(
      "span",
      `world-chronicle__legend-symbol world-chronicle__legend-symbol--${item.modifier}`,
      item.symbol,
    );
    symbol.setAttribute("aria-hidden", "true");
    listItem.append(symbol, element("span", "world-chronicle__legend-label", item.label));
    list.append(listItem);
  }
  group.append(list);
  return group;
}

function mapLegend(): HTMLElement {
  const legend = element("div", "world-chronicle__map-legend");
  legend.setAttribute("aria-label", "世界地図の凡例");
  legend.append(
    legendList("地形", [
      { label: "海", modifier: "sea", symbol: "■" },
      { label: "平地", modifier: "plains", symbol: "■" },
      { label: "森", modifier: "forest", symbol: "■" },
      { label: "丘陵", modifier: "hills", symbol: "■" },
      { label: "山地", modifier: "mountains", symbol: "■" },
    ]),
    legendList("記号", [
      { label: "首都", modifier: "capital", symbol: "◎" },
      { label: "都市", modifier: "city", symbol: "●" },
      { label: "交易路", modifier: "route", symbol: "━" },
      { label: "現在地", modifier: "settlement", symbol: "◇" },
    ]),
  );
  return legend;
}

function selectionPrompt(): HTMLElement {
  return element("p", "world-chronicle__map-prompt", "地図上の勢力を選択してください。");
}

function selectedPolityViews(
  history: WorldHistory,
  chronicle: WorldChronicleViewModel,
): ReadonlyMap<string, ChroniclePolityViewModel> {
  return new Map(
    history.polities.flatMap((polity, index) => {
      const view = chronicle.polities[index];
      return view === undefined ? [] : [[polity.id, view] as const];
    }),
  );
}

function replaceMapSelection(
  container: HTMLElement,
  polities: ReadonlyMap<string, ChroniclePolityViewModel>,
  selectedPolityId: string | null,
): void {
  const selected = selectedPolityId === null ? undefined : polities.get(selectedPolityId);
  container.replaceChildren(selected === undefined ? selectionPrompt() : polityCard(selected));
}

function mapPanel(history: WorldHistory, chronicle: WorldChronicleViewModel): HTMLElement {
  const panel = element("section", "world-chronicle__map-panel");
  panel.id = "world-chronicle-map-panel";
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "world-chronicle-map-tab");

  const canvasWrapper = element("div", "world-chronicle__map-canvas-wrapper");
  const canvas = element("canvas", "world-chronicle__map-canvas");
  canvas.setAttribute("aria-label", "現存国家、都市、交易路、現在地を示す世界地図");
  canvasWrapper.append(canvas);

  const selection = element("div", "world-chronicle__map-selection");
  const polityViews = selectedPolityViews(history, chronicle);
  let mapView = buildWorldMapViewModel(history, null);
  renderWorldMapCanvas(canvas, mapView);
  replaceMapSelection(selection, polityViews, null);
  canvas.addEventListener("pointerup", (event) => {
    const pos = worldMapPositionFromPointer(
      mapView,
      canvas.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const selectedPolityId = pos === null ? null : polityIdAtWorldMapPosition(mapView, pos);
    mapView = buildWorldMapViewModel(history, selectedPolityId);
    renderWorldMapCanvas(canvas, mapView);
    replaceMapSelection(selection, polityViews, selectedPolityId);
  });

  panel.append(canvasWrapper, mapLegend(), selection);
  return panel;
}

interface ChronicleHeader {
  header: HTMLElement;
  closeButton: HTMLButtonElement;
}

function chronicleHeader(view: WorldChronicleViewModel, onClose: () => void): ChronicleHeader {
  const header = element("header", "world-chronicle__header");
  const title = element("h2", "world-chronicle__title", "辺境年代記");
  title.id = "world-chronicle-title";
  const close = element("button", "world-chronicle__close", "閉じる");
  close.type = "button";
  close.addEventListener("click", onClose);
  header.append(title, element("p", "world-chronicle__era", view.eraLabel), close);
  return { header, closeButton: close };
}

interface ChronicleTabs {
  tabList: HTMLElement;
  mapTab: HTMLButtonElement;
  chronicleTab: HTMLButtonElement;
}

function chronicleTabs(): ChronicleTabs {
  const tabList = element("div", "world-chronicle__tabs");
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "旧世界の表示");

  const mapTab = element("button", "world-chronicle__tab world-chronicle__tab--map", "世界地図");
  mapTab.id = "world-chronicle-map-tab";
  mapTab.type = "button";
  mapTab.setAttribute("role", "tab");
  mapTab.setAttribute("aria-selected", "true");
  mapTab.setAttribute("aria-controls", "world-chronicle-map-panel");

  const chronicleTab = element(
    "button",
    "world-chronicle__tab world-chronicle__tab--chronicle",
    "年代記",
  );
  chronicleTab.id = "world-chronicle-chronicle-tab";
  chronicleTab.type = "button";
  chronicleTab.setAttribute("role", "tab");
  chronicleTab.setAttribute("aria-selected", "false");
  chronicleTab.setAttribute("aria-controls", "world-chronicle-chronicle-panel");

  tabList.append(mapTab, chronicleTab);
  return { tabList, mapTab, chronicleTab };
}

function bindTabs(tabs: ChronicleTabs, map: HTMLElement, chronicle: HTMLElement): void {
  const selectMap = (showMap: boolean): void => {
    tabs.mapTab.setAttribute("aria-selected", String(showMap));
    tabs.chronicleTab.setAttribute("aria-selected", String(!showMap));
    map.hidden = !showMap;
    chronicle.hidden = showMap;
  };
  tabs.mapTab.addEventListener("click", () => selectMap(true));
  tabs.chronicleTab.addEventListener("click", () => selectMap(false));
}

function renderChronicle(
  root: HTMLElement,
  history: WorldHistory,
  onClose: () => void,
): HTMLButtonElement {
  const view = buildWorldChronicleViewModel(history);
  const { header, closeButton } = chronicleHeader(view, onClose);
  const tabs = chronicleTabs();
  const map = mapPanel(history, view);
  const chronicle = chroniclePanel(view);
  bindTabs(tabs, map, chronicle);
  root.replaceChildren(header, tabs.tabList, map, chronicle);
  return closeButton;
}

export function createWorldChronicle(
  root: HTMLElement,
  onClose: () => void,
  returnFocus?: HTMLElement,
): WorldChronicleController {
  return {
    show(history: WorldHistory): void {
      const closeButton = renderChronicle(root, history, onClose);
      root.hidden = false;
      closeButton.focus();
    },
    close(): void {
      const wasOpen = !root.hidden;
      root.hidden = true;
      root.replaceChildren();
      if (wasOpen) returnFocus?.focus();
    },
    isOpen(): boolean {
      return !root.hidden;
    },
  };
}

export function bindWorldChronicleEscape(
  controller: WorldChronicleController,
  onEscape: () => void,
): () => void {
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !controller.isOpen()) return;
    event.preventDefault();
    onEscape();
  };
  document.addEventListener("keydown", handleKeydown);
  return () => document.removeEventListener("keydown", handleKeydown);
}
