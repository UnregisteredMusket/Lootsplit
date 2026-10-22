// Lootsplit must never ship the Grok App Builder extension script (or any other
// grok.com / x.ai script). The template injector is disabled with
// VITE_GROK_EXTENSIONS=0 (.grok/app-env.json, wrangler.toml, render.yaml); these
// helpers let the built-asset and live checks prove it stayed off.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GROK_HOST = /(^|\.)(grok\.com|x\.ai)$/i;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi;

/** True for a URL whose host is grok.com or x.ai (or a subdomain of either). */
export function isGrokScriptUrl(url, base = "https://lootsplit.invalid") {
  try {
    return GROK_HOST.test(new URL(url, base).hostname);
  } catch {
    return false;
  }
}

/** Every reference in HTML or a bundle that would load the Grok extension script. */
export function grokScriptReferences(text) {
  const found = [];
  for (const [, src] of String(text).matchAll(SCRIPT_SRC)) {
    if (isGrokScriptUrl(src) || /grok-app-builder/i.test(src)) found.push(src);
  }
  for (const [match] of String(text).matchAll(/grok-app-builder\/extensions\.js/gi)) {
    if (!found.some((src) => src.includes(match))) found.push(match);
  }
  return found;
}

/** Client asset files (JS, CSS, HTML, manifests) under `directory` that reference the script. */
export function grokScriptAssetReferences(directory) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(m?js|css|html?|json|webmanifest)$/i.test(entry.name)) {
        const refs = grokScriptReferences(readFileSync(path, "utf8"));
        if (refs.length) hits.push({ path, refs });
      }
    }
  };
  walk(directory);
  return hits;
}
