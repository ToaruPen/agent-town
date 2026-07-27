import { Application, Assets, TextureStyle } from "pixi.js";

import { SPRITE_PATHS } from "./render/sprites.js";

TextureStyle.defaultOptions.scaleMode = "nearest";
await Assets.load([...SPRITE_PATHS]);

const app = new Application();
await app.init({
  background: 0x1d2428,
  resizeTo: window,
});

document.body.appendChild(app.canvas);
