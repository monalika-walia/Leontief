import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Stellar SDK and wallets-kit pull in Buffer/global; provide the shims.
export default defineConfig({
  plugins: [react()],
  define: { global: "globalThis" },
  optimizeDeps: { esbuildOptions: { define: { global: "globalThis" } } },
  server: { host: true, port: 5173 },
});
