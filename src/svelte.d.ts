// Lets TypeScript files import the schedule's Svelte components.
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<any>;
  export default component;
}

declare module "*.css?inline" {
  const css: string;
  export default css;
}
