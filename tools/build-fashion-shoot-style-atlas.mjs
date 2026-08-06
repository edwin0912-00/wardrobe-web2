#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FilesystemScenePresetResolver } from '../src/web/scene-resolvers.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(projectRoot, 'docs', 'qa', 'FASHION_SHOOT_STYLE_ATLAS_2026-07-30.html');
const exampleOutput = path.join(projectRoot, 'docs', 'qa', 'FASHION_SHOOT_EXAMPLE_SKYLIGHT_HAZE.html');
const blockingIndex = JSON.parse(await readFile(
  path.join(projectRoot, 'assets', 'editorial-blocking', 'v1', 'index.json'),
  'utf8',
));
const blockingBySlot = new Map(blockingIndex.diagrams.map((entry) => [entry.slot, entry]));
const activeSlots = new Set([
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pretty(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function relativeAsset(filename) {
  return path.relative(path.dirname(output), path.join(projectRoot, filename)).split(path.sep).join('/');
}

const resolver = new FilesystemScenePresetResolver({
  rootDirectory: path.join(projectRoot, 'assets', 'scene-presets'),
  projectRoot,
});
await resolver.initialize();
const catalog = await resolver.listEditorialModes();
const modes = catalog.modes
  // Catalog order is the product's intended order. Do not alphabetize it: its
  // order is also the order in which people encounter the styles in the UI.
  .filter((mode) => mode.mode_id?.startsWith('shoot.') && mode.generation_available);

const styleSections = [];
for (const mode of modes) {
  const mood = JSON.parse(await readFile(
    path.join(projectRoot, 'assets', 'scene-mood-cards', `${mode.mode_id}.json`),
    'utf8',
  ));
  const bible = await resolver.compileEditorialShootBible({
    modeId: mode.mode_id,
    version: mode.version,
  });
  const styleRecord = {
    mode_id: mode.mode_id,
    version: mode.version,
    ui_name_uk: mode.ui_name_uk,
    visual_system: mode.visual_system,
    source_set_status: mode.source_set_status,
    generation_available: mode.generation_available,
    mood_card_sha256: mood.sha256,
    unit_contract: mood.source?.unit_contract ?? null,
    unit_contract_sha256: mood.source?.unit_contract_sha256 ?? null,
  };
  const unitDirectory = path.dirname(mood.source?.unit_contract ?? '');
  const promptAttachments = [
    ['camera_lens', 'composition_anchor'],
    ['blocking', 'negative_reference'],
    ['expression_gaze', 'lighting_anchor'],
    ['garment_behaviour', 'palette_anchor'],
  ].map(([sheet, role]) => ({
    sheet,
    role,
    file: `${unitDirectory}/sheet-${sheet}.png`,
  }));
  const slots = [];
  for (const shot of bible.shots) {
    const diagram = blockingBySlot.get(shot.slot);
    const legacy = !activeSlots.has(shot.slot);
    let pack = null;
    if (!legacy) {
      const reference = await resolver.editorialShotPresetReference({
        modeId: mode.mode_id,
        version: mode.version,
        shotSpec: shot,
      });
      pack = await resolver.resolveScenePreset(reference);
    }
    slots.push({ shot, diagram, legacy, pack });
  }
  const cards = slots.map(({ shot, diagram, legacy, pack }) => {
    const binding = pack?.reference ?? null;
    const diagramFacts = diagram?.drawn_facts ?? null;
    const prompt = pack?.prompt ?? null;
    return `
      <article class="slot ${legacy ? 'legacy' : ''}">
        <div class="slot-head">
          <div><span class="num">${escapeHtml(shot.slot)}</span><h3>${escapeHtml(shot.title)}</h3></div>
          <span class="badge ${legacy ? 'legacy-badge' : 'live-badge'}">${legacy ? 'LEGACY — не генерується' : 'LIVE — входить у 5 кадрів'}</span>
        </div>
        <div class="slot-grid">
          <figure>
            ${diagram ? `<img src="${escapeHtml(relativeAsset(diagram.file))}" alt="Blocking ${escapeHtml(shot.slot)}">` : '<div class="missing">Немає схеми</div>'}
            <figcaption><b>Blocking-схема</b><br><code>${escapeHtml(diagram?.file ?? '—')}</code><br>SHA-256: <code>${escapeHtml(diagram?.sha256 ?? '—')}</code></figcaption>
          </figure>
          <section class="facts">
            <h4>Що схема має право задавати</h4>
            <pre>${pretty(diagramFacts)}</pre>
            <p>Схема задає лише механіку кадру: lens, framing, масштаб, зазор, видимість голови/взуття. Вона <b>не має права</b> змінювати людину, волосся, одяг або середовище.</p>
          </section>
        </div>
        <h4>Кадровий запис</h4>
        <pre>${pretty({
          slot: shot.slot,
          objective: shot.objective,
          pose: shot.pose,
          camera: shot.camera,
          lighting: shot.lighting,
          environment: shot.environment,
          identity_visibility: shot.identity_visibility,
          optical_device: shot.optical_device,
          negative_constraints: shot.negative_constraints,
        })}</pre>
        ${binding ? `
          <h4>Виділений exact binding цього кадру</h4>
          <pre class="binding">${pretty(binding)}</pre>
          <h4>Повний compiled prompt</h4>
          <pre class="prompt">${escapeHtml(prompt)}</pre>
        ` : '<p class="legacy-note">Це legacy validation frame. У новому Fashion Shoot він автоматично скасовується; тому для нього не створюється production binding чи provider prompt.</p>'}
      </article>`;
  }).join('\n');
  styleSections.push(`
    <details class="style" open>
      <summary><span>${escapeHtml(mode.ui_name_uk)}</span><code>${escapeHtml(mode.mode_id)}</code></summary>
      <div class="style-content">
        <div class="style-top">
          <img class="mood" src="${escapeHtml(relativeAsset(mood.file))}" alt="Mood card ${escapeHtml(mode.ui_name_uk)}">
          <section><h2>${escapeHtml(mode.ui_name_uk)}</h2><p><b>Create Universe style:</b> ${escapeHtml(mode.visual_system)}</p><p>Style-pack робить атмосферу, світло, матеріали та оптику. Approved master-look залишається єдиним джерелом людини й речей.</p><h4>Виділений style record</h4><pre class="binding">${pretty(styleRecord)}</pre></section>
        </div>
        <section class="attachments">
          <h4>Фото, прикріплені до prompt-ів цього стилю</h4>
          <p>Ці чотири фото передаються окремими reference-assets до <b>кожного з п’яти</b> кадрів. Вони не є текстом prompt-а і не мають права змінювати людину або її речі.</p>
          <div class="attachment-grid">${promptAttachments.map((asset) => `<figure><img src="${escapeHtml(relativeAsset(asset.file))}" alt="${escapeHtml(asset.sheet)}"><figcaption><b>${escapeHtml(asset.sheet)}</b> → <code>${escapeHtml(asset.role)}</code><br><code>${escapeHtml(asset.file)}</code></figcaption></figure>`).join('')}</div>
        </section>
        ${cards}
      </div>
    </details>`);
}

const html = `<!doctype html>
<html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fashion Shoot — style atlas</title>
<style>
  :root { color-scheme: dark; --bg:#0e1010; --paper:#151918; --line:#303837; --ink:#f1f4ee; --muted:#a7afa9; --lime:#bbff44; --amber:#ffc33f; --red:#ff8b86; }
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 ui-sans-serif,system-ui,sans-serif; } main{max-width:1320px;margin:auto;padding:36px 20px 80px}.eyebrow{color:var(--lime);font-size:12px;font-weight:800;letter-spacing:.13em}h1{font-size:clamp(31px,5vw,62px);line-height:1;margin:10px 0 18px} h2{font-size:25px;margin:0 0 10px} h3{font-size:18px;margin:0} h4{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#cfdbd0;margin:24px 0 8px}p{color:var(--muted);max-width:78ch}.callout{background:#1e251e;border:1px solid #607053;border-radius:14px;padding:16px 18px;margin:20px 0 28px}.callout b{color:var(--lime)} details.style{background:var(--paper);border:1px solid var(--line);border-radius:18px;margin:18px 0;overflow:hidden} summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;font-size:20px;font-weight:750}summary code{font-size:12px;color:var(--lime)}.style-content{padding:0 22px 25px}.style-top{display:grid;grid-template-columns:220px 1fr;gap:24px;align-items:start;padding-bottom:20px;border-bottom:1px solid var(--line)}.mood{width:100%;border-radius:10px;background:#202322}.attachments{padding:14px 0 20px;border-bottom:1px solid var(--line)}.attachment-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.attachment-grid figure{margin:0;background:#0c0d0d;border:1px solid var(--line);border-radius:10px;overflow:hidden}.attachment-grid img{display:block;width:100%;aspect-ratio:1;object-fit:cover}.attachment-grid figcaption{padding:8px;font-size:11px;color:var(--muted)}.slot{padding:28px 0;border-bottom:1px solid var(--line)}.slot:last-child{border:0}.slot.legacy{opacity:.72}.slot-head{display:flex;justify-content:space-between;gap:14px;align-items:center}.slot-head>div{display:flex;gap:10px;align-items:center}.num{font-size:11px;font-weight:900;color:#111;background:var(--lime);padding:4px 7px;border-radius:999px}.badge{font-size:11px;font-weight:850;letter-spacing:.05em;padding:5px 8px;border-radius:999px}.live-badge{background:#233416;color:var(--lime)}.legacy-badge{background:#3a2423;color:var(--red)}.slot-grid{display:grid;grid-template-columns:minmax(260px,480px) 1fr;gap:22px;margin-top:17px}.slot figure{margin:0;background:#0c0d0d;border:1px solid var(--line);border-radius:12px;overflow:hidden}.slot figure img{display:block;width:100%;height:auto}.slot figcaption{padding:10px;font-size:12px;color:var(--muted)}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;background:#0c0e0e;border:1px solid #252c2a;border-radius:10px;padding:13px;color:#d8e1d9;font:12px/1.43 ui-monospace,SFMono-Regular,Menlo,monospace}.binding{border-color:#819b47;background:#192114;box-shadow:inset 4px 0 var(--lime)}.prompt{border-color:#815e22;background:#211b10;box-shadow:inset 4px 0 var(--amber)}code{overflow-wrap:anywhere;color:#dce9c2}.legacy-note{color:var(--red)}@media(max-width:760px){main{padding:24px 12px}.style-content{padding:0 13px 18px}.style-top,.slot-grid{grid-template-columns:1fr}.attachment-grid{grid-template-columns:repeat(2,1fr)}.mood{max-width:260px}.slot-head,summary{align-items:flex-start;flex-direction:column}.badge{align-self:flex-start}}
</style>
<main>
  <div class="eyebrow">BETA · ${modes.length} READY CREATE UNIVERSE STYLES · COMPILED FROM CURRENT SOURCE</div>
  <h1>Fashion Shoot<br>Style Atlas</h1>
  <div class="callout"><b>Як читати:</b> кожен стиль нижче містить п’ять активних кадрів, їхню технічну blocking-схему, кадровий запис, точний content-addressed binding та повний compiled prompt. Prompt не містить персональних даних: під час реального запуску до нього окремо додається immutable approved master-look конкретного користувача. <b>Legacy clean_identity_hero</b> показано лише для прозорості й не генерується при новому Fashion Shoot.</div>
  ${styleSections.join('\n')}
</main>`;

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
const exampleHtml = html.replace(
  `${styleSections.join('\n')}`,
  `<div class="callout"><b>Один конкретний Fashion Shoot:</b> п’ять live-кадрів нижче генеруються одним натисканням. Кожен блок = одна майбутня фотографія, її blocking-схема, exact binding, прикріплені style reference-фото й повний compiled prompt. Шостий legacy блок залишено наприкінці тільки для аудиту старої системи.</div>${styleSections[0]}`,
).replace(
  'BETA · 15 READY CREATE UNIVERSE STYLES · COMPILED FROM CURRENT SOURCE',
  'BETA · ONE CONCRETE FASHION SHOOT · COMPILED FROM CURRENT SOURCE',
).replace('Fashion Shoot<br>Style Atlas', 'Fashion Shoot<br>One example: Skylight Haze');
await writeFile(exampleOutput, exampleHtml, 'utf8');

const sheetWidth = 1160;
const cardWidth = 340;
const cardHeight = 425;
const pad = 25;
const titleHeight = 66;
for (let batchIndex = 0; batchIndex < Math.ceil(modes.length / 5); batchIndex += 1) {
  const batch = modes.slice(batchIndex * 5, batchIndex * 5 + 5);
  const rows = 2;
  const sheetHeight = titleHeight + pad + rows * (cardHeight + 48) + pad;
  const composite = [];
  const title = `<svg width="${sheetWidth}" height="${titleHeight}"><style>.t{fill:#f1f4ee;font:700 25px Arial}.s{fill:#bbff44;font:700 12px Arial;letter-spacing:2px}</style><text class="s" x="25" y="23">CREATE UNIVERSE · FASHION SHOOT</text><text class="t" x="25" y="52">Стилі ${batchIndex * 5 + 1}–${batchIndex * 5 + batch.length} · порядок каталогу</text></svg>`;
  composite.push({ input: Buffer.from(title), top: 0, left: 0 });
  for (const [offset, mode] of batch.entries()) {
    const col = offset % 3;
    const row = Math.floor(offset / 3);
    const x = pad + col * (cardWidth + 45);
    const y = titleHeight + pad + row * (cardHeight + 48);
    const mood = JSON.parse(await readFile(path.join(projectRoot, 'assets', 'scene-mood-cards', `${mode.mode_id}.json`), 'utf8'));
    const label = `<svg width="${cardWidth}" height="42"><style>.n{fill:#f1f4ee;font:700 14px Arial}.i{fill:#a7afa9;font:12px Arial}</style><text class="n" x="0" y="16">${escapeHtml(mode.ui_name_uk)}</text><text class="i" x="0" y="35">${escapeHtml(mode.mode_id)}</text></svg>`;
    composite.push({ input: await sharp(path.join(projectRoot, mood.file)).resize(cardWidth, cardHeight, { fit: 'cover' }).webp().toBuffer(), top: y, left: x });
    composite.push({ input: Buffer.from(label), top: y + cardHeight + 6, left: x });
  }
  const sheet = path.join(projectRoot, 'docs', 'qa', `FASHION_SHOOT_STYLE_ATLAS_CONTACT_SHEET_${String(batchIndex + 1).padStart(2, '0')}.webp`);
  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 4, background: '#0e1010' } })
    .composite(composite)
    .webp({ quality: 91 })
    .toFile(sheet);
}
console.log(JSON.stringify({ output, exampleOutput, styles: modes.length, active_frames: modes.length * activeSlots.size, contact_sheets: 3 }));
