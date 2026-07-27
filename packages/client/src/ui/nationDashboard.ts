import type { SendClientMessage } from "../net/wsClient.js";
import type {
  NationActiveDirectiveRow,
  NationCommitSlotViewModel,
  NationDashboardViewModel,
  NationMetricRow,
} from "./nationDashboardViewModel.js";
import { cancelDirectiveCommand } from "./nationHudState.js";
import { element } from "./worldChronicle.js";

export interface NationDashboardController {
  render(view: NationDashboardViewModel | null, generation: number): void;
}

export interface NationDashboardActions {
  send: SendClientMessage;
  /** Opens the candidate list. The dashboard names the decision; the panel is where it is made. */
  openDirectives: () => void;
}

function metricRow(metric: NationMetricRow): HTMLElement {
  const row = element("li", "nation-dashboard__metric");
  const delta = element(
    "span",
    `nation-dashboard__delta nation-dashboard__delta--${metric.direction}`,
    metric.deltaLabel,
  );
  row.append(
    element("span", "nation-dashboard__metric-label", metric.label),
    element("span", "nation-dashboard__metric-value", metric.valueLabel),
    delta,
  );
  return row;
}

function directiveRow(directive: NationActiveDirectiveRow): HTMLElement {
  const row = element("li", "nation-dashboard__directive");
  row.append(
    element("span", "nation-dashboard__directive-name", directive.label),
    element("span", "nation-dashboard__directive-progress", directive.progressLabel),
  );
  return row;
}

function directiveSection(view: NationDashboardViewModel): HTMLElement {
  const section = element("section", "nation-dashboard__section");
  section.append(element("h3", "nation-dashboard__section-title", "実行中"));
  if (view.activeDirectives.length === 0) {
    section.append(element("p", "nation-dashboard__empty", "実行中の施策はありません"));
    return section;
  }
  const list = element("ul", "nation-dashboard__directives");
  list.append(...view.activeDirectives.map(directiveRow));
  section.append(list);
  return section;
}

/**
 * The 次の決算 slot: the one place that answers what commits at the next boundary.
 *
 * Never empty and never a prediction — the view model reads the state the server sent. The cancel
 * control appears whenever an order is queued, including while autopilot is holding it, because the
 * server accepts a cancel in that state (measured) and a waiting order the player cannot withdraw
 * would be the worst of both modes.
 */
function commitSlotSection(
  slot: NationCommitSlotViewModel,
  actions: NationDashboardActions,
): HTMLElement {
  const section = element("section", "nation-dashboard__section");
  section.append(element("h3", "nation-dashboard__section-title", "次の決算に commit"));

  const headline = element("p", "nation-dashboard__commit", slot.headline);
  if (slot.emphasis) headline.classList.add("nation-dashboard__commit--idle");
  section.append(headline);

  if (slot.detail !== null) {
    section.append(element("p", "nation-dashboard__commit-detail", slot.detail));
  }

  const controls = element("p", "nation-dashboard__commit-controls");
  const cancelId = slot.cancelDirectiveId;
  if (cancelId !== null) {
    const cancel = element("button", "nation-dashboard__cancel", "取消");
    cancel.type = "button";
    cancel.setAttribute("aria-label", `発令を取り消す（${slot.headline}）`);
    cancel.addEventListener("click", () => {
      actions.send(cancelDirectiveCommand(cancelId));
    });
    controls.append(cancel);
  }
  const open = element("button", "nation-dashboard__choose", "施策を選ぶ（D）");
  open.type = "button";
  open.addEventListener("click", actions.openDirectives);
  controls.append(open);
  section.append(controls);
  return section;
}

function dashboardBody(
  view: NationDashboardViewModel,
  actions: NationDashboardActions,
): HTMLElement[] {
  const heading = element("h2", "nation-dashboard__name", view.name);
  if (view.isPlayer) heading.append(element("span", "nation-dashboard__own", "自国"));
  const metrics = element("ul", "nation-dashboard__metrics");
  metrics.append(...view.metrics.map(metricRow));

  const body = [heading, metrics, directiveSection(view)];
  if (view.isPlayer) body.push(commitSlotSection(view.commitSlot, actions));
  if (view.waitingForFirstReport) {
    body.push(element("p", "nation-dashboard__waiting", "最初の決算を待っています"));
  }
  return body;
}

/**
 * The player's own panel. Rebuilt wholesale when its view model changes, which is once a season rather
 * than once a frame — the `renderedKey` guard is what keeps a 1 Hz clock from touching it at all.
 *
 * `generation` enters the key so a reconnect repaints even when the payload it brings back is
 * byte-identical to what is already on screen; otherwise a stale panel could survive a welcome.
 */
export function createNationDashboard(
  root: HTMLElement,
  actions: NationDashboardActions,
): NationDashboardController {
  let renderedKey: string | null = null;

  return {
    render(view: NationDashboardViewModel | null, generation: number): void {
      const nextKey = `${generation}:${JSON.stringify(view)}`;
      if (nextKey === renderedKey) return;
      renderedKey = nextKey;

      if (view === null) {
        root.replaceChildren(
          element("p", "nation-dashboard__empty", "国を選んでいません（観戦中）"),
        );
        return;
      }
      root.replaceChildren(...dashboardBody(view, actions));
    },
  };
}
