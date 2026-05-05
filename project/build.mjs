import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const isWatch = process.argv.includes("--watch");

// Copy tracked source assets into project/assets/ for static serving.
// The server mounts project/ at /app/, so assets/f1-car.glb is served at
// /app/assets/f1-car.glb which matches the loader paths in track3d/cars.js.
function copyAssets() {
  const projectDir = dirname(fileURLToPath(import.meta.url));
  const assetsDir = join(projectDir, "assets");
  const sourceAssetsDir = join(projectDir, "..", "assets", "models");
  if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
  const src = join(sourceAssetsDir, "f1-car.glb");
  if (existsSync(src)) {
    cpSync(src, join(assetsDir, "f1-car.glb"));
    console.log("Copied f1-car.glb → assets/");
  } else {
    console.warn("Warning: assets/models/f1-car.glb not found — cars will use fallback primitives.");
  }
  const scSrc = join(sourceAssetsDir, "safety_car.glb");
  if (existsSync(scSrc)) {
    cpSync(scSrc, join(assetsDir, "safety_car.glb"));
    console.log("Copied safety_car.glb → assets/");
  } else {
    console.warn("Warning: assets/models/safety_car.glb not found — safety car will use fallback primitives.");
  }
}

const ctx = await esbuild.context({
  entryPoints: ["src/index.jsx"],
  bundle: true,
  outfile: "dist/bundle.js",
  format: "iife",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  target: ["chrome90", "firefox90", "safari15"],
  // React/ReactDOM are loaded from CDN as globals — no import statements to externalize
  // All files assign to window.XXX explicitly, so the IIFE wrapper
  // doesn't need to export anything. We just need the side-effects.
  footer: {
    js: "// side-effects only — window.DELTA, window.LIVE, etc.",
  },
  minify: !isWatch,
  sourcemap: isWatch,
  logLevel: "info",
});

copyAssets();

if (isWatch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Build complete.");
}
