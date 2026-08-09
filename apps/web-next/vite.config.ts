import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// El build sale a dist/ y lo sirve el mismo proceso Node de apps/api.
// En desarrollo, /api se proxea al backend real: nunca hay datos simulados
// en el navegador, ni siquiera durante el desarrollo.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.API_URL || "http://localhost:8081", changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: true },
});
