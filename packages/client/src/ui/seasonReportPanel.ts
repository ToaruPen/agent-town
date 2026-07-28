import type {
  SeasonReportCompletedDirectiveRow,
  SeasonReportMetricRow,
  SeasonReportViewModel,
} from "./seasonReportViewModel.js";
import { element } from "./worldChronicle.js";

export interface SeasonReportPanelController {
  render(view: SeasonReportViewModel | null, generation: number): void;
  /** Player-initiated open/close (the `R` key, the strip's own button) — moves focus to the close button. */
  toggle(): void;
  /**
   * Server-initiated open: hud.md §4.5's famine privilege. Deliberately not routed through `toggle()` —
   * a famine season resolving is not a keypress, and stealing focus out from under a player who is, say,
   * mid-decision in the directive panel would be the pin doing more than "show itself" (§4.5's own
   * phrasing). A no-op once already open, so a second famine entry in the same boundary cannot re-steal
   * focus either.
   */
  pin(): void;
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
const STRIP_TOGGLE_SELECTOR = ".nation-strip__toggle";

/** Which of the two roots holds focus right now, or neither — read before either is rebuilt. */
type FocusOwner = "strip" | "panel" | null;

function focusOwner(roots: SeasonReportRoots): FocusOwner {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (roots.panel.contains(active)) return "panel";
  if (roots.strip.contains(active)) return "strip";
  return null;
}

export function createSeasonReportPanel(roots: SeasonReportRoots): SeasonReportPanelController {
  let renderedKey: string | null = null;
  let open = false;
  let latest: SeasonReportViewModel | null = null;
  // Set by `toggle()` when it opens the panel, consumed by the next `paint()`. Not set by `pin()` —
  // a famine pin is server-initiated, and moving focus for it would be the pin doing more than hud.md
  // §4.5 gives it the right to do ("show itself", not move the caret).
  let focusCloseButtonOnNextPaint = false;

  /** Split out of `paint()` purely to keep its complexity under the linter's limit. */
  const restoreFocusAfterPaint = (restoreTo: FocusOwner): void => {
    if (restoreTo === "panel" && open) {
      roots.panel.querySelector<HTMLButtonElement>(CLOSE_BUTTON_SELECTOR)?.focus();
      return;
    }
    if (restoreTo === "strip") {
      roots.strip.querySelector<HTMLButtonElement>(STRIP_TOGGLE_SELECTOR)?.focus();
    }
  };

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
    // Read before either root is rebuilt below — both are torn down and replaced wholesale on every
    // paint (the strip on every repaint, the panel whenever it is open), which would otherwise eject
    // focus to `<body>` the instant a season resolves while the player is tabbed onto either one
    // (hud.md §4.2's "focus preserved across a boundary re-render", applied to both surfaces here).
    const restoreTo: FocusOwner = focusCloseButtonOnNextPaint ? "panel" : focusOwner(roots);
    focusCloseButtonOnNextPaint = false;
    roots.strip.hidden = false;
    roots.strip.classList.toggle("nation-strip--famine", latest.isFamine);
    roots.strip.replaceChildren(stripBody(latest, open, () => controller.toggle()));
    roots.panel.hidden = !open;
    roots.panel.replaceChildren(...(open ? panelBody(latest, () => controller.close()) : []));
    restoreFocusAfterPaint(restoreTo);
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

    pin(): void {
      if (open) return;
      open = true;
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
