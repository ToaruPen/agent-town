import type { CulturalValue, HistoryEventKind, Polity, WorldHistory } from "@agent-town/shared";

const CULTURAL_VALUE_LABELS: Record<CulturalValue, string> = {
  commerce: "Commerce",
  faith: "Faith",
  knowledge: "Knowledge",
  kinship: "Kinship",
  mutualAid: "Mutual aid",
  order: "Order",
  stewardship: "Stewardship",
  valor: "Valor",
};

export interface ChronicleOriginViewModel {
  homelandName: string;
  reason: string;
  inheritedValues: string[];
}

export interface ChroniclePolityViewModel {
  id: string;
  name: string;
  adjective: string;
  color: number;
  foundingMyth: string;
  traumaTitles: string[];
  taboo: string;
  ambition: string;
  governance: string;
  values: string[];
  isHomeland: boolean;
}

export interface ChronicleEventViewModel {
  id: string;
  year: number;
  kind: HistoryEventKind;
  title: string;
  summary: string;
  causes: string[];
  polityIds: string[];
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

function rankedValues(polity: Polity): string[] {
  return polity.values
    .toSorted((left, right) => right.weight - left.weight || left.value.localeCompare(right.value))
    .slice(0, 3)
    .map(({ value }) => CULTURAL_VALUE_LABELS[value]);
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
    id: polity.id,
    name: polity.name,
    adjective: polity.adjective,
    color: polity.color,
    foundingMyth: polity.foundingMyth,
    traumaTitles: formativeWounds(history, polity.formativeTraumaEventIds),
    taboo: polity.taboo,
    ambition: polity.ambition,
    governance: polity.governance,
    values: rankedValues(polity),
    isHomeland: history.settlementOrigin?.homelandPolityId === polity.id,
  };
}

function eventView(history: WorldHistory, eventId: string): ChronicleEventViewModel | null {
  const event = history.events.find(({ id }) => id === eventId);
  if (event === undefined) return null;
  return {
    id: event.id,
    year: event.year,
    kind: event.kind,
    title: event.title,
    summary: event.summary,
    causes: eventTitles(history, event.causeIds),
    polityIds: event.polityIds,
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
  return featured;
}

export function buildWorldChronicleViewModel(history: WorldHistory): WorldChronicleViewModel {
  const featured = featuredEventIds(history);
  const sortedEventIds = history.events
    .filter(({ id }) => featured.has(id))
    .toSorted((left, right) => left.year - right.year || left.id.localeCompare(right.id))
    .map(({ id }) => id);

  return {
    eraLabel: `${history.currentYear - history.startYear} years before settlement`,
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
  section.append(element("h3", "world-chronicle__section-title", "The departure"));
  if (origin === null) {
    section.append(element("p", "world-chronicle__empty", "No settlement origin is recorded."));
    return section;
  }
  section.append(
    element("p", "world-chronicle__homeland", origin.homelandName),
    element("p", "world-chronicle__origin-reason", origin.reason),
    labelledText("Inherited values", origin.inheritedValues.join(" · ")),
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
    element("p", "world-chronicle__values", polity.values.join(" · ")),
    labelledText("Founding account", polity.foundingMyth),
    labelledText("Government", polity.governance),
    labelledText("Taboo", polity.taboo),
    labelledText("Ambition", polity.ambition),
  );
  if (polity.traumaTitles.length > 0) {
    card.append(labelledText("Formative wounds", polity.traumaTitles.join(" · ")));
  }
  return card;
}

function politySection(polities: ChroniclePolityViewModel[]): HTMLElement {
  const section = element("section", "world-chronicle__polities");
  section.append(element("h3", "world-chronicle__section-title", "Powers of the old world"));
  const grid = element("div", "world-chronicle__polity-grid");
  grid.append(...polities.map(polityCard));
  section.append(grid);
  return section;
}

function eventItem(event: ChronicleEventViewModel): HTMLElement {
  const item = element("li", `world-chronicle__event world-chronicle__event--${event.kind}`);
  const heading = element("div", "world-chronicle__event-heading");
  heading.append(
    element("time", "world-chronicle__event-year", String(event.year)),
    element("h4", "world-chronicle__event-title", event.title),
  );
  item.append(heading, element("p", "world-chronicle__event-summary", event.summary));
  if (event.causes.length > 0) item.append(labelledText("Caused by", event.causes.join(" · ")));
  return item;
}

function eventSection(events: ChronicleEventViewModel[]): HTMLElement {
  const section = element("section", "world-chronicle__timeline");
  section.append(element("h3", "world-chronicle__section-title", "Recorded centuries"));
  const list = element("ol", "world-chronicle__events");
  list.append(...events.map(eventItem));
  section.append(list);
  return section;
}

interface ChronicleHeader {
  header: HTMLElement;
  closeButton: HTMLButtonElement;
}

function chronicleHeader(view: WorldChronicleViewModel, onClose: () => void): ChronicleHeader {
  const header = element("header", "world-chronicle__header");
  const title = element("h2", "world-chronicle__title", "Frontier chronicle");
  title.id = "world-chronicle-title";
  const close = element("button", "world-chronicle__close", "Close");
  close.type = "button";
  close.addEventListener("click", onClose);
  header.append(title, element("p", "world-chronicle__era", view.eraLabel), close);
  return { header, closeButton: close };
}

function renderChronicle(
  root: HTMLElement,
  view: WorldChronicleViewModel,
  onClose: () => void,
): HTMLButtonElement {
  const { header, closeButton } = chronicleHeader(view, onClose);
  root.replaceChildren(
    header,
    originSection(view.origin),
    politySection(view.polities),
    eventSection(view.events),
  );
  return closeButton;
}

export function createWorldChronicle(
  root: HTMLElement,
  onClose: () => void,
  returnFocus?: HTMLElement,
): WorldChronicleController {
  return {
    show(history: WorldHistory): void {
      const closeButton = renderChronicle(root, buildWorldChronicleViewModel(history), onClose);
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
