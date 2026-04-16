import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: true,
    css: { modules: { classNameStrategy: "non-scoped" } },
    setupFiles: ["tests/setup.ts"],
  },
});
