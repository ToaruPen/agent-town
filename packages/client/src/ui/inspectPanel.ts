import type { AgentState, AgentTask, WorldState } from "@agent-town/shared";

import { activityLabel, taskLabel } from "./displayText.js";
import { buildProviderBadge, type ProviderBadge } from "./providerBadge.js";
import { buildSocietyViewModel, type SocietyViewModel } from "./societyViewModel.js";
import {
  buildFacilityViewModel,
  buildTrailViewModel,
  type FacilityInspectPanelViewModel,
  type TrailInspectPanelViewModel,
} from "./spatialViewModel.js";
import { buildNeedsViewModel, type NeedViewModel } from "./survivalViewModel.js";

export const THOUGHT_BUBBLE_DURATION_MS = 6_000;
export const THOUGHT_BUBBLE_MAX_CHARS = 40;

export interface ThoughtBubble {
  text: string;
  expiresAt: number;
}

export interface ThoughtBubbleSchedule {
  observedThoughts: ReadonlyMap<string, string | null>;
  bubbles: ReadonlyMap<string, ThoughtBubble>;
}

export interface InspectTaskViewModel {
  kind: AgentTask["kind"];
  label: string;
  target: string | null;
}

export type InspectTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "facility"; facilityId: string }
  | { kind: "trail"; tileIndex: number };

export interface AgentInspectPanelViewModel {
  kind: "agent";
  name: string;
  providerBadge: ProviderBadge;
  activityKind: AgentState["activity"]["kind"];
  activityLabel: string;
  tasks: InspectTaskViewModel[];
  needs: NeedViewModel[];
  foodSecurity: string;
  rationStrain: string;
  society: SocietyViewModel;
  lastThought: string | null;
}

export type InspectPanelViewModel =
  | AgentInspectPanelViewModel
  | FacilityInspectPanelViewModel
  | TrailInspectPanelViewModel;

export interface InspectPanelController {
  show(target: InspectTarget, world: WorldState): void;
  close(): void;
}

function formatPosition(position: { x: number; y: number }): string {
  return `(${position.x}, ${position.y})`;
}

function taskTarget(task: AgentTask): string | null {
  if (task.kind === "moveTo") return formatPosition(task.dest);
  if (task.kind === "gather") return formatPosition(task.target);
  if (task.kind === "forage") return formatPosition(task.target);
  if (task.kind === "build") return formatPosition(task.pos);
  return null;
}

export function buildAgentInspectPanelViewModel(
  agent: AgentState,
  world: WorldState,
): AgentInspectPanelViewModel {
  return {
    kind: "agent",
    name: agent.name,
    providerBadge: buildProviderBadge(agent),
    activityKind: agent.activity.kind,
    activityLabel: activityLabel(agent.activity.kind),
    tasks: agent.tasks.map((task) => ({
      kind: task.kind,
      label: taskLabel(task.kind),
      target: taskTarget(task),
    })),
    needs: buildNeedsViewModel(agent),
    foodSecurity: `${Math.round(agent.desires.foodSecurity * 100)}%`,
    rationStrain: `${Math.round(agent.rationStrain * 100)}%`,
    society: buildSocietyViewModel(world),
    lastThought: agent.lastThought,
  };
}

export function resolveInspectPanelViewModel(
  target: InspectTarget,
  world: WorldState,
): InspectPanelViewModel | null {
  if (target.kind === "facility") return buildFacilityViewModel(world, target.facilityId);
  if (target.kind === "trail") return buildTrailViewModel(world, target.tileIndex);
  const agent = world.agents.find(({ id }) => id === target.agentId);
  return agent === undefined ? null : buildAgentInspectPanelViewModel(agent, world);
}

export function createThoughtBubbleSchedule(): ThoughtBubbleSchedule {
  return { observedThoughts: new Map(), bubbles: new Map() };
}

function thoughtExcerpt(thought: string): string {
  const characters = [...thought];
  if (characters.length <= THOUGHT_BUBBLE_MAX_CHARS) return thought;
  return `${characters.slice(0, THOUGHT_BUBBLE_MAX_CHARS).join("")}…`;
}

export function updateThoughtBubbleSchedule(
  schedule: ThoughtBubbleSchedule,
  agents: AgentState[],
  now: number,
): ThoughtBubbleSchedule {
  const observedThoughts = new Map<string, string | null>();
  const bubbles = new Map<string, ThoughtBubble>();

  for (const agent of agents) {
    const previousThought = schedule.observedThoughts.get(agent.id);
    const existingBubble = schedule.bubbles.get(agent.id);
    observedThoughts.set(agent.id, agent.lastThought);

    if (existingBubble !== undefined && existingBubble.expiresAt > now) {
      bubbles.set(agent.id, existingBubble);
    }
    if (
      schedule.observedThoughts.has(agent.id) &&
      agent.lastThought !== null &&
      agent.lastThought !== previousThought
    ) {
      bubbles.set(agent.id, {
        text: thoughtExcerpt(agent.lastThought),
        expiresAt: now + THOUGHT_BUBBLE_DURATION_MS,
      });
    }
  }

  return { observedThoughts, bubbles };
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createTaskList(tasks: InspectTaskViewModel[]): HTMLElement {
  if (tasks.length === 0) {
    return createElement("p", "inspect-panel__empty", "予定された行動はありません。");
  }

  const list = createElement("ol", "inspect-panel__tasks");
  for (const task of tasks) {
    const target = task.target === null ? "" : ` ${task.target}`;
    list.append(createElement("li", "inspect-panel__task", `${task.label}${target}`));
  }
  return list;
}

function createNeedsList(needs: NeedViewModel[]): HTMLElement {
  const list = createElement("div", "inspect-panel__needs");
  for (const need of needs) {
    const row = createElement("div", `inspect-panel__need inspect-panel__need--${need.kind}`);
    const label = createElement("span", "inspect-panel__need-label", need.label);
    const meter = createElement("progress", "inspect-panel__need-meter");
    meter.max = need.max;
    meter.value = need.value;
    meter.setAttribute("aria-label", need.label);
    meter.setAttribute("aria-valuetext", `最大${need.max}中${need.valueLabel}`);
    const value = createElement("span", "inspect-panel__need-value", need.valueLabel);
    row.append(label, meter, value);
    list.append(row);
  }
  return list;
}

function createCollectiveList(collectives: SocietyViewModel["collectives"]): HTMLElement {
  if (collectives.length === 0) {
    return createElement("p", "inspect-panel__empty", "結成された集団はありません。");
  }

  const list = createElement("ul", "inspect-panel__society-list");
  for (const collective of collectives) {
    const item = createElement("li", "inspect-panel__society-row");
    const name = createElement("h4", "inspect-panel__society-name", collective.name);
    const detail = createElement(
      "p",
      "inspect-panel__society-detail",
      `代表：${collective.representative}・結束：${collective.cohesion}`,
    );
    const supporters = createElement(
      "p",
      "inspect-panel__society-people",
      `支持者：${collective.supporters.join("、")}`,
    );
    item.append(name, detail, supporters);
    list.append(item);
  }
  return list;
}

function createInstitutionList(institutions: SocietyViewModel["institutions"]): HTMLElement {
  if (institutions.length === 0) {
    return createElement("p", "inspect-panel__empty", "成立した制度はありません。");
  }

  const list = createElement("ul", "inspect-panel__society-list");
  for (const institution of institutions) {
    const item = createElement("li", "inspect-panel__society-row");
    const name = createElement("h4", "inspect-panel__society-name", institution.name);
    const supporters = createElement(
      "p",
      "inspect-panel__society-people",
      `支持者：${institution.supporters.join("、")}`,
    );
    const opponents = createElement(
      "p",
      "inspect-panel__society-people",
      `反対者：${institution.opponents.join("、")}`,
    );
    item.append(name, supporters, opponents);
    list.append(item);
  }
  return list;
}

function createPanelHeader(viewModel: InspectPanelViewModel, onClose: () => void): HTMLElement {
  const header = createElement("header", "inspect-panel__header");
  const name = createElement("h2", "inspect-panel__name", viewModel.name);
  name.id = "inspect-panel-name";
  const closeButton = createElement("button", "inspect-panel__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "観察パネルを閉じる");
  closeButton.addEventListener("click", onClose);
  header.append(name);
  if (viewModel.kind === "agent") {
    header.append(
      createElement(
        "span",
        `inspect-panel__badge inspect-panel__badge--${viewModel.providerBadge.tone}`,
        viewModel.providerBadge.label,
      ),
    );
  }
  header.append(closeButton);
  return header;
}

function section(title: string, ...content: HTMLElement[]): HTMLElement[] {
  return [createElement("h3", "inspect-panel__section-title", title), ...content];
}

function textLine(text: string): HTMLElement {
  return createElement("p", "inspect-panel__activity", text);
}

function textList(items: string[], emptyText: string): HTMLElement {
  if (items.length === 0) return createElement("p", "inspect-panel__empty", emptyText);
  const list = createElement("ul", "inspect-panel__tasks");
  for (const item of items) list.append(createElement("li", "inspect-panel__task", item));
  return list;
}

function renderAgentPanel(
  root: HTMLElement,
  viewModel: AgentInspectPanelViewModel,
  onClose: () => void,
): void {
  const thought = createElement(
    "blockquote",
    "inspect-panel__thought",
    viewModel.lastThought ?? "思考の記録なし。",
  );
  root.replaceChildren(
    createPanelHeader(viewModel, onClose),
    ...section("状態", createNeedsList(viewModel.needs)),
    ...section(
      "食料安定への関心",
      createElement("p", "inspect-panel__food-security", viewModel.foodSecurity),
    ),
    ...section(
      "配給疲弊",
      createElement("p", "inspect-panel__food-security", viewModel.rationStrain),
    ),
    ...section("集団", createCollectiveList(viewModel.society.collectives)),
    ...section("制度", createInstitutionList(viewModel.society.institutions)),
    ...section("現在の行動", textLine(viewModel.activityLabel)),
    ...section("予定", createTaskList(viewModel.tasks)),
    ...section("直前の思考", thought),
  );
}

function renderFacilityPanel(
  root: HTMLElement,
  viewModel: FacilityInspectPanelViewModel,
  onClose: () => void,
): void {
  const status = [viewModel.status];
  if (viewModel.blockReason !== null) status.push(`理由：${viewModel.blockReason}`);
  root.replaceChildren(
    createPanelHeader(viewModel, onClose),
    ...section("成立した制度", textLine(viewModel.foundedBy)),
    ...section(
      "支持と反対",
      textLine(`支持者：${viewModel.supporters.join("、") || "不明"}`),
      textLine(`反対者：${viewModel.opponents.join("、") || "なし"}`),
    ),
    ...section("稼働状態", ...status.map(textLine)),
    ...section("在庫", textLine(viewModel.inventory)),
    ...section("建設", textList(viewModel.construction, "建設記録なし")),
    ...section("敷地を選んだ理由", textList(viewModel.siteReasons, "敷地評価の記録なし")),
    ...section("本日の効果", textList(viewModel.effects, "本日の効果なし")),
    ...section("本日の負担", textList(viewModel.costs, "本日の負担なし")),
    ...section("本日の利用", textLine(viewModel.visits), textLine(viewModel.maintenance)),
    ...section(
      "由来",
      textLine(`原因となった出来事：${viewModel.provenanceEventTitles.join("、") || "不明"}`),
      textLine(`提案者：${viewModel.proposers.join("、") || "不明"}`),
    ),
    ...section("関連する小道", textLine(`${viewModel.linkedTrailCount}区画`)),
  );
}

function renderTrailPanel(
  root: HTMLElement,
  viewModel: TrailInspectPanelViewModel,
  onClose: () => void,
): void {
  root.replaceChildren(
    createPanelHeader(viewModel, onClose),
    ...section("小道段階", textLine(viewModel.level), textLine(viewModel.wear)),
    ...section("通行", textLine(viewModel.passages), textLine(`主な目的：${viewModel.purpose}`)),
    ...section("形成へ寄与した施設", textList(viewModel.linkedFacilities, "施設との関連なし")),
    ...section("移動への効果", textLine(viewModel.movement)),
    ...section("最後の利用", textLine(viewModel.lastUse)),
  );
}

function renderPanel(
  root: HTMLElement,
  viewModel: InspectPanelViewModel,
  onClose: () => void,
): void {
  if (viewModel.kind === "agent") {
    renderAgentPanel(root, viewModel, onClose);
    return;
  }
  if (viewModel.kind === "facility") {
    renderFacilityPanel(root, viewModel, onClose);
    return;
  }
  renderTrailPanel(root, viewModel, onClose);
}

export function createInspectPanel(root: HTMLElement, onClose: () => void): InspectPanelController {
  function close(): void {
    root.hidden = true;
    root.replaceChildren();
  }

  function show(target: InspectTarget, world: WorldState): void {
    const viewModel = resolveInspectPanelViewModel(target, world);
    if (viewModel === null) {
      close();
      return;
    }
    renderPanel(root, viewModel, onClose);
    root.hidden = false;
  }

  return { show, close };
}
