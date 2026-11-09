import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { devApi } from "./dev-api-plugin";

export default defineConfig(({ mode }) => {
  // Expose server-only secrets (no VITE_ prefix) to the local API handlers.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  // Svelte compiles the schedule screens (src/schedule/), which are loaded only when a schedule opens.
  return { plugins: [devApi(), svelte()] };
});
