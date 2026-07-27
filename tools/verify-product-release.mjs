#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';

const releaseArgument = process.argv[2];
if (!releaseArgument) {
  throw new Error('Usage: node tools/verify-product-release.mjs /absolute/release-directory');
}

const releaseDirectory = path.resolve(releaseArgument);
const manifestRelativePath = 'ops/product-release-manifest.json';
const requiredEditorialModeIds = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
  'editorial.edwin_novak.institutional_modernism',
  'editorial.edwin_novak.luminous_blue_white',
];
const requiredEditorialGenerationModeIds = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
];
const requiredCreateUniverseModeIds = [
  'shoot.skylight_haze',
  'shoot.terracotta_hardlight',
  'shoot.window_gobo_warm',
  'shoot.grey_studio_stride',
  'shoot.sky_dune_surreal',
];
const requiredCreateUniverseGenerationModeIds = requiredCreateUniverseModeIds.filter(
  (modeId) => modeId !== 'shoot.terracotta_hardlight',
);
const requiredEditorialShotSlots = [
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
];
const requiredEditorialPreviewFiles = requiredEditorialModeIds.flatMap((modeId) => [
  `assets/scene-mood-cards/${modeId}.json`,
  `assets/scene-mood-cards/${modeId}.webp`,
]);
const requiredEditorialBlockingFiles = [
  'assets/editorial-blocking/v1/index.json',
  ...requiredEditorialShotSlots.map((slot) => `assets/editorial-blocking/v1/${slot}.png`),
];
const expectedSourceAllowlist = [
  'assets/editorial-blocking/',
  'assets/scene-presets/',
  'docs/style-units/',
  'config/',
  'prompts/',
  'schemas/',
  'src/',
  'web/',
  ...requiredEditorialPreviewFiles,
  'package.json',
  'package-lock.json',
  'tools/run-monitor-daemon.sh',
  'tools/run-web-daemon.sh',
];
const allowedDirectoryRoots = [
  'assets/editorial-blocking/',
  'assets/scene-presets/',
  'docs/style-units/',
  'config/',
  'prompts/',
  'schemas/',
  'src/',
  'web/',
];
const allowedIndividualFiles = new Set([
  ...requiredEditorialPreviewFiles,
  'package.json',
  'package-lock.json',
  'tools/run-monitor-daemon.sh',
  'tools/run-web-daemon.sh',
]);
const forbiddenSegments = new Set([
  'artifacts',
  'docs',
  'evidence',
  'fixtures',
  'inputs',
  'jobs',
  'node_modules',
  'output',
  'personal',
  'plans',
  'reviews',
  'runtime',
  'secrets',
]);
const privateTextPatterns = [
  { label: 'macOS home path', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: 'Linux home path', pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { label: 'Windows home path', pattern: /[A-Za-z]:\\Users\\[^\\]+\\/i },
  { label: 'file URI', pattern: /\bfile:\/\/\/(?:Users|home)\//i },
  { label: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Anthropic-style secret', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Google-style secret', pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Engram secret', pattern: /\bek_live_[A-Za-z0-9_-]{12,}\b/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'credential-bearing URL', pattern: /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/i },
];
const requiredPresetIds = [
  'std.city.golden_hour_gloss',
  'std.studio.white_window_honeycomb',
  'std.studio.taupe_rembrandt_gloss',
  'std.interior.gallery_morning_gloss',
  'std.nature_architecture.concrete_grass_golden_hour',
];
const requiredSceneFiles = [
  'src/web/approved-item-evidence.js',
  'src/web/editorial-shoot-bible.js',
  'src/web/editorial-shoot-contract.js',
  'src/web/editorial-scene-executor.js',
  'src/web/editorial-shoot-routes.js',
  'src/web/editorial-shoot-service.js',
  'src/web/scene-adapters.js',
  'src/web/scene-contract.js',
  'src/web/scene-resolvers.js',
  'src/web/scene-routes.js',
  'src/web/scene-runtime.js',
  'src/web/scene-service.js',
  'web/public/profile-client.js',
  'web/public/editorial-shoot-ui.js',
  'web/public/editorial-state.js',
  'web/public/scene-state.js',
  'web/public/scene-ui.js',
  'web/public/scene.css',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function updateLengthPrefixed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

function safeRelativePath(value, { manifest = false } = {}) {
  assert(typeof value === 'string' && value.length > 0, 'Release path is missing');
  assert(value === value.replaceAll('\\', '/'), `Release path is not POSIX-normalized: ${value}`);
  assert(!path.posix.isAbsolute(value), `Release path must be relative: ${value}`);
  const normalized = path.posix.normalize(value);
  assert(
    normalized === value && normalized !== '..' && !normalized.startsWith('../'),
    `Unsafe release path: ${value}`,
  );
  const segments = value.split('/');
  const isCreateUniverseUnit = value === 'docs/style-units'
    || value.startsWith('docs/style-units/');
  const forbidden = segments.find((segment) => (
    forbiddenSegments.has(segment.toLowerCase())
    && !(isCreateUniverseUnit && segment.toLowerCase() === 'docs')
  ));
  assert(!forbidden, `Forbidden release path segment is present: ${value}`);
  assert(
    !segments.some((segment) => /^\.env(?:\.|$)/i.test(segment)),
    `Environment file is present: ${value}`,
  );
  assert(!/\.(?:key|pem|p12|pfx)$/i.test(value), `Private key material is present: ${value}`);
  if (!manifest) {
    assert(
      allowedIndividualFiles.has(value)
        || allowedDirectoryRoots.some((root) => value.startsWith(root)),
      `Non-allowlisted production path is present: ${value}`,
    );
  }
  return value;
}

function scanPrivateText(relativePath, bytes) {
  const text = bytes.toString('utf8');
  for (const candidate of privateTextPatterns) {
    assert(!candidate.pattern.test(text), `${candidate.label} found in release file ${relativePath}`);
  }
}

async function walk(directory, relativeDirectory = '') {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => comparePath(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    const info = await lstat(absolutePath);
    assert(!info.isSymbolicLink(), `Release contains a symlink: ${relativePath}`);
    if (info.isDirectory()) {
      files.push(...await walk(absolutePath, relativePath));
      continue;
    }
    assert(info.isFile(), `Release contains an unsupported entry: ${relativePath}`);
    files.push(relativePath);
  }
  return files;
}

function cacheBoundUrl(value, extension, cacheToken) {
  if (
    /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)
    || value.includes('{{')
  ) return value;
  const hashIndex = value.indexOf('#');
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  if (!pathname.toLowerCase().endsWith(extension)) return value;
  return `${pathname}?v=${cacheToken}${hash}`;
}

function bindHtmlAssets(source, cacheToken) {
  const bindAttribute = (tag, attribute, extension) => tag.replace(
    new RegExp(`\\b${attribute}=(["'])([^"']+)\\1`, 'i'),
    (match, quote, value) => `${attribute}=${quote}${cacheBoundUrl(value, extension, cacheToken)}${quote}`,
  );
  return source
    .replace(/<link\b[^>]*>/gi, (tag) => (
      /\brel=(["'])stylesheet\1/i.test(tag) ? bindAttribute(tag, 'href', '.css') : tag
    ))
    .replace(/<script\b[^>]*>/gi, (tag) => bindAttribute(tag, 'src', '.js'));
}

function bindJavaScriptModules(source, cacheToken) {
  return source.replace(
    /(["'])((?:\.\.?\/|\/)[^"'?#]+\.js)(?:\?[^"'#]*)?(#[^"']*)?\1/g,
    (match, quote, pathname, hash = '') => (
      `${quote}${pathname}?v=${cacheToken}${hash}${quote}`
    ),
  );
}

function bindCssImports(source, cacheToken) {
  return source.replace(
    /(@import\s+(?:url\(\s*)?)(["']?)((?:\.\.?\/|\/)[^"'?#)\s]+\.css)(?:\?[^"'#)\s]*)?(#[^"')\s]*)?(\2)(\s*\)?)/gi,
    (match, prefix, quote, pathname, hash = '', closingQuote, suffix) => (
      `${prefix}${quote}${pathname}?v=${cacheToken}${hash}${closingQuote}${suffix}`
    ),
  );
}

function assertExactCacheBinding(value, extension, owner, cacheToken, recordByPath) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return;
  const hashIndex = value.indexOf('#');
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  if (!pathname.toLowerCase().endsWith(extension)) return;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';
  assert(
    query === `?v=${cacheToken}`,
    `Stale cache binding in ${owner}: ${value}`,
  );
  const target = pathname.startsWith('/')
    ? path.posix.join('web/public', pathname.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(owner), pathname));
  assert(target.startsWith('web/public/'), `Browser asset escapes web/public in ${owner}: ${value}`);
  assert(recordByPath.has(target), `Browser asset is missing for ${owner}: ${target}`);
}

function assertHtmlCacheBindings(source, owner, cacheToken, recordByPath) {
  for (const tag of source.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel=(["'])stylesheet\1/i.test(tag)) continue;
    const value = /\bhref=(["'])([^"']+)\1/i.exec(tag)?.[2];
    if (value) assertExactCacheBinding(value, '.css', owner, cacheToken, recordByPath);
  }
  for (const tag of source.match(/<script\b[^>]*>/gi) ?? []) {
    const value = /\bsrc=(["'])([^"']+)\1/i.exec(tag)?.[2];
    if (value) assertExactCacheBinding(value, '.js', owner, cacheToken, recordByPath);
  }
}

function assertJavaScriptCacheBindings(source, owner, cacheToken, recordByPath) {
  const references = source.matchAll(
    /(["'])((?:\.\.?\/|\/)[^"'?#]+\.js(?:\?[^"'#]*)?(?:#[^"']*)?)\1/g,
  );
  for (const match of references) {
    assertExactCacheBinding(match[2], '.js', owner, cacheToken, recordByPath);
  }
}

function assertCssCacheBindings(source, owner, cacheToken, recordByPath) {
  const references = source.matchAll(
    /@import\s+(?:url\(\s*)?(["']?)((?:\.\.?\/|\/)[^"'?#)\s]+\.css(?:\?[^"'#)\s]*)?(?:#[^"')\s]*)?)\1\s*\)?/gi,
  );
  for (const match of references) {
    assertExactCacheBinding(match[2], '.css', owner, cacheToken, recordByPath);
  }
}

async function readReleaseFile(relativePath) {
  safeRelativePath(relativePath);
  return readFile(path.join(releaseDirectory, relativePath));
}

async function readReleaseJson(relativePath) {
  let value;
  try {
    value = JSON.parse((await readReleaseFile(relativePath)).toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid release JSON ${relativePath}: ${error.message}`);
  }
  return value;
}

const releaseInfo = await lstat(releaseDirectory);
assert(
  releaseInfo.isDirectory() && !releaseInfo.isSymbolicLink(),
  'Product release root must be a real directory',
);
const manifestPath = path.join(releaseDirectory, manifestRelativePath);
const manifestInfo = await lstat(manifestPath);
assert(manifestInfo.isFile() && !manifestInfo.isSymbolicLink(), 'Product release manifest is not a regular file');
const manifestBytes = await readFile(manifestPath);
scanPrivateText(manifestRelativePath, manifestBytes);
const manifest = JSON.parse(manifestBytes.toString('utf8'));

assert(manifest.schema_version === '1.0.0', 'Unexpected product release manifest schema');
assert(manifest.release === 'PRODUCT_SCENES_V1', 'Unexpected product release identifier');
assert(manifest.package_type === 'RUNTIME_OVERLAY', 'Product release must be a runtime overlay');
assert(
  manifest.runtime_state_strategy === 'PRESERVE_EXISTING_RUNTIME_AND_NODE_MODULES',
  'Product release must preserve existing runtime state and installed dependencies',
);
assert(/^[a-f0-9]{40}$/.test(manifest.base_commit), 'Product release base_commit is invalid');
assert(
  /^product-[a-f0-9]{8}-[a-f0-9]{12}$/.test(manifest.cache_token),
  'Product release cache token is invalid',
);
assert(
  isDeepStrictEqual(manifest.source_allowlist, expectedSourceAllowlist),
  'Product release source allowlist is not the approved production allowlist',
);
assert(
  isDeepStrictEqual(manifest.excluded_segments, [...forbiddenSegments].sort(comparePath)),
  'Product release excluded segment policy is invalid',
);
assert(
  isDeepStrictEqual(manifest.disabled, []),
  'Product release disabled feature policy is invalid',
);
for (const feature of ['add_items', 'profile', 'scene_api', 'scene_runtime', 'scene_ui']) {
  assert(manifest.features?.[feature] === 'ENABLED', `Product release feature is not enabled: ${feature}`);
}
assert(
  manifest.features?.editorial_preview === 'ACTIVE',
  'Editorial catalog feature must be ACTIVE',
);
assert(
  manifest.features?.editorial_generation === 'ENABLED',
  'Editorial generation must be ENABLED',
);
assert(
  manifest.source_authority?.hash_format
    === 'sha256-length-prefixed-path-mode-canonical-cache-bytes-v1',
  'Product release source hash format is invalid',
);
assert(
  /^[a-f0-9]{64}$/.test(manifest.source_authority?.digest_sha256),
  'Product release source digest is invalid',
);
assert(
  manifest.cache_token.slice(-12) === manifest.source_authority.digest_sha256.slice(0, 12),
  'Product release cache token is not bound to its source digest',
);
assert(/^[a-f0-9]{64}$/.test(manifest.content_digest_sha256), 'Product content digest is invalid');
assert(Array.isArray(manifest.deploy_files) && manifest.deploy_files.length > 0, 'Product release has no deploy files');
assert(Array.isArray(manifest.source_authority.files), 'Product release source file authority is invalid');
assert(Array.isArray(manifest.transformed_files), 'Product release transformed_files is invalid');
assert(manifest.scene_preset_catalog === 'assets/scene-presets/index.json', 'Product scene catalog path is invalid');
assert(
  manifest.editorial_preview?.status === 'ACTIVE'
    && manifest.editorial_preview?.generation === 'ENABLED',
  'Editorial authority must be active and generation-enabled',
);
assert(
  isDeepStrictEqual(manifest.editorial_preview?.mode_ids, requiredEditorialModeIds),
  'Editorial preview authority does not contain the exact four mode IDs',
);
assert(
  new Set(manifest.editorial_preview.mode_ids).size === requiredEditorialModeIds.length,
  'Editorial preview authority contains duplicate mode IDs',
);
assert(
  isDeepStrictEqual(
    manifest.editorial_preview?.generation_mode_ids,
    requiredEditorialGenerationModeIds,
  ),
  'Editorial generation authority does not contain the exact two approved mode IDs',
);
assert(
  new Set(manifest.editorial_preview.generation_mode_ids).size
    === requiredEditorialGenerationModeIds.length
    && manifest.editorial_preview.generation_mode_ids.every(
      (modeId) => manifest.editorial_preview.mode_ids.includes(modeId),
    ),
  'Editorial generation authority is duplicated or escapes the preview catalog',
);
assert(
  Array.isArray(manifest.editorial_preview?.assets)
    && manifest.editorial_preview.assets.length === requiredEditorialModeIds.length,
  'Editorial preview asset authority must contain four entries',
);

const records = manifest.deploy_files.map((record) => {
  const relativePath = safeRelativePath(record.path);
  assert(Number.isSafeInteger(record.size_bytes) && record.size_bytes >= 0, `Invalid size for ${relativePath}`);
  assert(/^[a-f0-9]{64}$/.test(record.sha256), `Invalid SHA-256 for ${relativePath}`);
  assert(/^(?:0[4567][0-7]{2})$/.test(record.mode), `Invalid mode for ${relativePath}`);
  assert(record.deploy === true, `Deploy flag is invalid for ${relativePath}`);
  return { ...record, path: relativePath };
});
const recordPaths = records.map((record) => record.path);
assert(
  isDeepStrictEqual(recordPaths, [...recordPaths].sort(comparePath)),
  'Product release inventory is not deterministically sorted',
);
assert(new Set(recordPaths).size === recordPaths.length, 'Product release inventory contains duplicate paths');
assert(
  new Set(recordPaths.map((value) => value.normalize('NFC').toLowerCase())).size === recordPaths.length,
  'Product release inventory contains case/Unicode-colliding paths',
);
const recordByPath = new Map(records.map((record) => [record.path, record]));
assert(
  isDeepStrictEqual(
    recordPaths.filter((value) => value.startsWith('assets/scene-mood-cards/')),
    [...requiredEditorialPreviewFiles].sort(comparePath),
  ),
  'Release contains a non-allowlisted or missing editorial preview asset',
);
assert(
  isDeepStrictEqual(
    recordPaths.filter((value) => value.startsWith('assets/editorial-blocking/')),
    [...requiredEditorialBlockingFiles].sort(comparePath),
  ),
  'Release is missing a per-slot editorial blocking diagram or its manifest',
);

const sourceRecords = manifest.source_authority.files.map((record) => {
  const relativePath = safeRelativePath(record.path);
  assert(Number.isSafeInteger(record.size_bytes) && record.size_bytes >= 0, `Invalid source size for ${relativePath}`);
  assert(/^[a-f0-9]{64}$/.test(record.sha256), `Invalid source SHA-256 for ${relativePath}`);
  assert(/^(?:0[4567][0-7]{2})$/.test(record.mode), `Invalid source mode for ${relativePath}`);
  return { ...record, path: relativePath };
});
const sourcePaths = sourceRecords.map((record) => record.path);
assert(
  isDeepStrictEqual(sourcePaths, [...sourcePaths].sort(comparePath)),
  'Product source authority is not deterministically sorted',
);
assert(isDeepStrictEqual(sourcePaths, recordPaths), 'Product source and deploy inventories do not cover the same files');
const sourceByPath = new Map(sourceRecords.map((record) => [record.path, record]));

const transformedFiles = manifest.transformed_files.map((value) => safeRelativePath(value));
assert(
  isDeepStrictEqual(transformedFiles, [...transformedFiles].sort(comparePath)),
  'Product transformed_files is not deterministically sorted',
);
assert(new Set(transformedFiles).size === transformedFiles.length, 'Product transformed_files contains duplicates');
assert(
  transformedFiles.every((value) => (
    recordByPath.has(value)
      && value.startsWith('web/public/')
      && ['.html', '.js', '.css'].includes(path.posix.extname(value))
  )),
  'Product transformed_files contains a non-browser asset',
);
for (const relativePath of transformedFiles) {
  const sourceRecord = sourceByPath.get(relativePath);
  const releaseRecord = recordByPath.get(relativePath);
  assert(
    sourceRecord.sha256 !== releaseRecord.sha256
      || sourceRecord.size_bytes !== releaseRecord.size_bytes,
    `Product transformed_files contains an unchanged file: ${relativePath}`,
  );
}

const actualPaths = (await walk(releaseDirectory)).sort(comparePath);
assert(actualPaths.includes(manifestRelativePath), 'Product release manifest is missing');
assert(
  new Set(actualPaths.map((value) => value.normalize('NFC').toLowerCase())).size
    === actualPaths.length,
  'Product release contains case/Unicode-colliding paths',
);
for (const relativePath of actualPaths) {
  if (relativePath === manifestRelativePath) continue;
  safeRelativePath(relativePath);
}
const actualDeployPaths = actualPaths.filter((value) => value !== manifestRelativePath);
assert(
  isDeepStrictEqual(actualDeployPaths, recordPaths),
  'Product release file set does not match its manifest',
);

const canonicalSourceHash = createHash('sha256');
updateLengthPrefixed(canonicalSourceHash, 'zeely-product-source-canonical-cache-v1');
for (const record of records) {
  const absolutePath = path.join(releaseDirectory, record.path);
  const info = await lstat(absolutePath);
  assert(info.isFile() && !info.isSymbolicLink(), `Release file is not regular: ${record.path}`);
  const actualMode = (info.mode & 0o777).toString(8).padStart(4, '0');
  assert(actualMode === record.mode, `Mode mismatch for ${record.path}`);
  assert((info.mode & 0o022) === 0, `Group/world-writable release file: ${record.path}`);
  assert((info.mode & 0o6000) === 0, `setuid/setgid release file: ${record.path}`);
  const bytes = await readFile(absolutePath);
  assert(bytes.byteLength === record.size_bytes, `Size mismatch for ${record.path}`);
  assert(sha256(bytes) === record.sha256, `SHA-256 mismatch for ${record.path}`);
  scanPrivateText(record.path, bytes);

  const sourceRecord = sourceByPath.get(record.path);
  assert(sourceRecord.mode === record.mode, `Source/release mode mismatch for ${record.path}`);
  if (!transformedFiles.includes(record.path)) {
    assert(sourceRecord.size_bytes === record.size_bytes, `Unexpected source size transform for ${record.path}`);
    assert(sourceRecord.sha256 === record.sha256, `Unexpected source content transform for ${record.path}`);
  }

  const extension = path.posix.extname(record.path).toLowerCase();
  const canonicalBytes = record.path.startsWith('web/public/')
    && ['.html', '.js', '.css'].includes(extension)
    ? Buffer.from(
      extension === '.html'
        ? bindHtmlAssets(bytes.toString('utf8'), '__ZEELY_CACHE_TOKEN__')
        : extension === '.js'
          ? bindJavaScriptModules(bytes.toString('utf8'), '__ZEELY_CACHE_TOKEN__')
          : bindCssImports(bytes.toString('utf8'), '__ZEELY_CACHE_TOKEN__'),
    )
    : bytes;
  updateLengthPrefixed(canonicalSourceHash, record.path);
  updateLengthPrefixed(canonicalSourceHash, record.mode);
  updateLengthPrefixed(canonicalSourceHash, canonicalBytes);
}

assert(
  canonicalSourceHash.digest('hex') === manifest.source_authority.digest_sha256,
  'Product source digest does not match canonical released content',
);
assert(
  records.reduce((total, record) => total + record.size_bytes, 0) === manifest.release_size_bytes,
  'Product release size does not match its manifest',
);
assert(
  sha256(Buffer.from(JSON.stringify(records))) === manifest.content_digest_sha256,
  'Product content digest does not match its inventory',
);

for (const record of records) {
  if (!record.path.startsWith('web/public/')) continue;
  const extension = path.posix.extname(record.path).toLowerCase();
  if (!['.html', '.js', '.css'].includes(extension)) continue;
  const source = (await readReleaseFile(record.path)).toString('utf8');
  if (extension === '.html') {
    assertHtmlCacheBindings(source, record.path, manifest.cache_token, recordByPath);
  } else if (extension === '.js') {
    assertJavaScriptCacheBindings(source, record.path, manifest.cache_token, recordByPath);
  } else {
    assertCssCacheBindings(source, record.path, manifest.cache_token, recordByPath);
  }
}

for (const requiredPath of requiredSceneFiles) {
  assert(recordByPath.has(requiredPath), `Required scene implementation is missing: ${requiredPath}`);
}
assert(
  !actualPaths.some((value) => /(?:^|\/)scene-ui-disabled\.js$/i.test(value)),
  'Disabled scene UI artifact is present',
);
for (const record of records) {
  if (record.size_bytes > 4 * 1024 * 1024 || /\.(?:png|webp|jpg|jpeg|gif)$/i.test(record.path)) continue;
  const source = (await readReleaseFile(record.path)).toString('utf8');
  assert(!source.includes('scene-ui-disabled'), `Disabled scene UI reference is present: ${record.path}`);
  assert(!source.includes('Сцени вимкнено'), `Disabled scene UI copy is present: ${record.path}`);
}

const indexHtml = (await readReleaseFile('web/public/index.html')).toString('utf8');
assert(
  indexHtml.includes(`/scene.css?v=${manifest.cache_token}`),
  'Scene stylesheet is not cache-bound in the main product',
);
assert(indexHtml.includes('id="scene-view"'), 'Scene view is missing from the main product');
assert(indexHtml.includes('class="scene-shell"'), 'Interactive scene shell is missing from the main product');
assert(indexHtml.includes('id="scene-preset-grid"'), 'Scene preset picker is missing from the main product');
assert(indexHtml.includes('id="scene-start"'), 'Scene start control is missing from the main product');
assert(indexHtml.includes('id="scene-output-image"'), 'Scene result surface is missing from the main product');
assert(!/<body[^>]*\bscene-disabled\b/i.test(indexHtml), 'Scene UI is disabled on the product body');
assert(
  !/<div[^>]*id=["']scene-view["'][^>]*\bhidden(?:\s|=)[^>]*aria-hidden=["']true["'][^>]*>\s*<\/div>/i
    .test(indexHtml),
  'Scene view was replaced by a disabled placeholder',
);

const appSource = (await readReleaseFile('web/public/app.js')).toString('utf8');
assert(
  appSource.includes(`from './scene-ui.js?v=${manifest.cache_token}'`),
  'Main app does not import the active cache-bound scene UI',
);
assert(appSource.includes('createSceneUi({'), 'Main app does not initialize the scene UI');
const sceneUiSource = (await readReleaseFile('web/public/scene-ui.js')).toString('utf8');
assert(sceneUiSource.includes('export function createSceneUi'), 'Scene UI factory is missing');
assert(
  sceneUiSource.includes(`from './scene-state.js?v=${manifest.cache_token}'`)
    && sceneUiSource.includes(`from './profile-client.js?v=${manifest.cache_token}'`),
  'Scene UI dependencies are not cache-bound',
);
const profileClientSource = (await readReleaseFile('web/public/profile-client.js')).toString('utf8');
for (const exportName of [
  'loadScenePresets',
  'createProfileScene',
  'loadProfileScene',
  'retryProfileScene',
  'cancelProfileScene',
  'deleteProfileScene',
]) {
  assert(profileClientSource.includes(`function ${exportName}`), `Scene client API is missing: ${exportName}`);
}

const startSource = (await readReleaseFile('src/web/start.js')).toString('utf8');
assert(
  startSource.includes("from './scene-runtime.js'")
    && startSource.includes('createSceneRuntimeDependencies({')
    && startSource.includes('sceneDependencies,'),
  'Scene runtime is not connected to the server entry point',
);
const serverSource = (await readReleaseFile('src/web/app.js')).toString('utf8');
assert(
  serverSource.includes("from './scene-routes.js'")
    && serverSource.includes("from './scene-service.js'")
    && serverSource.includes('new SceneService({')
    && serverSource.includes('registerSceneRoutes(app,'),
  'Scene API/service is not connected to the web application',
);
const sceneRoutesSource = (await readReleaseFile('src/web/scene-routes.js')).toString('utf8');
const runtimeSource = (await readReleaseFile('src/web/scene-runtime.js')).toString('utf8');
assert(
  runtimeSource.includes("'assets', 'scene-presets'")
    && runtimeSource.includes('FilesystemScenePresetResolver'),
  'Scene runtime is not bound to the released preset assets',
);
const releasedServerSources = await Promise.all(
  records
    .filter((record) => record.path.startsWith('src/web/') && record.path.endsWith('.js'))
    .map(async (record) => ({
      path: record.path,
      source: (await readReleaseFile(record.path)).toString('utf8'),
    })),
);
const releasedBrowserSources = await Promise.all(
  records
    .filter((record) => record.path.startsWith('web/public/') && record.path.endsWith('.js'))
    .map(async (record) => ({
      path: record.path,
      source: (await readReleaseFile(record.path)).toString('utf8'),
    })),
);
const allServerSource = releasedServerSources.map((entry) => entry.source).join('\n');
const allBrowserSource = releasedBrowserSources.map((entry) => entry.source).join('\n');
const editorialServiceSource = (
  await readReleaseFile('src/web/editorial-shoot-service.js')
).toString('utf8');
const editorialExecutorSource = (
  await readReleaseFile('src/web/editorial-scene-executor.js')
).toString('utf8');
assert(
  editorialServiceSource.includes('export class EditorialShootService')
    && editorialServiceSource.includes('sceneExecutor.executeShot'),
  'Durable EditorialShootService orchestration is missing',
);
assert(
  allServerSource.includes("from './editorial-shoot-service.js'")
    && allServerSource.includes('new EditorialShootService({')
    && allServerSource.includes('editorialShootService'),
  'EditorialShootService is not connected to the production web runtime',
);
assert(
  editorialExecutorSource.includes('export class EditorialSceneExecutor')
    && editorialExecutorSource.includes('async executeShot(context)')
    && editorialExecutorSource.includes('this.sceneService.createScene({')
    && editorialExecutorSource.includes('this.sceneService.verifiedExecutionResult(')
    && editorialExecutorSource.includes('this.sceneService.outputFile(')
    && /\bsceneExecutor\b/.test(allServerSource),
  'Editorial generation lacks a real scene executor/delegation',
);
const editorialRouteSources = releasedServerSources
  .filter((entry) => entry.source.includes('/api/') && entry.source.includes('editorial-shoot'))
  .map((entry) => entry.source)
  .join('\n');
assert(editorialRouteSources.length > 0, 'Editorial shoot routes are missing');
for (const [label, routePattern] of [
  ['create', /\/api\/profile\/looks\/:lookId\/editorial-shoots(?:['"`/]|$)/],
  ['read', /\/api\/profile\/editorial-shoots\/:shootId(?:['"`/]|$)/],
  ['ShootBible approval', /editorial-shoots\/:shootId\/(?:approve-bible|bible\/approve)/],
  ['hero approval', /editorial-shoots\/:shootId\/(?:approve-hero|hero\/approve)/],
  ['shot retry', /editorial-shoots\/:shootId\/(?:shots\/:slot\/)?retry/],
  ['cancellation', /editorial-shoots\/:shootId\/cancel/],
  ['event stream', /editorial-shoots\/:shootId\/events/],
  ['image output', /editorial-shoots\/:shootId\/shots\/:slot\/image/],
  ['download output', /editorial-shoots\/:shootId\/shots\/:slot\/download/],
]) {
  assert(routePattern.test(editorialRouteSources), `Editorial ${label} route is missing`);
}
for (const [label, methodPattern] of [
  [
    'create mutation',
    /(?:app|fastify)\.post\(\s*['"`]\/api\/profile\/looks\/:lookId\/editorial-shoots['"`]/,
  ],
  [
    'ShootBible approval mutation',
    /(?:app|fastify)\.post\(\s*['"`]\/api\/profile\/editorial-shoots\/:shootId\/approve-bible['"`]/,
  ],
  [
    'hero approval mutation',
    /(?:app|fastify)\.post\(\s*['"`]\/api\/profile\/editorial-shoots\/:shootId\/approve-hero['"`]/,
  ],
  [
    'shot retry mutation',
    /(?:app|fastify)\.post\(\s*['"`]\/api\/profile\/editorial-shoots\/:shootId\/shots\/:slot\/retry['"`]/,
  ],
  [
    'cancel mutation',
    /(?:app|fastify)\.post\(\s*['"`]\/api\/profile\/editorial-shoots\/:shootId\/cancel['"`]/,
  ],
  [
    'delete mutation',
    /(?:app|fastify)\.delete\(\s*['"`]\/api\/profile\/editorial-shoots\/:shootId['"`]/,
  ],
  [
    'image output read',
    /(?:app|fastify)\.get\(\s*['"`]\/api\/profile\/editorial-shoots\/:shootId\/shots\/:slot\/image['"`]/,
  ],
  [
    'download output read',
    /(?:app|fastify)\.get\(\s*['"`]\/api\/profile\/editorial-shoots\/:shootId\/shots\/:slot\/download['"`]/,
  ],
]) {
  assert(methodPattern.test(editorialRouteSources), `Editorial ${label} is missing`);
}
assert(
  editorialRouteSources.includes('resolveRequestProfile')
    && editorialRouteSources.includes('profileId')
    && editorialRouteSources.includes('sameOriginMutation'),
  'Editorial routes are not bound to browser-profile ownership and same-origin mutations',
);
assert(
  profileClientSource.includes('editorial-shoots')
    && allBrowserSource.includes('export function createEditorialShootUi')
    && sceneUiSource.includes('createEditorialShootUi')
    && allBrowserSource.includes('zeely_active_editorial_shoot_v1'),
  'Active editorial client controller, API client, or durable resume key is missing',
);
for (const forbiddenCopy of [
  'PREVIEW_ONLY',
  'Це mood-board, не кнопки запуску',
  'Виконавець генерації та сховище результатів ще не підключені',
]) {
  assert(
    !`${indexHtml}\n${allBrowserSource}`.includes(forbiddenCopy),
    `Preview-only editorial blocker remains in the active client: ${forbiddenCopy}`,
  );
}
assert(
  !allServerSource.includes("status: 'PREVIEW_ONLY'")
    && !allServerSource.includes('status: "PREVIEW_ONLY"'),
  'Preview-only editorial status remains in the production server',
);

const editorialCatalog = await readReleaseJson('config/scene-presets.json');
const editorialModes = editorialCatalog?.editorial_program?.modes;
assert(Array.isArray(editorialModes), 'Editorial mode catalog is missing');
assert(
  isDeepStrictEqual(
    editorialModes.map((mode) => mode?.preset_id),
    requiredEditorialModeIds,
  ),
  'Editorial mode catalog does not contain the exact four ordered mode IDs',
);
assert(
  isDeepStrictEqual(
    editorialModes
      .filter((mode) => mode?.source_set_status === 'READY')
      .map((mode) => mode.preset_id),
    requiredEditorialGenerationModeIds,
  ),
  'Editorial READY modes do not match the exact generation allowlist',
);
assert(
  editorialModes
    .filter((mode) => !requiredEditorialGenerationModeIds.includes(mode?.preset_id))
    .every((mode) => mode?.source_set_status === 'BLOCKED_MISSING_SECOND_SOURCE'),
  'Blocked editorial modes are not explicitly disabled by source readiness',
);
const editorialAssets = manifest.editorial_preview.assets;
assert(
  isDeepStrictEqual(
    editorialAssets.map((asset) => asset?.mode_id),
    requiredEditorialModeIds,
  ),
  'Editorial preview manifest assets do not contain the exact four ordered mode IDs',
);
for (const modeId of requiredEditorialModeIds) {
  const catalogMode = editorialModes.find((mode) => mode.preset_id === modeId);
  const authority = editorialAssets.find((asset) => asset?.mode_id === modeId);
  const sidecarPath = `assets/scene-mood-cards/${modeId}.json`;
  const imagePath = `assets/scene-mood-cards/${modeId}.webp`;
  const promptPath = `prompts/scenes/${modeId}.txt`;
  assert(
    isDeepStrictEqual(authority, {
      mode_id: modeId,
      sidecar_path: sidecarPath,
      sidecar_sha256: recordByPath.get(sidecarPath)?.sha256,
      image_path: imagePath,
      image_sha256: recordByPath.get(imagePath)?.sha256,
      width: 1024,
      height: 1280,
      media_type: 'image/webp',
    }),
    `Editorial preview manifest authority is invalid: ${modeId}`,
  );
  const sidecar = await readReleaseJson(sidecarPath);
  assert(
    sidecar.schema_version === '1.0.0'
      && sidecar.preset_id === modeId
      && sidecar.kind === 'editorial'
      && sidecar.family === 'edwin_novak'
      && sidecar.ui_name_uk === catalogMode.ui_name_uk
      && sidecar.asset_role === 'mood_card'
      && sidecar.file === imagePath
      && sidecar.sha256 === recordByPath.get(imagePath)?.sha256
      && sidecar.prompt_path === promptPath
      && sidecar.prompt_sha256 === recordByPath.get(promptPath)?.sha256
      && sidecar.delivery?.width === 1024
      && sidecar.delivery?.height === 1280
      && sidecar.delivery?.format === 'webp'
      && sidecar.delivery?.aspect_ratio === '4:5'
      && sidecar.contains_personal_input === false,
    `Editorial preview sidecar contract is invalid: ${modeId}`,
  );
  const imageBytes = await readReleaseFile(imagePath);
  let metadata;
  try {
    const image = sharp(imageBytes, { failOn: 'error', animated: true });
    metadata = await image.metadata();
    await image.stats();
  } catch {
    throw new Error(`Editorial preview is not a decodable WebP image: ${modeId}`);
  }
  assert(
    metadata.format === 'webp'
      && metadata.width === 1024
      && metadata.height === 1280
      && (metadata.pages ?? 1) === 1,
    `Editorial preview must be one 1024x1280 WebP image: ${modeId}`,
  );
}

const catalog = await readReleaseJson('assets/scene-presets/index.json');
assert(
  isDeepStrictEqual(catalog.selected_preset_ids, requiredPresetIds),
  'Scene release does not contain the exact five selected presets',
);
assert(Array.isArray(catalog.presets) && catalog.presets.length === 5, 'Scene catalog must publish five presets');
for (const presetId of requiredPresetIds) {
  const matches = catalog.presets.filter((entry) => entry?.preset_id === presetId);
  assert(matches.length === 1, `Scene catalog entry is missing or duplicated: ${presetId}`);
  const entry = matches[0];
  assert(entry.preset_version === '1.0.0', `Scene preset version is invalid: ${presetId}`);
  const packDirectory = `assets/scene-presets/${presetId}/v1`;
  const expectedPaths = {
    packIndex: `${packDirectory}/index.json`,
    preset: `${packDirectory}/preset.json`,
    referencePack: `${packDirectory}/reference-pack.json`,
    sourceLedger: `${packDirectory}/source-ledger.json`,
    productionPrompt: `prompts/scene-presets/${presetId}/v1/production-scene.txt`,
    environmentPng: `${packDirectory}/environment-plate.png`,
    environmentWebp: `${packDirectory}/environment-plate.webp`,
    lightingPng: `${packDirectory}/lighting-preview.png`,
    lightingWebp: `${packDirectory}/lighting-preview.webp`,
  };
  for (const requiredPath of Object.values(expectedPaths)) {
    assert(recordByPath.has(requiredPath), `Scene preset asset is missing: ${requiredPath}`);
  }
  assert(entry.preset_path === expectedPaths.preset, `Scene preset path is invalid: ${presetId}`);
  assert(
    entry.reference_pack_path === expectedPaths.referencePack,
    `Scene reference pack path is invalid: ${presetId}`,
  );
  assert(
    entry.source_ledger_path === expectedPaths.sourceLedger,
    `Scene source ledger path is invalid: ${presetId}`,
  );
  assert(
    entry.production_prompt_path === expectedPaths.productionPrompt,
    `Scene production prompt path is invalid: ${presetId}`,
  );
  for (const [relativePath, expectedHash, label] of [
    [expectedPaths.preset, entry.preset_sha256, 'preset'],
    [expectedPaths.referencePack, entry.reference_pack_sha256, 'reference pack'],
    [expectedPaths.sourceLedger, entry.source_ledger_sha256, 'source ledger'],
    [expectedPaths.productionPrompt, entry.prompt_sha256, 'production prompt'],
  ]) {
    assert(
      recordByPath.get(relativePath)?.sha256 === expectedHash,
      `Scene ${label} hash is invalid: ${presetId}`,
    );
  }
  const packIndex = await readReleaseJson(expectedPaths.packIndex);
  assert(isDeepStrictEqual(packIndex, entry), `Scene pack index does not match catalog: ${presetId}`);
  const referencePack = await readReleaseJson(expectedPaths.referencePack);
  const sourceLedger = await readReleaseJson(expectedPaths.sourceLedger);
  assert(referencePack.preset_id === presetId, `Reference pack preset id is invalid: ${presetId}`);
  assert(referencePack.preset_sha256 === entry.preset_sha256, `Reference pack preset hash is invalid: ${presetId}`);
  assert(referencePack.prompt_sha256 === entry.prompt_sha256, `Reference pack prompt hash is invalid: ${presetId}`);
  assert(
    isDeepStrictEqual(referencePack.source_ledger, sourceLedger),
    `Reference pack source ledger is invalid: ${presetId}`,
  );
  assert(Array.isArray(entry.references) && entry.references.length === 5, `Scene roles are incomplete: ${presetId}`);
  assert(
    isDeepStrictEqual(
      entry.references.map((reference) => reference.role),
      [
        'environment_anchor',
        'lighting_anchor',
        'composition_anchor',
        'palette_anchor',
        'negative_reference',
      ],
    ),
    `Scene reference roles are invalid: ${presetId}`,
  );
  for (const reference of entry.references) {
    assert(
      reference.path.startsWith(`${packDirectory}/`),
      `Scene reference escapes its preset pack: ${reference.path}`,
    );
    assert(
      recordByPath.get(reference.path)?.sha256 === reference.sha256,
      `Scene reference is missing or hash-mismatched: ${reference.path}`,
    );
    const boundReference = referencePack.references.find(
      (candidate) => candidate.reference_id === reference.reference_id,
    );
    assert(
      boundReference?.role === reference.role
        && boundReference?.media_type === reference.media_type
        && boundReference?.sha256 === reference.sha256,
      `Scene reference pack binding is invalid: ${reference.reference_id}`,
    );
  }
}

// Every editorial assertion above reads a manifest field or an asset's bytes, so this
// verifier kept reporting editorial_generation ENABLED through the whole period editorial
// could not produce a single frame: nothing had ever run the compiler those fields promise.
// So the ShootBible is compiled here, from the release under test rather than from the
// workspace, and only after the full inventory has been hash-matched against the manifest,
// because that is the point at which these bytes are known to be the released ones. The
// compiler's import graph reaches node builtins only, which is why it loads without the
// release's node_modules and cannot reach the network.
const releaseBible = await import(pathToFileURL(
  path.join(releaseDirectory, 'src/web/editorial-shoot-bible.js'),
).href);
assert(
  [...requiredEditorialGenerationModeIds, ...requiredCreateUniverseModeIds]
    .every((modeId) => releaseBible.READY_EDITORIAL_MODE_IDS.includes(modeId)),
  'Released ShootBible compiler does not carry every registered legacy and Create Universe mode',
);
const compiledBibleIds = [];
for (const modeId of requiredEditorialGenerationModeIds) {
  const mode = editorialModes.find((candidate) => candidate.preset_id === modeId);
  const base = releaseBible.EDITORIAL_BASE_PRESETS[modeId];
  assert(base, `Released editorial mode has no verified production base pack: ${modeId}`);
  assert(
    requiredPresetIds.includes(base.preset_id) && base.preset_version === '1.0.0',
    `Editorial base pack is outside the verified scene release: ${modeId}`,
  );
  const packDirectory = `assets/scene-presets/${base.preset_id}/v1`;
  const basePack = {
    preset: await readReleaseJson(`${packDirectory}/preset.json`),
    reference_pack: await readReleaseJson(`${packDirectory}/reference-pack.json`),
  };
  let bible;
  try {
    bible = releaseBible.compileEditorialShootBible({ mode, basePack });
  } catch (error) {
    throw new Error(
      `Editorial ShootBible does not compile from this release: ${modeId}: ${error.message}`,
    );
  }
  assert(
    bible.mode_id === modeId && bible.mode_version === mode.version,
    `Compiled ShootBible is not bound to its mode: ${modeId}`,
  );
  assert(
    isDeepStrictEqual(bible.shots.map((shot) => shot.slot), requiredEditorialShotSlots),
    `Compiled ShootBible does not cover the six ordered shot slots: ${modeId}`,
  );
  compiledBibleIds.push(bible.bible_id);
}
assert(
  new Set(compiledBibleIds).size === requiredEditorialGenerationModeIds.length,
  'Compiled ShootBibles are not one distinct bible per generation mode',
);

// Create Universe ships its immutable source units rather than copying them into
// a std.* preset. Verify the actual released bytes here; resolver tests compile
// the four READY units into six image-reference packs and keep Terracotta blocked.
for (const modeId of requiredCreateUniverseModeIds) {
  const unitRoot = `docs/style-units/${modeId}`;
  const manifest = await readReleaseJson(`${unitRoot}/manifest.json`);
  const unit = await readReleaseJson(`${unitRoot}/unit.json`);
  assert(manifest.unit_id === modeId && unit.unit_id === modeId, `Create Universe identity is invalid: ${modeId}`);
  const mismatches = [];
  for (const sheet of manifest.sheets ?? []) {
    const bytes = await readReleaseFile(`${unitRoot}/${sheet.path}`);
    if (sha256(bytes) !== sheet.sha256) mismatches.push(sheet.sheet_id);
  }
  if (modeId === 'shoot.terracotta_hardlight') {
    assert(mismatches.length > 0, 'Terracotta must remain integrity-blocked until its declared source bytes are restored');
  } else {
    assert(mismatches.length === 0, `Create Universe source unit has a SHA mismatch: ${modeId}`);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  release: manifest.release,
  base_commit: manifest.base_commit,
  deploy_files: records.length,
  release_size_bytes: manifest.release_size_bytes,
  cache_token: manifest.cache_token,
  content_digest_sha256: manifest.content_digest_sha256,
  scene_presets: requiredPresetIds.length,
  scene_ui: 'ENABLED',
  scene_api: 'ENABLED',
  scene_runtime: 'ENABLED',
  editorial_preview: 'ACTIVE',
  editorial_generation: 'ENABLED',
  editorial_modes: requiredEditorialModeIds.length,
  editorial_generation_modes: requiredEditorialGenerationModeIds.length,
  create_universe_modes: requiredCreateUniverseModeIds.length,
  create_universe_generation_modes: requiredCreateUniverseGenerationModeIds.length,
  editorial_bibles_compiled: compiledBibleIds.length,
})}\n`);
