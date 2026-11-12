import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { placeCspMeta } from "./src/cspMeta";
import { defineConfig, type Plugin } from "vitest/config";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' https://accounts.google.com https://apis.google.com https://*.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com https://*.gstatic.com",
  "img-src 'self' data: https://*.gstatic.com https://*.googleusercontent.com",
  "font-src 'self' https://*.gstatic.com",
  "connect-src 'self' https://accounts.google.com https://www.googleapis.com https://content.googleapis.com https://docs.googleapis.com https://oauth2.googleapis.com https://api.open-meteo.com https://geocoding-api.open-meteo.com",
  "frame-src https://accounts.google.com https://apis.google.com https://docs.google.com https://drive.google.com https://content.googleapis.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function productionExtras(): Plugin {
  return {
    name: "journal-production-extras",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return placeCspMeta(html, CSP);
      },
    },
    closeBundle() {
      const dist = path.resolve("dist");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(path.relative(dist, full).split(path.sep).join("/"));
        }
      };
      walk(dist);
      const precache = ["./", ...files.filter((file) => file !== "sw.js").map((file) => `./${file}`)];
      const swPath = path.join(dist, "sw.js");
      const hash = createHash("sha256").update(precache.join("|")).digest("hex").slice(0, 8);
      const sw = readFileSync(swPath, "utf8")
        .replace('const CACHE = "journal-shell";', `const CACHE = "journal-shell-${hash}";`)
        .replace("const PRECACHE = [];", `const PRECACHE = ${JSON.stringify(precache)};`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  base: "/journal-app/",
  plugins: [productionExtras()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
