import type { AgentState, AgentTask } from "@agent-town/shared";

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
  target: string | null;
}

export interface InspectPanelViewModel {
  name: string;
  planSource: AgentState["planSource"];
  activityKind: AgentState["activity"]["kind"];
  tasks: InspectTaskViewModel[];
  lastThought: string | null;
}

export interface InspectPanelController {
  show(agent: AgentState): void;
  close(): void;
}

function formatPosition(position: { x: number; y: number }): string {
  return `(${position.x}, ${position.y})`;
}

function taskTarget(task: AgentTask): string | null {
  if (task.kind === "moveTo") return formatPosition(task.dest);
  if (task.kind === "gather") return formatPosition(task.target);
  return null;
}

export function buildInspectPanelViewModel(agent: AgentState): InspectPanelViewModel {
  return {
    name: agent.name,
    planSource: agent.planSource,
    activityKind: agent.activity.kind,
    tasks: agent.tasks.map((task) => ({ kind: task.kind, target: taskTarget(task) })),
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
  if (tasks.length === 0) return createElement("p", "inspect-panel__empty", "No queued tasks.");

  const list = createElement("ol", "inspect-panel__tasks");
  for (const task of tasks) {
    const target = task.target === null ? "" : ` ${task.target}`;
    list.append(createElement("li", "inspect-panel__task", `${task.kind}${target}`));
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
    `inspect-panel__badge inspect-panel__badge--${viewModel.planSource}`,
    viewModel.planSource,
  );
  const closeButton = createElement("button", "inspect-panel__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close observation panel");
  closeButton.addEventListener("click", onClose);
  header.append(name, badge, closeButton);

  const activityHeading = createElement("h3", "inspect-panel__section-title", "Current activity");
  const activity = createElement("p", "inspect-panel__activity", viewModel.activityKind);
  const queueHeading = createElement("h3", "inspect-panel__section-title", "Task queue");
  const thoughtHeading = createElement("h3", "inspect-panel__section-title", "Last thought");
  const thought = createElement(
    "blockquote",
    "inspect-panel__thought",
    viewModel.lastThought ?? "No thought recorded.",
  );

  root.replaceChildren(
    header,
    activityHeading,
    activity,
    queueHeading,
    createTaskList(viewModel.tasks),
    thoughtHeading,
    thought,
  );
}

export function createInspectPanel(root: HTMLElement, onClose: () => void): InspectPanelController {
  function show(agent: AgentState): void {
    renderPanel(root, buildInspectPanelViewModel(agent), onClose);
    root.hidden = false;
  }

  function close(): void {
    root.hidden = true;
    root.replaceChildren();
  }

  return { show, close };
}
