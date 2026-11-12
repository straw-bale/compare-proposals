import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

// pdf.js's image decoders (wasm), standard fonts and character maps, served at /pdfjs/ from the pinned pdfjs-dist
// package: in development from node_modules, in the build as copied files. Scanned RFPs (JBIG2/JPEG 2000 images) and
// PDFs without embedded fonts need them to render.
const ROOT = join(process.cwd(), "node_modules", "pdfjs-dist");
const DIRS = ["wasm", "standard_fonts", "cmaps"];
const TYPES: Record<string, string> = { wasm: "application/wasm", js: "text/javascript", pfb: "application/octet-stream", ttf: "font/ttf", bcmap: "application/octet-stream" };

export function pdfjsAssets(): Plugin {
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs/", (req, res, next) => {
        const [dir, file, ...rest] = (req.url ?? "").split("?")[0].replace(/^\//, "").split("/");
        if (!DIRS.includes(dir) || !file || rest.length || !/^[\w.-]+$/.test(file)) return next();
        try {
          const body = readFileSync(join(ROOT, dir, file));
          res.setHeader("content-type", TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream");
          res.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of DIRS)
        for (const file of readdirSync(join(ROOT, dir)))
          if (statSync(join(ROOT, dir, file)).isFile() && !/^LICENSE/.test(file))
            this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${file}`, source: readFileSync(join(ROOT, dir, file)) });
    },
  };
}
