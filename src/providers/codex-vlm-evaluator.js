import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const DECISIONS = new Set(['PASS', 'RETRY', 'NEEDS_INPUT', 'REJECT']);
const CATEGORIES = new Set(['outerwear', 'top', 'bottom', 'one_piece', 'footwear', 'headwear', 'bag', 'accessory']);

async function defaultCommandRunner(binary, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr, exitCode: 0 });
    });
    // Codex appends piped stdin to an explicit prompt. An unclosed Node pipe
    // therefore makes it wait until timeout; close it immediately.
    child.stdin?.end();
  });
}

function imagePath(value) {
  const artifact = value?.artifact ?? value;
  return typeof artifact?.path === 'string' ? path.resolve(artifact.path) : null;
}

function collectQaImages(evidence = {}) {
  const ordered = [imagePath(evidence.identity), imagePath(evidence.avatar), imagePath(evidence.outfit), imagePath(evidence.candidate)];
  for (const raw of [evidence.source_identity, evidence.source_outfit]) {
    if (typeof raw === 'string' && /\.(?:png|jpe?g|webp)$/i.test(raw)) ordered.push(path.resolve(raw));
  }
  for (const scope of ['identity', 'outfit']) {
    for (const binding of evidence.reference_packs?.[scope]?.bindings ?? []) ordered.push(imagePath(binding));
  }
  return [...new Set(ordered.filter(Boolean))].slice(0, 12);
}

function qaPrompt(phase, images, evidence = {}) {
  const labels = images.map((filename, index) => `IMAGE_${index + 1}: ${path.basename(filename)}`).join('\n');
  const outfitText = typeof evidence.source_outfit === 'string'
    ? evidence.source_outfit
    : typeof evidence.outfit?.facts?.text === 'string' ? evidence.outfit.facts.text : '';
  const targetContext = outfitText
    ? `\nAUTHORITATIVE TARGET OUTFIT TEXT\n${outfitText}\nThe clothing visible in identity photos is identity context only. Do not treat it as the target outfit or reject its intentional replacement.`
    : '';
  const phaseRules = {
    conditioning: 'Check whether source identity and garment evidence are usable. Never infer hidden body or garment details. Missing evidence is NEEDS_INPUT.',
    avatar: 'Compare the candidate avatar with identity evidence. Require the same recognizable person, frontal half-body framing, full face, natural anatomy, studio photorealism, and no visible background defects.',
    outfit: 'Compare the candidate with identity, approved avatar, and garment/text evidence. Require the same person and exact observable garment type, colors, material, pattern, logo/text, construction and fit. Reject old-clothing residue and anatomy defects.',
    garment: 'Compare raw garment evidence with the canonical garment image. Require unchanged observable type, shape, color, material, pattern, logo/text and construction. The canonical image must show only the garment on clean white.',
    scene: 'Compare the editorial scene with the approved outfit still. Require the same person and unchanged approved outfit; judge scene intent separately.',
  };
  return `Visually judge the attached images for Zeely ${phase} QA. ${phaseRules[phase] ?? phaseRules.outfit}${targetContext}\nOrder:\n${labels}\nFill every schema field with concise visible evidence. PASS only if all blocking criteria are visibly supported; RETRY for a fixable generated defect; NEEDS_INPUT for insufficient source evidence; REJECT for an irrecoverable mismatch. Return only JSON.`;
}

function garmentPrompt(images) {
  const labels = images.map((filename, index) => `source_index ${index}: ${path.basename(filename)}`).join('\n');
  return `Inspect the attached wardrobe photos independently.\n\n${labels}\n\nFor each image, classify the primary wearable item as exactly one allowed category: outerwear, top, bottom, one_piece, footwear, headwear, bag, accessory. Record only visibly observed type, colors, likely material, pattern, exact readable logo/text, and construction details. Put hidden, obscured or uncertain properties in unknowns. Use NEEDS_INPUT when the primary item cannot be identified reliably or critical exact details are too obscured or low-resolution. Confidence below 0.70 must not be READY. Return only the JSON required by the supplied schema. Never call tools.`;
}

function validateQa(value) {
  if (!value || typeof value !== 'object' || !DECISIONS.has(value.decision)) throw new Error('Codex QA returned an invalid decision');
  if (typeof value.reason !== 'string' || !Array.isArray(value.checks) || value.checks.length === 0 || !Array.isArray(value.defects)) throw new Error('Codex QA returned an incomplete object');
  for (const check of value.checks) {
    if (!check || typeof check.name !== 'string' || typeof check.pass !== 'boolean' || typeof check.score !== 'number' || check.score < 0 || check.score > 1 || typeof check.evidence !== 'string') throw new Error('Codex QA returned an invalid check');
  }
  return value;
}

function validatePassport(value, expectedCount) {
  if (!value || !['READY', 'NEEDS_INPUT'].includes(value.status) || !Array.isArray(value.items) || value.items.length !== expectedCount) throw new Error('Codex garment passport returned an invalid item count or status');
  const indexes = new Set();
  for (const item of value.items) {
    if (!Number.isInteger(item.source_index) || item.source_index < 0 || item.source_index >= expectedCount || indexes.has(item.source_index)) throw new Error('Codex garment passport returned invalid source indexes');
    indexes.add(item.source_index);
    if (!CATEGORIES.has(item.category) || typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1) throw new Error('Codex garment passport returned invalid classification');
    if (!item.observed || typeof item.observed.garment_type !== 'string' || !Array.isArray(item.blockers) || !Array.isArray(item.unknowns)) throw new Error('Codex garment passport returned incomplete observations');
    if (item.confidence < 0.7 && value.status === 'READY') throw new Error('Low-confidence garment passport cannot be READY');
  }
  return value;
}

export class CodexVlmEvaluator {
  constructor({ binary = 'codex', model = 'gpt-5.6-terra', commandRunner = defaultCommandRunner, timeoutMs = 60_000,
    qaSchemaPath = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'codex-vlm-qa.schema.json'),
    passportSchemaPath = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'garment-passport.schema.json') } = {}) {
    this.binary = binary;
    this.model = model;
    this.commandRunner = commandRunner;
    this.timeoutMs = timeoutMs;
    this.qaSchemaPath = qaSchemaPath;
    this.passportSchemaPath = passportSchemaPath;
  }

  async #run({ images, promptBuilder, schemaPath, deduplicate = true }) {
    if (!Array.isArray(images) || images.length === 0) throw new Error('Codex VLM requires at least one image');
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-codex-vlm-'));
    const outputPath = path.join(temporaryRoot, 'result.json');
    try {
      // Normalize oversized camera photos before transport. Visual QA needs the
      // visible evidence, not 16–50 MP originals; bounded inputs keep latency
      // deterministic while preserving enough detail for labels and seams.
      const qaImages = [];
      const seenEvidence = new Set();
      for (const [index, filename] of images.entries()) {
        const qaPath = path.join(temporaryRoot, `evidence-${String(index + 1).padStart(2, '0')}.jpg`);
        const bytes = await sharp(filename, { limitInputPixels: 100_000_000 })
          .rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (deduplicate && seenEvidence.has(digest)) continue;
        seenEvidence.add(digest);
        await writeFile(qaPath, bytes);
        qaImages.push(qaPath);
      }
      const prompt = promptBuilder(qaImages);
      // `--image` accepts one or more values. Place the positional prompt first so
      // the CLI cannot consume it as another image path and wait indefinitely.
      const args = ['exec', prompt, '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', this.model, '--config', 'model_reasoning_effort="low"', '--output-schema', schemaPath, '--output-last-message', outputPath];
      for (const filename of qaImages) args.push('--image', filename);
      const result = await this.commandRunner(this.binary, args, { timeoutMs: this.timeoutMs });
      if ((result?.exitCode ?? 0) !== 0) throw new Error('Codex VLM process exited unsuccessfully');
      let raw;
      try { raw = await readFile(outputPath, 'utf8'); } catch { raw = result?.stdout; }
      if (typeof raw !== 'string' || raw.trim() === '') throw new Error('Codex VLM returned no result');
      return JSON.parse(raw);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async evaluateQa(context) {
    const images = collectQaImages(context?.evidence);
    try {
      return validateQa(await this.#run({ images, promptBuilder: (prepared) => qaPrompt(context?.phase, prepared, context?.evidence), schemaPath: this.qaSchemaPath }));
    } catch (error) {
      return { decision: 'NEEDS_INPUT', reason: `automatic_semantic_qa_unavailable: ${error.message}`, checks: [{ name: 'AUTOMATIC_SEMANTIC_QA', pass: false, score: 0, evidence: error.message }], defects: ['Automatic semantic QA did not return valid evidence'] };
    }
  }

  async inspectGarments(images) {
    if (!Array.isArray(images) || images.length < 1 || images.length > 5) throw new Error('Garment inspection requires 1–5 images');
    return validatePassport(await this.#run({ images, promptBuilder: garmentPrompt, schemaPath: this.passportSchemaPath, deduplicate: false }), images.length);
  }
}

export function createCodexQaEvaluator(options) {
  const evaluator = new CodexVlmEvaluator(options);
  return evaluator.evaluateQa.bind(evaluator);
}
