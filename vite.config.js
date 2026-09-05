import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ner-smart-logistics/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
});
