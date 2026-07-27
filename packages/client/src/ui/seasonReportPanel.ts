import type {
  SeasonReportCompletedDirectiveRow,
  SeasonReportMetricRow,
  SeasonReportViewModel,
} from "./seasonReportViewModel.js";
import { element } from "./worldChronicle.js";

export interface SeasonReportPanelController {
  render(view: SeasonReportViewModel | null, generation: number): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

/**
 * The two roots hud.md §4.3 lists separately (`#nation-strip`, `#season-report`) but assigns to one
 * controller: both are driven by the same `SeasonReportViewModel`, and the strip's headline is a
 * compressed view of the same report the panel shows in full — keeping them apart would mean building
 * the same diff-with-reasons twice.
 */
export interface SeasonReportRoots {
  /** Always on screen (hud.md §4.1's decision strip). */
  strip: HTMLElement;
  /** Opened on demand by `R` or by clicking the strip (hud.md §4.2, §4.5). */
  panel: HTMLElement;
}

function deltaClass(direction: SeasonReportMetricRow["direction"]): string {
  return `season-report__delta season-report__delta--${direction}`;
}

/** "変化なし" for a metric with no contributing reasons — hud.md §4.5's own example for 文化's ― row. */
function reasonsText(row: SeasonReportMetricRow): string {
  if (row.reasons.length === 0) return "変化なし";
  return row.reasons.map((reason) => `${reason.label} ${reason.deltaLabel}`).join(" · ");
}

function metricItem(row: SeasonReportMetricRow): HTMLElement {
  const item = element("li", "season-report__metric");
  item.append(
    element("span", "season-report__metric-label", row.label),
    element("span", deltaClass(row.direction), row.deltaLabel),
    element("span", "season-report__reasons", reasonsText(row)),
  );
  return item;
}

function completedDirectiveText(row: SeasonReportCompletedDirectiveRow): string {
  const detail =
    row.issuedLabel === null
      ? row.attributionLabel
      : `${row.attributionLabel} · ${row.issuedLabel}`;
  return `${row.kindLabel}（${detail}）`;
}

/** Omitted rather than shown empty: an empty list here is not the "hole in the layout" the plan guards
 * against — that guarantee is about the six metric rows, which always render below. */
function completedDirectivesSection(
  rows: readonly SeasonReportCompletedDirectiveRow[],
): HTMLElement | null {
  if (rows.length === 0) return null;
  const section = element("p", "season-report__completed");
  section.append(
    element("span", "season-report__completed-label", "完了した施策: "),
    element("span", "season-report__completed-list", rows.map(completedDirectiveText).join("、")),
  );
  return section;
}

function reportHeader(headerLabel: string | null, onClose: () => void): HTMLElement {
  const header = element("div", "season-report__header");
  const title = element("h2", "season-report__title", headerLabel ?? "季報告");
  title.id = "season-report-title";
  const closeButton = element("button", "season-report__close", "閉じる");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "季報告を閉じる");
  closeButton.addEventListener("click", onClose);
  header.append(title, closeButton);
  return header;
}

function panelBody(view: SeasonReportViewModel, onClose: () => void): HTMLElement[] {
  const body: HTMLElement[] = [
    reportHeader(view.headerLabel, onClose),
    element("p", "season-report__headline", view.headline),
  ];
  if (view.heldOrderNote !== null) {
    body.push(element("p", "season-report__held", view.heldOrderNote));
  }
  const metrics = element("ul", "season-report__metrics");
  metrics.append(...view.metrics.map(metricItem));
  body.push(metrics);
  const completed = completedDirectivesSection(view.completedDirectives);
  if (completed !== null) body.push(completed);
  return body;
}

function stripBody(view: SeasonReportViewModel, open: boolean, onToggle: () => void): HTMLElement {
  const inner = element("div", "nation-strip__inner");
  inner.append(element("p", "nation-strip__headline", `前季: ${view.headline}`));
  const button = element("button", "nation-strip__toggle", open ? "決算を閉じる" : "決算を開く R");
  button.type = "button";
  button.setAttribute("aria-controls", "season-report");
  button.setAttribute("aria-expanded", String(open));
  button.addEventListener("click", onToggle);
  inner.append(button);
  return inner;
}

/**
 * The season report: hud.md §4.5's diff with reasons, plus the always-on strip that summarises it
 * (§4.1). Follows `directivePanel.ts`'s `renderedKey` idiom — the report "stays open until closed;
 * replaced in place at each boundary" (§4.2), which the dedupe on `{generation, open, JSON view}` gives
 * for free, the same way it already does for the candidate list.
 */
const CLOSE_BUTTON_SELECTOR = ".season-report__close";

export function createSeasonReportPanel(roots: SeasonReportRoots): SeasonReportPanelController {
  let renderedKey: string | null = null;
  let open = false;
  let latest: SeasonReportViewModel | null = null;
  // Set by `toggle()` when it opens the panel, consumed by the next `paint()`. The panel has no
  // per-row focusable content (hud.md §4.5's rows are read-only diff lines, unlike `directivePanel`'s
  // cards), so the close button is the one focus target worth managing — both moving focus into it on
  // open and, below, keeping focus there across a re-render while the panel stays open.
  let focusCloseButtonOnNextPaint = false;

  const focusIsInsidePanel = (): boolean =>
    document.activeElement instanceof HTMLElement && roots.panel.contains(document.activeElement);

  const paint = (): void => {
    if (latest === null) {
      // Nothing to report on: a spectator holds no nation, and hud.md §4.5 has nothing honest to draw
      // in that case (`waitingForFirstReport` and `isEmpty` both presuppose an actual nation).
      roots.strip.hidden = true;
      roots.strip.replaceChildren();
      roots.panel.hidden = true;
      roots.panel.replaceChildren();
      focusCloseButtonOnNextPaint = false;
      return;
    }
    // Read before `replaceChildren` below tears the old close button out of the DOM — otherwise a
    // season boundary that lands while the player is tabbed onto it would silently eject focus to
    // `<body>` (hud.md §4.2's "focus preserved across a boundary re-render", applied to this panel).
    const restoreFocus = focusCloseButtonOnNextPaint || (open && focusIsInsidePanel());
    focusCloseButtonOnNextPaint = false;
    roots.strip.hidden = false;
    roots.strip.classList.toggle("nation-strip--famine", latest.isFamine);
    roots.strip.replaceChildren(stripBody(latest, open, () => controller.toggle()));
    roots.panel.hidden = !open;
    roots.panel.replaceChildren(...(open ? panelBody(latest, () => controller.close()) : []));
    if (open && restoreFocus) {
      roots.panel.querySelector<HTMLButtonElement>(CLOSE_BUTTON_SELECTOR)?.focus();
    }
  };

  const controller: SeasonReportPanelController = {
    render(view: SeasonReportViewModel | null, generation: number): void {
      const nextKey = `${generation}:${open}:${JSON.stringify(view)}`;
      if (nextKey === renderedKey) return;
      renderedKey = nextKey;
      latest = view;
      paint();
    },

    toggle(): void {
      open = !open;
      if (open) focusCloseButtonOnNextPaint = true;
      renderedKey = null;
      paint();
    },

    close(): void {
      if (!open) return;
      open = false;
      renderedKey = null;
      paint();
    },

    isOpen(): boolean {
      return open;
    },
  };

  return controller;
}
