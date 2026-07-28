import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      // Vite's default input is `index.html` alone, so `dev-city.html` was built by nobody and existed
      // only under `vite dev`. Naming both makes the resident-scale page a real build artifact, which is
      // what lets it be served as a static site — it drives the scene entirely in the browser and opens
      // no socket, unlike `index.html`, which is inert without the simulation server behind it.
      input: { main: page("index.html"), devCity: page("dev-city.html") },
    },
  },
  server: {
    // Vite's default host is the string "localhost", which Node resolves to a *single* address —
    // on macOS that is `::1`, so the server ends up listening on IPv6 loopback only and
    // `http://127.0.0.1:5173/` is refused outright. Binding `::` listens on both stacks, because
    // Node does not set `ipv6Only`, so an IPv4 client arrives as an IPv4-mapped address.
    // The cost is that the dev server is also reachable from the local network.
    host: "::",
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:8790",
        ws: true,
      },
    },
  },
});
