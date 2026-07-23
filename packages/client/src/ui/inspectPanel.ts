import type { AgentState, AgentTask, WorldState } from "@agent-town/shared";

import { activityLabel, taskLabel } from "./displayText.js";
import { buildProviderBadge, type ProviderBadge } from "./providerBadge.js";
import { buildSocietyViewModel, type SocietyViewModel } from "./societyViewModel.js";
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

export interface InspectPanelViewModel {
  name: string;
  providerBadge: ProviderBadge;
  activityKind: AgentState["activity"]["kind"];
  activityLabel: string;
  tasks: InspectTaskViewModel[];
  needs: NeedViewModel[];
  foodSecurity: string;
  society: SocietyViewModel;
  lastThought: string | null;
}

export interface InspectPanelController {
  show(agent: AgentState, world: WorldState): void;
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

export function buildInspectPanelViewModel(
  agent: AgentState,
  world: WorldState,
): InspectPanelViewModel {
  return {
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
    society: buildSocietyViewModel(world),
    lastThought: agent.lastThought,
  };
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

function renderPanel(
  root: HTMLElement,
  viewModel: InspectPanelViewModel,
  onClose: () => void,
): void {
  const header = createElement("header", "inspect-panel__header");
  const name = createElement("h2", "inspect-panel__name", viewModel.name);
  name.id = "inspect-panel-name";
  const badge = createElement(
    "span",
    `inspect-panel__badge inspect-panel__badge--${viewModel.providerBadge.tone}`,
    viewModel.providerBadge.label,
  );
  const closeButton = createElement("button", "inspect-panel__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "観察パネルを閉じる");
  closeButton.addEventListener("click", onClose);
  header.append(name, badge, closeButton);

  const needsHeading = createElement("h3", "inspect-panel__section-title", "状態");
  const foodSecurityHeading = createElement(
    "h3",
    "inspect-panel__section-title",
    "食料安定への関心",
  );
  const foodSecurity = createElement("p", "inspect-panel__food-security", viewModel.foodSecurity);
  const collectivesHeading = createElement("h3", "inspect-panel__section-title", "集団");
  const institutionsHeading = createElement("h3", "inspect-panel__section-title", "制度");
  const activityHeading = createElement("h3", "inspect-panel__section-title", "現在の行動");
  const activity = createElement("p", "inspect-panel__activity", viewModel.activityLabel);
  const queueHeading = createElement("h3", "inspect-panel__section-title", "予定");
  const thoughtHeading = createElement("h3", "inspect-panel__section-title", "直前の思考");
  const thought = createElement(
    "blockquote",
    "inspect-panel__thought",
    viewModel.lastThought ?? "思考の記録なし。",
  );

  root.replaceChildren(
    header,
    needsHeading,
    createNeedsList(viewModel.needs),
    foodSecurityHeading,
    foodSecurity,
    collectivesHeading,
    createCollectiveList(viewModel.society.collectives),
    institutionsHeading,
    createInstitutionList(viewModel.society.institutions),
    activityHeading,
    activity,
    queueHeading,
    createTaskList(viewModel.tasks),
    thoughtHeading,
    thought,
  );
}

export function createInspectPanel(root: HTMLElement, onClose: () => void): InspectPanelController {
  function show(agent: AgentState, world: WorldState): void {
    renderPanel(root, buildInspectPanelViewModel(agent, world), onClose);
    root.hidden = false;
  }

  function close(): void {
    root.hidden = true;
    root.replaceChildren();
  }

  return { show, close };
}
