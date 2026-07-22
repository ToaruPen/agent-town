import {
  type Container,
  type FederatedPointerEvent,
  FederatedWheelEvent,
  Rectangle,
} from "pixi.js";

const MIN_FIT_SCALE = 0.5;
const MAX_FIT_SCALE = 4;
const WHEEL_ZOOM_RATE = 0.001;
const LINE_HEIGHT = 16;
const MAX_TAP_DURATION_MS = 300;
const MAX_DOUBLE_TAP_DELAY_MS = 300;
const MAX_TAP_DISTANCE = 12;
const MAX_DOUBLE_TAP_DISTANCE = 24;

interface ScreenPoint {
  x: number;
  y: number;
}

interface ActivePointer {
  current: ScreenPoint;
  start: ScreenPoint;
  startedAt: number;
  canTap: boolean;
}

interface PinchState {
  distance: number;
  midpoint: ScreenPoint;
}

interface TapState {
  at: number;
  position: ScreenPoint;
}

export interface WorldViewport {
  fit(worldWidth: number, worldHeight: number): void;
  resize(width: number, height: number): void;
}

function copyPoint(point: ScreenPoint): ScreenPoint {
  return { x: point.x, y: point.y };
}

function distance(first: ScreenPoint, second: ScreenPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: ScreenPoint, second: ScreenPoint): ScreenPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function getPointerPair(
  pointers: Map<number, ActivePointer>,
): [ActivePointer, ActivePointer] | null {
  const pair = [...pointers.values()].slice(0, 2);
  const first = pair[0];
  const second = pair[1];
  return first === undefined || second === undefined ? null : [first, second];
}

function createPinchState(pointers: Map<number, ActivePointer>): PinchState | null {
  const pair = getPointerPair(pointers);
  if (pair === null) return null;
  const [first, second] = pair;
  return {
    distance: distance(first.current, second.current),
    midpoint: midpoint(first.current, second.current),
  };
}

export function createWorldViewport(
  stage: Container,
  world: Container,
  initialWorldWidth: number,
  initialWorldHeight: number,
  initialViewportWidth: number,
  initialViewportHeight: number,
): WorldViewport {
  const pointers = new Map<number, ActivePointer>();
  let worldWidth = initialWorldWidth;
  let worldHeight = initialWorldHeight;
  let viewportWidth = initialViewportWidth;
  let viewportHeight = initialViewportHeight;
  let fitScale = 1;
  let pinchState: PinchState | null = null;
  let lastTap: TapState | null = null;

  function resetToFit(): void {
    fitScale = Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight);
    world.scale.set(fitScale);
    world.position.set(
      (viewportWidth - worldWidth * fitScale) / 2,
      (viewportHeight - worldHeight * fitScale) / 2,
    );
  }

  function setScaleAround(
    previousAnchor: ScreenPoint,
    nextAnchor: ScreenPoint,
    scale: number,
  ): void {
    const previousScale = world.scale.x;
    const localX = (previousAnchor.x - world.position.x) / previousScale;
    const localY = (previousAnchor.y - world.position.y) / previousScale;
    const nextScale = clamp(scale, fitScale * MIN_FIT_SCALE, fitScale * MAX_FIT_SCALE);
    world.scale.set(nextScale);
    world.position.set(nextAnchor.x - localX * nextScale, nextAnchor.y - localY * nextScale);
  }

  function markPinch(): void {
    for (const pointer of pointers.values()) pointer.canTap = false;
    lastTap = null;
    pinchState = createPinchState(pointers);
  }

  function updatePinch(): void {
    const nextPinch = createPinchState(pointers);
    if (pinchState === null || nextPinch === null || pinchState.distance === 0) {
      pinchState = nextPinch;
      return;
    }
    setScaleAround(
      pinchState.midpoint,
      nextPinch.midpoint,
      world.scale.x * (nextPinch.distance / pinchState.distance),
    );
    pinchState = nextPinch;
  }

  function registerTap(position: ScreenPoint, at: number): void {
    if (
      lastTap !== null &&
      at - lastTap.at >= 0 &&
      at - lastTap.at <= MAX_DOUBLE_TAP_DELAY_MS &&
      distance(lastTap.position, position) <= MAX_DOUBLE_TAP_DISTANCE
    ) {
      resetToFit();
      lastTap = null;
      return;
    }
    lastTap = { at, position };
  }

  function handlePointerDown(event: FederatedPointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const position = copyPoint(event.global);
    pointers.set(event.pointerId, {
      current: position,
      start: position,
      startedAt: event.timeStamp,
      canTap: true,
    });
    if (pointers.size >= 2) markPinch();
  }

  function handlePointerMove(event: FederatedPointerEvent): void {
    const pointer = pointers.get(event.pointerId);
    if (pointer === undefined) return;
    const previous = pointer.current;
    pointer.current = copyPoint(event.global);
    if (distance(pointer.start, pointer.current) > MAX_TAP_DISTANCE) {
      pointer.canTap = false;
      lastTap = null;
    }
    if (pointers.size >= 2) {
      for (const activePointer of pointers.values()) activePointer.canTap = false;
      updatePinch();
      return;
    }
    world.position.x += pointer.current.x - previous.x;
    world.position.y += pointer.current.y - previous.y;
  }

  function endPointer(event: FederatedPointerEvent, allowTap: boolean): void {
    const pointer = pointers.get(event.pointerId);
    if (pointer === undefined) return;
    const position = copyPoint(event.global);
    const elapsed = event.timeStamp - pointer.startedAt;
    const wasTap =
      allowTap &&
      pointers.size === 1 &&
      pointer.canTap &&
      elapsed >= 0 &&
      elapsed <= MAX_TAP_DURATION_MS &&
      distance(pointer.start, position) <= MAX_TAP_DISTANCE;
    pointers.delete(event.pointerId);
    pinchState = pointers.size >= 2 ? createPinchState(pointers) : null;
    if (wasTap) registerTap(position, event.timeStamp);
  }

  function handleWheel(event: FederatedWheelEvent): void {
    lastTap = null;
    const deltaMultiplier =
      event.deltaMode === FederatedWheelEvent.DOM_DELTA_LINE
        ? LINE_HEIGHT
        : event.deltaMode === FederatedWheelEvent.DOM_DELTA_PAGE
          ? viewportHeight
          : 1;
    const nextScale = world.scale.x * Math.exp(-event.deltaY * deltaMultiplier * WHEEL_ZOOM_RATE);
    setScaleAround(event.global, event.global, nextScale);
  }

  function fit(nextWorldWidth: number, nextWorldHeight: number): void {
    worldWidth = nextWorldWidth;
    worldHeight = nextWorldHeight;
    lastTap = null;
    resetToFit();
  }

  function resize(width: number, height: number): void {
    viewportWidth = width;
    viewportHeight = height;
    stage.hitArea = new Rectangle(0, 0, width, height);
    lastTap = null;
    resetToFit();
  }

  stage.eventMode = "static";
  stage.on("pointerdown", handlePointerDown);
  stage.on("globalpointermove", handlePointerMove);
  stage.on("pointerup", (event) => endPointer(event, true));
  stage.on("pointerupoutside", (event) => endPointer(event, false));
  stage.on("pointercancel", (event) => endPointer(event, false));
  stage.on("wheel", handleWheel);
  resize(initialViewportWidth, initialViewportHeight);

  return { fit, resize };
}
