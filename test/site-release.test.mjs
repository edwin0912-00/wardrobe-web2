import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const helperPath = path.join(repoRoot, 'scripts/site-release.py');
const deployScript = path.join(repoRoot, 'scripts/deploy-site.sh');
const python = process.env.PYTHON ?? 'python3';
const mediaSha = 'b'.repeat(64);
const betaIdentity = {
  base_commit: 'a'.repeat(40),
  cache_token: 'product-12345678-abcdef123456',
};
const rootWebFiles = [
  'index.html', 'engine.js', 'ui.js', 'audio.js', 'style.css', 'mobile.css',
  'loader.js', 'media-strategy.js', 'media-preview.js', 'master-cutout.js',
  'screen-surface-math.js', 'screen-surfaces.js', 'client-observer.js',
  'test-audit-client.js', 'serve.py', 'draft-media-store.js', 'drop-upload.js',
  'gate.js', 'image-upload.js', 'thinking-orb.js',
];
const trackedFixtureFiles = [
  ...rootWebFiles,
  'adapters/cinematic-ui-bridge.mjs',
  'vendor/fal-client.js',
  'b/index.html',
  'b/pipeline-deck.js',
  'release/MEDIA.lock.json',
  'package-lock.json',
  'beta/src/web/app.js',
  'beta/node_modules/private-package/index.js',
  'beta/output/private-test-dump.json',
  'test/internal-dump.json',
];
const pythonPrelude = `
import importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('site_release', ${JSON.stringify(helperPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
`;

function runPython(body, args = [], options = {}) {
  return spawnSync(python, ['-c', `${pythonPrelude}\n${body}`, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...options.env },
    ...options,
  });
}

function runPythonAsync(body, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(python, ['-c', `${pythonPrelude}\n${body}`, ...args], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...options.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-site-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const versions = path.join(root, 'Application Support', 'WardrobeRuntime.releases');
  const runtime = path.join(root, 'Application Support', 'WardrobeRuntime');
  await mkdir(repo, { recursive: true });
  for (const relative of trackedFixtureFiles) {
    const target = path.join(repo, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `tracked:${relative}\n`);
  }
  await writeFile(path.join(repo, 'b/index.html'), [
    '<link rel="stylesheet" href="../style.css">',
    '<script src="../engine.js"></script>',
    '<script src="pipeline-deck.js"></script>',
    '<video data-src="assets/intro.mp4" poster="assets/intro-poster.jpg"></video>',
    '<video data-src="assets/seg2.mp4"></video>',
  ].join('\n'));
  await writeFile(path.join(repo, 'style.css'), 'body { background-image: url("b/assets/intro-poster.jpg"); }\n');
  const requiredFiles = ['b/assets/intro.mp4', 'b/assets/seg1.mp4', 'b/audio/t1.mp3', 'beta/output/private-test-dump.json'];
  await writeFile(path.join(repo, 'release/MEDIA.lock.json'), JSON.stringify({
    bundle: 'fixture-media.tar', sha256: mediaSha, required_files: requiredFiles,
  }));
  await writeFile(path.join(repo, '.wardrobe-media-bundle.json'), JSON.stringify({
    bundle: 'fixture-media.tar', sha256: mediaSha,
  }));
  const mediaFiles = [
    'b/assets/intro.mp4', 'b/assets/seg1.mp4', 'b/assets/seg2.mp4',
    'b/assets/seg3.mp4', 'b/assets/seg4.mp4', 'b/assets/intro-poster.jpg', 'b/audio/t1.mp3',
  ];
  for (const [index, relative] of mediaFiles.entries()) {
    const target = path.join(repo, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(`locked-media-${index}-${relative}`));
  }
  const tracked = [...trackedFixtureFiles];
  const sourceSha = 'a'.repeat(40);
  return { root, repo, versions, runtime, tracked, sourceSha, mediaFiles };
}

function build(fixtureData) {
  const result = runPython([
    `result = module.build_artifact(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], tracked=json.loads(sys.argv[4])); print(json.dumps({'path': str(result)}))`,
  ][0], [fixtureData.repo, fixtureData.versions, fixtureData.sourceSha, JSON.stringify(fixtureData.tracked)]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).path;
}

function plist(label, programArguments, workingDirectory = null) {
  const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const cwd = workingDirectory ? `<key>WorkingDirectory</key><string>${escape(workingDirectory)}</string>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${escape(label)}</string>${cwd}<key>ProgramArguments</key><array>${programArguments.map((arg) => `<string>${escape(arg)}</string>`).join('')}</array></dict></plist>`;
}

async function betaRunnerFixture(fixtureData, identity = betaIdentity) {
  const appRoot = path.join(fixtureData.root, 'beta-release');
  const runner = path.join(fixtureData.root, 'run-beta-daemon.sh');
  const betaPlist = path.join(fixtureData.root, 'com.madeforthisjob.beta.plist');
  await mkdir(path.join(appRoot, 'ops'), { recursive: true });
  await writeFile(path.join(appRoot, 'ops/product-release-manifest.json'), JSON.stringify(identity));
  await writeFile(runner, `app_root="${appRoot}"\nruntime_root="${path.join(fixtureData.root, 'beta-runtime')}"\n`);
  await writeFile(betaPlist, plist('com.madeforthisjob.beta', ['/bin/sh', runner]));
  return { appRoot, runner, betaPlist };
}

async function sitePlistFixture(fixtureData, siteLabel = 'com.madeforthisjob.web2') {
  const sitePlistPath = path.join(fixtureData.root, 'com.madeforthisjob.web2.plist');
  await writeFile(sitePlistPath, plist(siteLabel, ['/usr/bin/python3', 'serve.py', '4180'], fixtureData.runtime));
  return sitePlistPath;
}

test('real tracked root browser sources include all root HTML/JS/CSS modules and exclude engine/private trees', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot }).toString().split('\0').filter(Boolean);
  const result = runPython(
    `paths = module.select_tracked_site_sources(json.loads(sys.argv[1]))
media = set()
for relative in paths:
    if Path(relative).suffix.lower() in {'.html', '.htm', '.css', '.js', '.mjs'}:
        content = (Path(${JSON.stringify(repoRoot)}) / relative).read_text(encoding='utf-8', errors='replace')
        media.update(target for target in module._local_reference_paths(relative, content) if target.startswith(module.MEDIA_PREFIXES))
module.validate_local_site_references(Path(${JSON.stringify(repoRoot)}), paths, sorted(media))
print(json.dumps(paths))`,
    [JSON.stringify(tracked)],
  );
  assert.equal(result.status, 0, result.stderr);
  const selected = new Set(JSON.parse(result.stdout));
  for (const pathName of tracked.filter((file) => !file.includes('/') && /\.(?:html|js|css)$/i.test(file))) {
    assert.ok(selected.has(pathName), `tracked root web dependency omitted: ${pathName}`);
  }
  for (const dependency of ['draft-media-store.js', 'drop-upload.js', 'gate.js', 'image-upload.js', 'thinking-orb.js', 'serve.py']) {
    assert.ok(selected.has(dependency), `browser dependency omitted: ${dependency}`);
  }
  const html = readFileSync(path.join(repoRoot, 'b/index.html'), 'utf8');
  const staticRefs = [...html.matchAll(/(?:src|href|poster|data-src)\s*=\s*['"]([^'"]+)['"]/gi)]
    .map((match) => match[1].split(/[?#]/, 1)[0])
    .filter((value) => value && !value.startsWith('/') && !/^[a-z]+:/i.test(value));
  for (const reference of staticRefs) {
    const resolved = path.posix.normalize(path.posix.join('b', path.posix.dirname('index.html'), reference));
    if (resolved.startsWith('b/assets/') || resolved.startsWith('b/audio/')) continue;
    assert.ok(selected.has(resolved), `static HTML dependency omitted: ${reference} -> ${resolved}`);
  }
  assert.ok(![...selected].some((file) => file.startsWith('beta/') || file.startsWith('test/')));
  assert.ok(![...selected].includes('package-lock.json'));
});

test('artifact contains only allowlisted site source and verified locked B media', async (t) => {
  const data = await fixture(t);
  const artifact = build(data);
  const manifest = JSON.parse(await readFile(path.join(artifact, 'site-release.json'), 'utf8'));
  const filePaths = manifest.files.map(({ path: file }) => file);
  assert.ok(filePaths.includes('b/assets/intro.mp4'));
  assert.ok(filePaths.includes('b/assets/intro-poster.jpg'));
  assert.ok(filePaths.includes('b/audio/t1.mp3'));
  assert.ok(filePaths.includes('draft-media-store.js'));
  assert.ok(filePaths.includes('thinking-orb.js'));
  assert.ok(!filePaths.some((file) => file.startsWith('beta/') || file.startsWith('test/')));
  assert.ok(!filePaths.includes('package-lock.json'));
  assert.ok(!filePaths.includes('.wardrobe-media-bundle.json'));
  const checked = runPython('module.verify_artifact(Path(sys.argv[1])); print("verified")', [artifact]);
  assert.equal(checked.status, 0, checked.stderr);
});

test('site artifact builder rejects unexpected source symlinks', async (t) => {
  const data = await fixture(t);
  const target = path.join(data.repo, 'b/assets/escape-target.mp4');
  const link = path.join(data.repo, 'b/assets/unexpected.mp4');
  await writeFile(target, 'private target');
  await symlink('escape-target.mp4', link);
  const result = runPython(
    'module.build_artifact(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], tracked=json.loads(sys.argv[4]))',
    [data.repo, data.versions, data.sourceSha, JSON.stringify(data.tracked)],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink is refused/);
});

test('local and public static verification checks health identity, manifest hashes, and byte ranges', async (t) => {
  const data = await fixture(t);
  const artifact = build(data);
  let staleEngine = false;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname.replace(/^\//, '');
    if (pathname === 'api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ready', release_sha: betaIdentity.base_commit, cache_token: betaIdentity.cache_token }));
      return;
    }
    const body = pathname === 'engine.js' && staleEngine
      ? Buffer.from('stale engine')
      : await readFile(path.join(artifact, pathname));
    const range = request.headers.range;
    if (range) {
      const [, startText, endText] = range.match(/^bytes=(\d+)-(\d+)$/) ?? [];
      const start = Number(startText);
      const end = Math.min(Number(endText), body.length - 1);
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Content-Length': end - start + 1,
      });
      response.end(body.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { 'Content-Length': body.length });
    response.end(body);
  });
  t.after(() => server.close());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const verify = await runPythonAsync(
    'module.verify_http_origin(sys.argv[1], Path(sys.argv[2]), json.loads(sys.argv[3])); print("verified")',
    [origin, artifact, JSON.stringify(betaIdentity)],
  );
  assert.equal(verify.status, 0, verify.stderr);

  staleEngine = true;
  const stale = await runPythonAsync(
    'module.verify_http_origin(sys.argv[1], Path(sys.argv[2]), json.loads(sys.argv[3]))',
    [origin, artifact, JSON.stringify(betaIdentity)],
  );
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /static SHA-256 mismatch/);

  const wrongIdentity = runPython(
    'module.verify_http_origin(sys.argv[1], Path(sys.argv[2]), json.loads(sys.argv[3]), readiness_timeout=0.01)',
    [origin, artifact, JSON.stringify({ ...betaIdentity, base_commit: 'f'.repeat(40) })],
  );
  assert.notEqual(wrongIdentity.status, 0);
  assert.match(wrongIdentity.stderr, /expected beta release/);
});

test('stale artifact after switch rolls back the exact previous runtime and keeps the new artifact', async (t) => {
  const data = await fixture(t);
  const beta = await betaRunnerFixture(data);
  const sitePlistPath = await sitePlistFixture(data);
  await mkdir(data.runtime, { recursive: true });
  await writeFile(path.join(data.runtime, 'sentinel.bin'), 'previous runtime bytes');
  await writeFile(path.join(data.runtime, 'serve.py'), 'previous gateway bytes');
  const script = `
restarts = []
origin_checks = []
def restart():
    restarts.append(True)
    if len(restarts) == 1:
        (Path(sys.argv[3]) / sys.argv[4] / 'engine.js').write_text('stale after activation')
def verify(origin, artifact, identity):
    origin_checks.append((origin, identity['base_commit'], identity['cache_token']))
try:
    result = module.deploy_site(
        Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4],
        Path(sys.argv[5]), 'com.madeforthisjob.web2', Path(sys.argv[6]), Path(sys.argv[7]),
        'http://local.test', 'https://public.test', restart=restart,
        active_work_check=lambda: [], verify_origin=verify,
        tracked=json.loads(sys.argv[8]),
    )
    print(json.dumps({'ok': True, 'result': result, 'restarts': len(restarts)}))
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error), 'restarts': len(restarts), 'origin_checks': origin_checks}))
`;
  const result = runPython(script, [
    data.repo,
    data.runtime,
    data.versions,
    data.sourceSha,
    sitePlistPath,
    beta.betaPlist,
    beta.runner,
    JSON.stringify(data.tracked),
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.match(report.error, /SHA-256 mismatch/);
  assert.equal(report.restarts, 2);
  assert.deepEqual(report.origin_checks, []);
  assert.equal(await readFile(path.join(data.runtime, 'sentinel.bin'), 'utf8'), 'previous runtime bytes');
  assert.equal(await readFile(path.join(data.runtime, 'serve.py'), 'utf8'), 'previous gateway bytes');
  assert.ok(!((await import('node:fs')).lstatSync(data.runtime).isSymbolicLink()));
  assert.ok(await readFile(path.join(data.versions, data.sourceSha, 'engine.js'), 'utf8').then((value) => value.includes('stale after activation')));
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(data.versions));
  assert.ok(entries.some((entry) => entry.startsWith('failed-pointer-')));
});

test('successful activation leaves the prior runtime as an exact rollback sibling', async (t) => {
  const data = await fixture(t);
  const beta = await betaRunnerFixture(data);
  const sitePlistPath = await sitePlistFixture(data);
  await mkdir(data.runtime, { recursive: true });
  await writeFile(path.join(data.runtime, 'sentinel.bin'), 'old exact tree');
  const source = `
result = module.deploy_site(
    Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4],
    Path(sys.argv[5]), 'com.madeforthisjob.web2', Path(sys.argv[6]), Path(sys.argv[7]),
    'http://local.test', 'https://public.test', restart=lambda: None, active_work_check=lambda: [],
    verify_origin=lambda _origin, _artifact, identity: (_ for _ in ()).throw(Exception('wrong identity')) if identity != json.loads(sys.argv[8]) else None,
    tracked=json.loads(sys.argv[9]),
)
print(json.dumps(result))
`;
  const result = runPython(source, [
    data.repo, data.runtime, data.versions, data.sourceSha,
    sitePlistPath, beta.betaPlist, beta.runner,
    JSON.stringify(betaIdentity), JSON.stringify(data.tracked),
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.state, 'ACTIVE');
  assert.ok((await import('node:fs')).lstatSync(data.runtime).isSymbolicLink());
  const previous = report.previous_backup;
  assert.ok(previous);
  assert.equal(await readFile(path.join(previous, 'sentinel.bin'), 'utf8'), 'old exact tree');
});

test('beta release SHA mismatch refuses before runtime switch or restart', async (t) => {
  const data = await fixture(t);
  const wrongIdentity = { ...betaIdentity, base_commit: 'd'.repeat(40) };
  const beta = await betaRunnerFixture(data, wrongIdentity);
  const sitePlistPath = await sitePlistFixture(data);
  await mkdir(data.runtime, { recursive: true });
  await writeFile(path.join(data.runtime, 'sentinel.bin'), 'old runtime');
  const script = `
restarts = []
try:
    module.deploy_site(
        Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4],
        Path(sys.argv[5]), 'com.madeforthisjob.web2', Path(sys.argv[6]), Path(sys.argv[7]),
        'http://local.test', 'https://public.test', restart=lambda: restarts.append(True),
        active_work_check=lambda: [], tracked=json.loads(sys.argv[8]),
    )
    print(json.dumps({'ok': True, 'restarts': len(restarts)}))
except Exception as error:
    print(json.dumps({'ok': False, 'restarts': len(restarts), 'error': str(error)}))
`;
  const result = runPython(script, [
    data.repo, data.runtime, data.versions, data.sourceSha,
    sitePlistPath, beta.betaPlist, beta.runner, JSON.stringify(data.tracked),
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.match(report.error, /does not match the selected alpha source SHA/);
  assert.equal(report.restarts, 0);
  assert.ok(!(await import('node:fs')).lstatSync(data.runtime).isSymbolicLink());
  assert.equal(await readFile(path.join(data.runtime, 'sentinel.bin'), 'utf8'), 'old runtime');
});

test('configured active beta work blocks the main gateway restart', async (t) => {
  const data = await fixture(t);
  const beta = await betaRunnerFixture(data);
  const sitePlistPath = await sitePlistFixture(data);
  const betaTools = path.join(data.repo, 'beta/tools');
  await mkdir(path.join(betaTools, 'lib'), { recursive: true });
  await copyFile(path.join(repoRoot, 'beta/tools/deploy-beta-release.mjs'), path.join(betaTools, 'deploy-beta-release.mjs'));
  await copyFile(path.join(repoRoot, 'beta/tools/lib/deployment-target.mjs'), path.join(betaTools, 'lib/deployment-target.mjs'));
  const activeRun = path.join(data.root, 'beta-runtime/runs/run-in-flight');
  await mkdir(activeRun, { recursive: true });
  await writeFile(path.join(activeRun, 'run.json'), JSON.stringify({ run_id: 'run-in-flight', status: 'RUNNING' }));
  await mkdir(data.runtime, { recursive: true });
  await writeFile(path.join(data.runtime, 'sentinel.bin'), 'runtime unchanged');
  const script = `
restarts = []
try:
    module.deploy_site(
        Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4],
        Path(sys.argv[5]), 'com.madeforthisjob.web2', Path(sys.argv[6]), Path(sys.argv[7]),
        'http://local.test', 'https://public.test', restart=lambda: restarts.append(True),
        tracked=json.loads(sys.argv[8]),
    )
    print(json.dumps({'ok': True, 'restarts': len(restarts)}))
except Exception as error:
    print(json.dumps({'ok': False, 'restarts': len(restarts), 'error': str(error)}))
`;
  const result = runPython(script, [
    data.repo, data.runtime, data.versions, data.sourceSha,
    sitePlistPath, beta.betaPlist, beta.runner, JSON.stringify(data.tracked),
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.match(report.error, /run:run-in-flight/);
  assert.equal(report.restarts, 0);
  assert.ok(!(await import('node:fs')).lstatSync(data.runtime).isSymbolicLink());
  assert.equal(await readFile(path.join(data.runtime, 'sentinel.bin'), 'utf8'), 'runtime unchanged');
});

test('deploy script refuses dirty or non-parity source before verification/deployment commands', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-site-deploy-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  const bin = path.join(root, 'bin');
  await mkdir(scripts, { recursive: true });
  await mkdir(bin);
  await writeFile(path.join(scripts, 'deploy-site.sh'), await readFile(deployScript));
  await chmod(path.join(scripts, 'deploy-site.sh'), 0o755);
  const gateLog = path.join(root, 'gate.log');
  const gitLog = path.join(root, 'git.log');
  await writeFile(path.join(root, 'verify'), `#!/bin/sh\necho verify >> "$GATE_LOG"\n`, { mode: 0o755 });
  await writeFile(path.join(scripts, 'site-preflight.sh'), `#!/bin/sh\necho preflight >> "$GATE_LOG"\n`, { mode: 0o755 });
  const fakeGit = path.join(bin, 'git');
  await writeFile(fakeGit, [
    '#!/bin/sh',
    'echo "$*" >> "$GIT_LOG"',
    'case "$1" in',
    '  branch) echo "${FAKE_BRANCH:-alpha}" ;;',
    '  status) printf "%s" "${FAKE_DIRTY:-}" ;;',
    '  fetch) exit 0 ;;',
    '  rev-parse) case "$2" in',
    '    --abbrev-ref) echo origin/alpha ;;',
    '    HEAD) echo "${FAKE_HEAD:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;',
    '    origin/alpha) echo "${FAKE_REMOTE:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;',
    '  esac ;;',
    '  *) exit 2 ;;',
    'esac',
    '',
  ].join('\n'));
  await chmod(fakeGit, 0o755);
  const baseEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    WARDROBE_GIT: fakeGit,
    WARDROBE_BETA_RUNNER: path.join(root, 'runner.sh'),
    WARDROBE_SITE_PLIST: path.join(root, 'site.plist'),
    WARDROBE_BETA_PLIST: path.join(root, 'beta.plist'),
    GIT_LOG: gitLog,
    GATE_LOG: gateLog,
  };
  const run = (extra = {}) => spawnSync('/bin/sh', [path.join(scripts, 'deploy-site.sh')], { cwd: root, encoding: 'utf8', env: { ...baseEnv, ...extra } });

  const dirty = run({ FAKE_DIRTY: ' M engine.js' });
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /worktree is dirty/);
  await assert.rejects(readFile(gateLog));

  const sourceMismatch = run({ FAKE_HEAD: 'a'.repeat(40), FAKE_REMOTE: 'b'.repeat(40) });
  assert.notEqual(sourceMismatch.status, 0);
  assert.match(sourceMismatch.stderr, /not origin\/alpha/);
  await assert.rejects(readFile(gateLog));
  assert.match(await readFile(gitLog, 'utf8'), /fetch origin alpha/);
});
