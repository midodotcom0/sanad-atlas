import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Dasselbe `@`-Kuerzel wie tsconfig.json und Next. Ohne diesen Eintrag laesst
  // sich keine Komponente testen, die es benutzt -- und dann weichen Tests auf
  // relative Pfade aus, waehrend der Produktivcode das Kuerzel verwendet.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"] },
});
