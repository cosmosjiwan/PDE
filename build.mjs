// Bundles the modular app (index.html + css/ + js/) into a single
// self-contained pde-playground.html that runs directly via file://
// (no server, no ES modules). Run with:  node build.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const R = path.dirname(fileURLToPath(import.meta.url));
const rd = (p) => fs.readFileSync(path.join(R, p), "utf8");

const css = rd("css/style.css");

const eq = rd("js/equations.js")
  .replace(/^export const/m, "const")
  .replace(/^export function/m, "function");

const solver = rd("js/solver.js").replace(/^export class/m, "class");

const main = rd("js/main.js").replace(/^import[^\n]*\n/gm, ""); // drop import lines

const html = rd("index.html")
  // tolerate an optional ?v=... cache-busting query on the asset URLs
  .replace(
    /<link rel="stylesheet" href="css\/style.css[^"]*" \/>/,
    `<style>\n${css}\n</style>`
  )
  .replace(
    /<script type="module" src="js\/main.js[^"]*"><\/script>/,
    `<script>\n${eq}\n\n${solver}\n\n${main}\n</script>`
  );

fs.writeFileSync(path.join(R, "pde-playground.html"), html);
console.log("wrote pde-playground.html,", html.length, "bytes");
