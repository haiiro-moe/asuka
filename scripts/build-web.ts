/**
 * Build the dashboard SPA the way the server serves it, so the bundle can be checked in CI or by hand.
 *
 * `bun build src/web/app/index.html` on the CLI does not run `bun-plugin-tailwind` (bunfig.toml only
 * configures it for `Bun.serve`), so it ships raw Tailwind source and warns about `@theme`. This script
 * runs `Bun.build` with the plugin instead.
 *
 * Usage: `bun scripts/build-web.ts [outdir]` (default `out/web`, which is gitignored).
 *
 * Exits non-zero when the build fails, or when the built CSS/HTML/JS references an external host
 * (the dashboard must not request fonts or anything else from another origin).
 *
 * @packageDocumentation
 */
import tailwind from "bun-plugin-tailwind";

const outdir = process.argv[2] ?? "out/web";

const result = await Bun.build({
  entrypoints: ["src/web/app/index.html"],
  outdir,
  plugins: [tailwind],
});

for (const log of result.logs) console.log(log.message);
if (!result.success) {
  console.error("web build failed");
  process.exit(1);
}

// CSS and HTML may not reference any other host (the Tailwind licence comment is the one exception). JS bundles
// carry harmless URL strings (React docs links, XML namespaces), so there we only reject font/CDN hosts.
const ALLOWED = ["https://tailwindcss.com"];
const FONT_CDNS = /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/;
const external = /https?:\/\/[^\s"'`)\\]+/g;
const offenders = new Set<string>();
for (const output of result.outputs) {
  const isJs = output.path.endsWith(".js");
  if (!isJs && !/\.(css|html)$/.test(output.path)) continue;
  const text = await output.text();
  for (const url of text.match(external) ?? []) {
    if (isJs ? FONT_CDNS.test(url) : !ALLOWED.some((ok) => url.startsWith(ok))) offenders.add(url);
  }
}
if (offenders.size > 0) {
  console.error("external references in the web build:\n" + [...offenders].join("\n"));
  process.exit(1);
}

console.log(`web build ok: ${result.outputs.length} files in ${outdir}`);
