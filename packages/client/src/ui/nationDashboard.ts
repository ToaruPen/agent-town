import type {
  NationActiveDirectiveRow,
  NationDashboardViewModel,
  NationMetricRow,
} from "./nationDashboardViewModel.js";
import { element } from "./nationDom.js";

export interface NationDashboardController {
  render(view: NationDashboardViewModel | null, generation: number): void;
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

function dashboardBody(view: NationDashboardViewModel): HTMLElement[] {
  const heading = element("h2", "nation-dashboard__name", view.name);
  if (view.isPlayer) heading.append(element("span", "nation-dashboard__own", "自国"));
  const metrics = element("ul", "nation-dashboard__metrics");
  metrics.append(...view.metrics.map(metricRow));

  const body = [heading, metrics, directiveSection(view)];
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
export function createNationDashboard(root: HTMLElement): NationDashboardController {
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
      root.replaceChildren(...dashboardBody(view));
    },
  };
}
