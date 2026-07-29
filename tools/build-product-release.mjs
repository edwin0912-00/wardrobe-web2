#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv[2];
const manifestRelativePath = 'ops/product-release-manifest.json';
const editorialPreviewModeIds = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
  'editorial.edwin_novak.institutional_modernism',
  'editorial.edwin_novak.luminous_blue_white',
  'shoot.skylight_haze',
  'shoot.terracotta_hardlight',
  'shoot.window_gobo_warm',
  'shoot.grey_studio_stride',
  'shoot.sky_dune_surreal',
  'shoot.hardsun_brick_doorway',
  'shoot.overcast_street_stride',
  'shoot.grey_wall_gloss',
  'shoot.ochre_stage_tailoring',
  'shoot.shutter_amber_interior',
];
const editorialGenerationModeIds = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
  'shoot.skylight_haze',
  'shoot.terracotta_hardlight',
  'shoot.window_gobo_warm',
  'shoot.grey_studio_stride',
  'shoot.sky_dune_surreal',
  'shoot.hardsun_brick_doorway',
  'shoot.overcast_street_stride',
  'shoot.grey_wall_gloss',
  'shoot.ochre_stage_tailoring',
  'shoot.shutter_amber_interior',
];
const editorialPreviewFiles = editorialPreviewModeIds.flatMap((modeId) => [
  `assets/scene-mood-cards/${modeId}.json`,
  `assets/scene-mood-cards/${modeId}.webp`,
]);
const directoryRoots = [
  // Ships whole: every editorial shot resolves its own slot diagram at generation
  // time, so a release missing one PNG does not degrade — that mode stops shooting.
  'assets/editorial-blocking',
  'assets/scene-presets',
  // Immutable, hash-verified Create Universe reference units. These are source
  // packs consumed by the editorial resolver, not general documentation.
  'docs/style-units',
  'config',
  'prompts',
  'schemas',
  'src',
  'web',
];
const individualFiles = [
  ...editorialPreviewFiles,
  'package.json',
  'package-lock.json',
  'tools/run-monitor-daemon.sh',
  'tools/run-web-daemon.sh',
];
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

if (!outputArgument) {
  throw new Error('Usage: node tools/build-product-release.mjs /absolute/new/output-directory');
}

const outputDirectory = path.resolve(outputArgument);
if (
  outputDirectory === projectRoot
  || outputDirectory.startsWith(`${projectRoot}${path.sep}`)
  || projectRoot.startsWith(`${outputDirectory}${path.sep}`)
) {
  throw new Error('Release output must be outside the workspace');
}

const outputParent = path.dirname(outputDirectory);
await mkdir(outputParent, { recursive: true });
await assertAbsent(outputDirectory);
const stagingDirectory = await mkdtemp(path.join(
  outputParent,
  `.${path.basename(outputDirectory)}.zeely-product-build-`,
));
const releaseDirectory = path.join(stagingDirectory, 'release');
await mkdir(releaseDirectory, { mode: 0o700 });

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function modeOf(info) {
  return (info.mode & 0o777).toString(8).padStart(4, '0');
}

function updateLengthPrefixed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

function assertSafeRelativePath(relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath === '..'
    || relativePath.startsWith('../')
  ) {
    throw new Error(`Unsafe release source path: ${relativePath}`);
  }
  const segments = relativePath.split('/');
  const isCreateUniverseUnit = relativePath === 'docs/style-units'
    || relativePath.startsWith('docs/style-units/');
  const forbidden = segments.find((segment) => (
    forbiddenSegments.has(segment.toLowerCase())
    && !(isCreateUniverseUnit && segment.toLowerCase() === 'docs')
  ));
  if (forbidden) throw new Error(`Forbidden release path segment: ${relativePath}`);
  if (segments.some((segment) => /^\.env(?:\.|$)/i.test(segment))) {
    throw new Error(`Environment file is forbidden: ${relativePath}`);
  }
  if (/\.(?:key|pem|p12|pfx)$/i.test(relativePath)) {
    throw new Error(`Private key material is forbidden: ${relativePath}`);
  }
}

function scanPrivateText(relativePath, bytes) {
  const text = bytes.toString('utf8');
  for (const candidate of privateTextPatterns) {
    if (candidate.pattern.test(text)) {
      throw new Error(`${candidate.label} found in production source ${relativePath}`);
    }
  }
}

async function buildEditorialPreviewAuthority(snapshots) {
  if (new Set(editorialPreviewModeIds).size !== editorialPreviewModeIds.length) {
    throw new Error('Editorial preview mode allowlist contains duplicate IDs');
  }
  if (
    new Set(editorialGenerationModeIds).size !== editorialGenerationModeIds.length
    || editorialGenerationModeIds.some((modeId) => !editorialPreviewModeIds.includes(modeId))
  ) {
    throw new Error('Editorial generation mode allowlist is duplicated or escapes the preview authority');
  }
  const snapshotByPath = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot]));
  const assets = [];
  for (const modeId of editorialPreviewModeIds) {
    const isCreateUniverse = modeId.startsWith('shoot.');
    const sidecarPath = `assets/scene-mood-cards/${modeId}.json`;
    const imagePath = `assets/scene-mood-cards/${modeId}.webp`;
    const promptPath = `prompts/scenes/${modeId}.txt`;
    const sidecarSnapshot = snapshotByPath.get(sidecarPath);
    const imageSnapshot = snapshotByPath.get(imagePath);
    const promptSnapshot = snapshotByPath.get(promptPath);
    if (!sidecarSnapshot || !imageSnapshot || (!isCreateUniverse && !promptSnapshot)) {
      throw new Error(`Editorial preview source set is incomplete: ${modeId}`);
    }

    let sidecar;
    try {
      sidecar = JSON.parse(sidecarSnapshot.bytes.toString('utf8'));
    } catch (error) {
      throw new Error(`Editorial preview sidecar is invalid JSON (${modeId}): ${error.message}`);
    }
    const commonValid = (
      sidecar?.schema_version !== '1.0.0'
      || sidecar.preset_id !== modeId
      || sidecar.kind !== 'editorial'
      || typeof sidecar.ui_name_uk !== 'string'
      || sidecar.ui_name_uk.trim() === ''
      || sidecar.asset_role !== 'mood_card'
      || sidecar.file !== imagePath
      || sidecar.sha256 !== sha256(imageSnapshot.bytes)
      || sidecar.delivery?.width !== 1024
      || sidecar.delivery?.height !== 1280
      || sidecar.delivery?.format !== 'webp'
      || sidecar.delivery?.aspect_ratio !== '4:5'
      || sidecar.contains_personal_input !== false
    );
    const contractInvalid = commonValid || (isCreateUniverse
      ? sidecar.family !== 'create_universe'
      : (
        sidecar.family !== 'edwin_novak'
        || sidecar.prompt_path !== promptPath
        || sidecar.prompt_sha256 !== sha256(promptSnapshot.bytes)
      ));
    if (contractInvalid) {
      throw new Error(`Editorial preview sidecar contract is invalid: ${modeId}`);
    }

    let metadata;
    try {
      const image = sharp(imageSnapshot.bytes, { failOn: 'error', animated: true });
      metadata = await image.metadata();
      await image.stats();
    } catch {
      throw new Error(`Editorial preview is not a decodable WebP image: ${modeId}`);
    }
    if (
      metadata.format !== 'webp'
      || metadata.width !== 1024
      || metadata.height !== 1280
      || (metadata.pages ?? 1) !== 1
    ) {
      throw new Error(`Editorial preview must be one 1024x1280 WebP image: ${modeId}`);
    }

    assets.push({
      mode_id: modeId,
      sidecar_path: sidecarPath,
      sidecar_sha256: sha256(sidecarSnapshot.bytes),
      image_path: imagePath,
      image_sha256: sha256(imageSnapshot.bytes),
      width: 1024,
      height: 1280,
      media_type: 'image/webp',
    });
  }
  return {
    status: 'ACTIVE',
    generation: 'ENABLED',
    mode_ids: [...editorialPreviewModeIds],
    generation_mode_ids: [...editorialGenerationModeIds],
    assets,
  };
}

async function assertAbsent(target) {
  try {
    await lstat(target);
    throw new Error(`Release output already exists: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function snapshotFile(relativePath) {
  assertSafeRelativePath(relativePath);
  const absolutePath = path.join(projectRoot, relativePath);
  const info = await lstat(absolutePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Production source must be a regular non-symlink file: ${relativePath}`);
  }
  if ((info.mode & 0o022) !== 0 || (info.mode & 0o6000) !== 0) {
    throw new Error(`Unsafe production source mode for ${relativePath}: ${modeOf(info)}`);
  }
  const bytes = await readFile(absolutePath);
  scanPrivateText(relativePath, bytes);
  return {
    path: relativePath,
    mode: modeOf(info),
    bytes,
  };
}

async function snapshotDirectory(relativeDirectory) {
  assertSafeRelativePath(relativeDirectory);
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  const directoryInfo = await lstat(absoluteDirectory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error(`Production source root must be a real directory: ${relativeDirectory}`);
  }
  const snapshots = [];
  async function walk(absoluteParent, relativeParent) {
    const entries = (await readdir(absoluteParent, { withFileTypes: true }))
      .sort((left, right) => comparePath(left.name, right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeParent, entry.name);
      assertSafeRelativePath(relativePath);
      const absolutePath = path.join(absoluteParent, entry.name);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) {
        throw new Error(`Production source must not contain symlinks: ${relativePath}`);
      }
      if (info.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (info.isFile()) {
        snapshots.push(await snapshotFile(relativePath));
      } else {
        throw new Error(`Unsupported production source entry: ${relativePath}`);
      }
    }
  }
  await walk(absoluteDirectory, relativeDirectory);
  return snapshots;
}

function sourceDigest(snapshots) {
  const hash = createHash('sha256');
  updateLengthPrefixed(hash, 'zeely-product-source-canonical-cache-v1');
  for (const snapshot of snapshots) {
    const extension = path.posix.extname(snapshot.path).toLowerCase();
    const cacheCanonicalBytes = snapshot.path.startsWith('web/public/')
      && ['.html', '.js', '.css'].includes(extension)
      ? Buffer.from(
        extension === '.html'
          ? bindHtmlAssets(snapshot.bytes.toString('utf8'), '__ZEELY_CACHE_TOKEN__')
          : extension === '.js'
            ? bindJavaScriptModules(snapshot.bytes.toString('utf8'), '__ZEELY_CACHE_TOKEN__')
            : bindCssImports(snapshot.bytes.toString('utf8'), '__ZEELY_CACHE_TOKEN__'),
      )
      : snapshot.bytes;
    updateLengthPrefixed(hash, snapshot.path);
    updateLengthPrefixed(hash, snapshot.mode);
    updateLengthPrefixed(hash, cacheCanonicalBytes);
  }
  return hash.digest('hex');
}

async function writeSnapshot(snapshot) {
  const target = path.join(releaseDirectory, snapshot.path);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, snapshot.bytes, { mode: Number.parseInt(snapshot.mode, 8) });
  await chmod(target, Number.parseInt(snapshot.mode, 8));
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
  const bind = (prefix, pathname, hash = '') => `${prefix}${pathname}?v=${cacheToken}${hash}`;
  return source
    .replace(
      /(\bimport\s*\(\s*["'])((?:\.\.?\/|\/)[^"'?#]+\.js)(?:\?[^"'#]*)?(#[^"']*)?/g,
      (match, prefix, pathname, hash = '') => bind(prefix, pathname, hash),
    )
    .replace(
      /(\b(?:import|export)\s+(?:[^'";]*?\s+\bfrom\s+)?["'])((?:\.\.?\/|\/)[^"'?#]+\.js)(?:\?[^"'#]*)?(#[^"']*)?/g,
      (match, prefix, pathname, hash = '') => bind(prefix, pathname, hash),
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

async function transformBrowserAssets(cacheToken) {
  const publicDirectory = path.join(releaseDirectory, 'web', 'public');
  const transformed = [];
  const entries = (await readdir(publicDirectory, { withFileTypes: true }))
    .sort((left, right) => comparePath(left.name, right.name));
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!['.html', '.js', '.css'].includes(extension)) continue;
    const relativePath = path.posix.join('web/public', entry.name);
    const filename = path.join(publicDirectory, entry.name);
    const original = await readFile(filename, 'utf8');
    const transformedSource = extension === '.html'
      ? bindHtmlAssets(original, cacheToken)
      : extension === '.js'
        ? bindJavaScriptModules(original, cacheToken)
        : bindCssImports(original, cacheToken);
    if (transformedSource === original) continue;
    const info = await lstat(filename);
    await writeFile(filename, transformedSource);
    await chmod(filename, info.mode & 0o777);
    transformed.push(relativePath);
  }
  return transformed;
}

async function releaseInventory(directory, relativeDirectory = '') {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => comparePath(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) throw new Error(`Release contains a symlink: ${relativePath}`);
    if (info.isDirectory()) {
      files.push(...await releaseInventory(absolutePath, relativePath));
      continue;
    }
    if (!info.isFile()) throw new Error(`Unsupported release entry: ${relativePath}`);
    assertSafeRelativePath(relativePath);
    const bytes = await readFile(absolutePath);
    scanPrivateText(relativePath, bytes);
    files.push({
      path: relativePath,
      mode: modeOf(info),
      size_bytes: bytes.byteLength,
      sha256: sha256(bytes),
      deploy: true,
    });
  }
  return files;
}

try {
  const snapshots = [];
  for (const relativeDirectory of directoryRoots) {
    snapshots.push(...await snapshotDirectory(relativeDirectory));
  }
  for (const relativePath of individualFiles) {
    snapshots.push(await snapshotFile(relativePath));
  }
  snapshots.sort((left, right) => comparePath(left.path, right.path));
  const sourcePaths = snapshots.map((snapshot) => snapshot.path);
  if (new Set(sourcePaths).size !== sourcePaths.length) {
    throw new Error('Production source allowlist contains duplicate paths');
  }
  const normalizedSourcePaths = sourcePaths.map((value) => value.normalize('NFC').toLowerCase());
  if (new Set(normalizedSourcePaths).size !== normalizedSourcePaths.length) {
    throw new Error('Production source contains case/Unicode-colliding paths');
  }
  const editorialPreview = await buildEditorialPreviewAuthority(snapshots);

  const digest = sourceDigest(snapshots);
  const { stdout } = await execute('git', ['-C', projectRoot, 'rev-parse', 'HEAD']);
  const baseCommit = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw new Error('Git HEAD is not a full SHA-1');
  const cacheToken = `product-${baseCommit.slice(0, 8)}-${digest.slice(0, 12)}`;

  for (const snapshot of snapshots) await writeSnapshot(snapshot);
  const transformedFiles = await transformBrowserAssets(cacheToken);
  const files = await releaseInventory(releaseDirectory);
  const manifest = {
    schema_version: '1.0.0',
    release: 'PRODUCT_SCENES_V1',
    base_commit: baseCommit,
    cache_token: cacheToken,
    package_type: 'RUNTIME_OVERLAY',
    runtime_state_strategy: 'PRESERVE_EXISTING_RUNTIME_AND_NODE_MODULES',
    features: {
      add_items: 'ENABLED',
      profile: 'ENABLED',
      scene_api: 'ENABLED',
      scene_runtime: 'ENABLED',
      scene_ui: 'ENABLED',
      editorial_preview: 'ACTIVE',
      editorial_generation: 'ENABLED',
    },
    disabled: [],
    source_allowlist: [
      ...directoryRoots.map((entry) => `${entry}/`),
      ...individualFiles,
    ],
    excluded_segments: [...forbiddenSegments].sort(comparePath),
    source_authority: {
      hash_format: 'sha256-length-prefixed-path-mode-canonical-cache-bytes-v1',
      digest_sha256: digest,
      files: snapshots.map((snapshot) => ({
        path: snapshot.path,
        mode: snapshot.mode,
        size_bytes: snapshot.bytes.byteLength,
        sha256: sha256(snapshot.bytes),
      })),
    },
    transformed_files: transformedFiles.sort(comparePath),
    scene_preset_catalog: 'assets/scene-presets/index.json',
    editorial_preview: editorialPreview,
    content_digest_sha256: sha256(Buffer.from(JSON.stringify(files))),
    release_size_bytes: files.reduce((total, file) => total + file.size_bytes, 0),
    deploy_files: files,
  };
  const manifestPath = path.join(releaseDirectory, manifestRelativePath);
  await mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(manifestPath, 0o600);

  await assertAbsent(outputDirectory);
  await rename(releaseDirectory, outputDirectory);
  process.stdout.write(`${outputDirectory}\n`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
