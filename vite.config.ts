import { defineConfig, loadEnv } from "vite";
import { devApi } from "./dev-api-plugin";

export default defineConfig(({ mode }) => {
  // Expose server-only secrets (no VITE_ prefix) to the local API handlers.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [devApi()] };
});
