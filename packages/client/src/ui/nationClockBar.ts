import { SPEED_MULTIPLIERS, type SpeedMultiplier } from "@agent-town/shared";

import type { SendClientMessage } from "../net/wsClient.js";
import type { NationClockViewModel } from "./nationClockViewModel.js";
import { setAutoPilotCommand, setSpeedCommand } from "./nationHudState.js";
import { speedLabel } from "./nationText.js";
import { element } from "./worldChronicle.js";

export interface NationClockBarController {
  render(view: NationClockViewModel, speed: SpeedMultiplier): void;
  /**
   * Null until the first `orders` arrives. Kept off `render` on purpose: that one runs up to 10×/s from
   * the countdown, and autopilot changes once a season at most.
   */
  renderAutoPilot(autoPilot: boolean | null): void;
}

/** Key hints on the buttons, so `0`–`8` and `P` are discoverable from the control itself (§3.5). */
const SPEED_KEY_HINTS: Readonly<Record<SpeedMultiplier, string>> = {
  0: "P",
  1: "1",
  2: "2",
  4: "4",
  8: "8",
};

function speedButton(speed: SpeedMultiplier, send: SendClientMessage): HTMLButtonElement {
  const button = element("button", "nation-clock__speed", speedLabel(speed));
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", `速度${speedLabel(speed)}（${SPEED_KEY_HINTS[speed]}）`);
  button.addEventListener("click", () => {
    send(setSpeedCommand(speed));
  });
  return button;
}

/**
 * Handing control back is one action, and this is it — the label says which way it will go, not merely
 * which state the nation is in, because "ON" alone does not tell a player what pressing it does.
 *
 * The pressed state is set from the server's `orders` echo and never from the click, so a toggle that
 * the server has not yet acknowledged keeps showing the truth. At speed 0 that matters: no boundary is
 * coming along to correct an optimistic lamp.
 */
function autoPilotButton(
  readAutoPilot: () => boolean | null,
  send: SendClientMessage,
): HTMLButtonElement {
  const button = element("button", "nation-clock__autopilot");
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    const current = readAutoPilot();
    if (current === null) return;
    send(setAutoPilotCommand(!current));
  });
  return button;
}

function paintAutoPilot(button: HTMLButtonElement, autoPilot: boolean | null): void {
  if (autoPilot === null) {
    button.textContent = "自動運転 同期中";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-label", "自動運転の状態を同期しています");
    return;
  }
  button.removeAttribute("aria-disabled");
  button.textContent = autoPilot ? "自動運転 ●ON" : "自動運転 ○OFF";
  button.setAttribute("aria-pressed", String(autoPilot));
  button.setAttribute(
    "aria-label",
    autoPilot
      ? "自動運転を切る（A）。今は毎季かならず宰相が決めます"
      : "自動運転を入れる（A）。今はあなたの発令だけが実行されます",
  );
}

/**
 * The always-on clock bar.
 *
 * The skeleton is built once and only its text and attributes change afterwards. The countdown
 * re-renders up to 10×/s, and rebuilding the speed buttons at that rate would eject focus from
 * whichever one the player is tabbing through and swallow clicks mid-press.
 */
export function createNationClockBar(
  root: HTMLElement,
  send: SendClientMessage,
): NationClockBarController {
  const headline = element("p", "nation-clock__headline");
  const countdownLabel = element("span", "nation-clock__countdown-label", "次の決算");
  const countdown = element("span", "nation-clock__countdown");
  const progress = element("progress", "nation-clock__progress");
  progress.max = 1;
  progress.value = 0;

  const speeds = new Map<SpeedMultiplier, HTMLButtonElement>();
  const speedGroup = element("div", "nation-clock__speeds");
  speedGroup.setAttribute("role", "group");
  speedGroup.setAttribute("aria-label", "進行速度");
  for (const speed of SPEED_MULTIPLIERS) {
    const button = speedButton(speed, send);
    speeds.set(speed, button);
    speedGroup.append(button);
  }

  let autoPilot: boolean | null = null;
  const autoPilotToggle = autoPilotButton(() => autoPilot, send);
  paintAutoPilot(autoPilotToggle, autoPilot);

  root.replaceChildren(headline, countdownLabel, progress, countdown, speedGroup, autoPilotToggle);

  return {
    render(view: NationClockViewModel, speed: SpeedMultiplier): void {
      headline.textContent = view.headline;
      progress.value = Math.min(Math.max(view.seasonProgress, 0), 1);
      progress.setAttribute(
        "aria-valuetext",
        view.remainingSecondsLabel ?? `残り${view.remainingTicks ?? 0}拍`,
      );
      countdown.textContent = view.paused
        ? `一時停止中 残り${view.remainingTicks ?? 0}拍`
        : (view.remainingSecondsLabel ?? "同期中");
      countdown.classList.toggle("nation-clock__countdown--urgent", view.urgent);
      for (const [candidate, button] of speeds) {
        button.setAttribute("aria-pressed", String(candidate === speed));
      }
    },

    renderAutoPilot(next: boolean | null): void {
      if (next === autoPilot) return;
      autoPilot = next;
      paintAutoPilot(autoPilotToggle, autoPilot);
    },
  };
}
