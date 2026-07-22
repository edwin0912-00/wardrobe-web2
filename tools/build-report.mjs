import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";

const root = resolve(import.meta.dirname, "..");
const mdPath = resolve(root, "docs/ZEELY_MARKET_TECH_REPORT_UA.md");
const htmlPath = resolve(root, "docs/ZEELY_MARKET_TECH_REPORT_UA.html");

function sortTopLevelSections(markdown) {
  const re = /^## (\d+)\. (?!\d)/gm;
  const matches = [...markdown.matchAll(re)];
  if (matches.length === 0) return markdown;

  const prefix = markdown.slice(0, matches[0].index);
  const sections = matches.map((match, index) => ({
    number: Number(match[1]),
    sourceIndex: index,
    text: markdown.slice(
      match.index,
      index + 1 < matches.length ? matches[index + 1].index : markdown.length,
    ).trimEnd(),
  }));

  const unique = new Set(sections.map((section) => section.number));
  if (unique.size !== sections.length) {
    throw new Error("Duplicate top-level numeric section number in report");
  }

  sections.sort((a, b) => a.number - b.number || a.sourceIndex - b.sourceIndex);
  return `${prefix.trimEnd()}\n\n${sections.map((section) => section.text).join("\n\n")}\n`;
}

function stripInlineMarkup(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value, seen) {
  const base = stripInlineMarkup(value)
    .toLocaleLowerCase("uk")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "") || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  const slug = count === 0 ? base : `${base}-${count + 1}`;
  return `s-${slug}`;
}

const original = readFileSync(mdPath, "utf8");
const markdown = sortTopLevelSections(original);
writeFileSync(mdPath, markdown);

const headings = [];
const slugs = new Map();
const headingIds = new Map();
for (const match of markdown.matchAll(/^(#{2,3})\s+(.+)$/gm)) {
  const level = match[1].length;
  const title = match[2].trim();
  const id = slugify(title, slugs);
  headings.push({ level, title: stripInlineMarkup(title), id });
  headingIds.set(`${level}:${title}`, id);
}

marked.setOptions({ gfm: true, breaks: false });
let body = marked.parse(markdown);
body = body
  .replace(/\s+align="(?:left|right|center)"/g, "")
  .replace(/&(?!(?:[A-Za-z][A-Za-z0-9]+|#\d+|#x[0-9A-Fa-f]+);)/g, "&amp;");

const outputSlugs = new Map();
body = body.replace(/<h([2-3])>([\s\S]*?)<\/h\1>/g, (full, level, inner) => {
  const id = slugify(inner, outputSlugs);
  return `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to section">#</a></h${level}>`;
});

const toc = headings
  .map(({ level, title, id }) => `<li class="toc-l${level}"><a href="#${id}">${escapeHtml(title)}</a></li>`)
  .join("\n");

const css = `
:root{--ink:#172033;--muted:#667085;--line:#d9deea;--paper:#fff;--wash:#f5f7fb;--accent:#635bff;--accent2:#14b8a6;--warn:#b54708;--code:#101828}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#edf0f6;color:var(--ink);font:15.5px/1.62 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.page{max-width:1180px;margin:32px auto;background:var(--paper);box-shadow:0 16px 70px #1d29391f}.cover{min-height:86vh;padding:88px 9% 64px;display:flex;flex-direction:column;justify-content:space-between;background:radial-gradient(circle at 88% 12%,#b9fff0 0,transparent 28%),radial-gradient(circle at 15% 85%,#d7d4ff 0,transparent 32%),linear-gradient(145deg,#111827,#252b45);color:#fff}.eyebrow{font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#b8fff3}.cover h1{font-size:clamp(42px,7vw,86px);line-height:.95;letter-spacing:-.055em;max-width:900px;margin:24px 0}.cover p{max-width:740px;color:#d0d5dd;font-size:19px}.cover-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;border-top:1px solid #ffffff2e;padding-top:24px}.cover-meta b{display:block;color:#fff}.cover-meta span{color:#aeb7ca;font-size:13px}.layout{display:grid;grid-template-columns:270px minmax(0,1fr);gap:54px;padding:56px 6% 100px}.toc{position:sticky;top:20px;align-self:start;max-height:calc(100vh - 40px);overflow:auto;padding:22px;border:1px solid var(--line);border-radius:14px;background:var(--wash)}.toc h2{font-size:13px;margin:0 0 14px;text-transform:uppercase;letter-spacing:.12em}.toc ol{padding:0;margin:0;list-style:none}.toc li{margin:7px 0}.toc a{color:#344054;text-decoration:none;font-size:12.5px;line-height:1.3;display:block}.toc a:hover{color:var(--accent)}.toc-l3{padding-left:12px;border-left:2px solid #e4e7ec}.article{min-width:0}.article>h1:first-child,.article>p:nth-child(-n+5),.article>blockquote:first-of-type,.article>hr:first-of-type{display:none}h2{font-size:30px;line-height:1.18;letter-spacing:-.025em;margin:74px 0 22px;padding-top:10px;border-top:3px solid var(--ink)}h3{font-size:21px;line-height:1.3;margin:42px 0 14px}h4{font-size:17px;margin:30px 0 10px}h2 .anchor,h3 .anchor{opacity:0;text-decoration:none;color:var(--accent);font-size:.65em;margin-left:8px}h2:hover .anchor,h3:hover .anchor{opacity:1}p{margin:0 0 15px}a{color:#4f46e5;text-underline-offset:2px}strong{color:#101828}blockquote{margin:24px 0;padding:18px 22px;border-left:4px solid var(--accent);background:#f1f0ff;border-radius:0 10px 10px 0}blockquote p:last-child{margin-bottom:0}hr{border:0;border-top:1px solid var(--line);margin:55px 0}ul,ol{padding-left:24px;margin:10px 0 20px}li{margin:5px 0}code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.88em;background:#eef1f6;padding:.12em .35em;border-radius:4px}pre{overflow:auto;background:var(--code);color:#e6edf7;border-radius:12px;padding:18px 20px;line-height:1.5;box-shadow:inset 0 0 0 1px #ffffff12}pre code{background:none;padding:0;color:inherit}table{border-collapse:separate;border-spacing:0;width:100%;margin:18px 0 28px;font-size:12.5px;line-height:1.42;display:block;overflow:auto;border:1px solid var(--line);border-radius:10px}thead{background:#eaecf5}th{font-weight:700;color:#101828}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-width:105px}tr:last-child td{border-bottom:0}th:last-child,td:last-child{border-right:0}tbody tr:nth-child(even){background:#fafbfc}.footer{padding:30px 6%;border-top:1px solid var(--line);color:var(--muted);font-size:12px;display:flex;justify-content:space-between}
@media(max-width:900px){.cover{min-height:auto;padding:60px 7%}.cover-meta{grid-template-columns:1fr}.layout{display:block;padding:35px 6% 70px}.toc{position:relative;top:auto;max-height:none;margin-bottom:40px}.page{margin:0}.article table{font-size:12px}h2{font-size:26px}}
@media print{@page{size:A4;margin:14mm 13mm 16mm}.page{max-width:none;margin:0;box-shadow:none}.cover{min-height:255mm;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}.layout{display:block;padding:0}.toc{position:relative;max-height:none;page-break-after:always;border:0;padding:0;background:none}.article{font-size:10pt}.article h2{font-size:19pt;page-break-after:avoid}.article h3{font-size:14pt;page-break-after:avoid}.article p,.article li{orphans:3;widows:3}table{font-size:7.6pt;display:table;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}pre,blockquote{page-break-inside:avoid}.footer{display:none}a{color:inherit;text-decoration:none}.anchor{display:none!important}}
`;

const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Zeely market and technical report: reliable cloud image/video pipeline and three implementation variants">
<title>ZEELY — Market &amp; Technical Report</title>
<style>${css}</style>
</head>
<body>
<main class="page">
  <section class="cover">
    <div>
      <div class="eyebrow">Deep research · Production blueprint · 2026</div>
      <h1>ZEELY<br>Market &amp; Technical Report</h1>
      <p>Надійний cloud-only image/video pipeline, аналіз конкурентів, alternatives to Higgsfield і три варіанти реалізації.</p>
    </div>
    <div class="cover-meta">
      <div><span>Рекомендація</span><b>API-native dual-provider</b></div>
      <div><span>Core pattern</span><b>Agent plans · Graph executes</b></div>
      <div><span>Audit date</span><b>19 July 2026</b></div>
    </div>
  </section>
  <section class="layout">
    <nav class="toc" aria-label="Зміст"><h2>Зміст</h2><ol>${toc}</ol></nav>
    <article class="article">${body}</article>
  </section>
  <footer class="footer"><span>ZEELY · Deep research &amp; production blueprint</span><span>Version 1.0 · 19.07.2026</span></footer>
</main>
</body>
</html>`;

writeFileSync(htmlPath, html);
console.log(`Built ${htmlPath}`);
