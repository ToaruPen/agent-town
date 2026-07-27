import { SPEED_MULTIPLIERS, type SpeedMultiplier } from "@agent-town/shared";

import type { SendClientMessage } from "../net/wsClient.js";
import type { NationClockViewModel } from "./nationClockViewModel.js";
import { setSpeedCommand } from "./nationHudState.js";
import { speedLabel } from "./nationText.js";
import { element } from "./worldChronicle.js";

export interface NationClockBarController {
  render(view: NationClockViewModel, speed: SpeedMultiplier): void;
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

  root.replaceChildren(headline, countdownLabel, progress, countdown, speedGroup);

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
  };
}
