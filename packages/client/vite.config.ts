import { defineConfig } from "vite";

export default defineConfig({
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
