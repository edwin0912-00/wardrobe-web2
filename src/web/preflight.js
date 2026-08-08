import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function run(binary, args, commandRunner) {
  try {
    const result = await commandRunner(binary, args, { timeout: 20_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const stdout = String(result.stdout ?? '').trim();
    return stdout || String(result.stderr ?? '').trim();
  } catch (error) {
    throw new Error(`${binary} preflight failed: ${error.message}`);
  }
}

export async function runLocalPreflight({ commandRunner = execFileAsync, generationMode = 'codex-primary', codexStatus = null } = {}) {
  if (generationMode === 'codex-imagegen-test' || generationMode === 'codex-primary') {
    const [, loginStatus] = await Promise.all([
      run('codex', ['--version'], commandRunner),
      run('codex', ['login', 'status'], commandRunner),
    ]);
    if (!/logged in using chatgpt/i.test(loginStatus)
      || codexStatus?.account?.type !== 'chatgpt'
      || codexStatus?.capabilities?.imageGeneration !== true) {
      throw new Error('Codex imagegen preflight requires ChatGPT login and imageGeneration capability');
    }
    if (generationMode === 'codex-primary' && !String(process.env.OPENROUTER_API_KEY ?? '').trim()) {
      throw new Error('Codex primary preflight requires OPENROUTER_API_KEY for its first fallback');
    }
    // Keep the public health surface generic: it must never disclose the local
    // worker implementation or the authenticated account type.
    return generationMode === 'codex-primary'
      ? {
          status: 'ready',
          generation: 'Codex Image Generation → OpenRouter fallback',
          primary: 'codex',
          fallback: 'openrouter',
          test_only: false,
        }
      : { status: 'ready', generation: 'Codex Image Generation — test only', test_only: true };
  }
  if (generationMode === 'openrouter') {
    // OpenRouter is a plain HTTPS API: there is no local CLI to version-check
    // and no account command to poll, so the only local precondition is the
    // key. OpenRouterImageGenProvider is already wired through
    // generation-provider.js and scene-runtime.js; this branch existed nowhere,
    // so the mode threw here and the service died before it could listen.
    //
    // Deliberately no network probe. Preflight gates process startup, so
    // reaching out to the provider makes a provider outage indistinguishable
    // from a broken deploy. A
    // provider being down must degrade individual jobs, not prevent boot.
    if (!String(process.env.OPENROUTER_API_KEY ?? '').trim()) {
      throw new Error('OpenRouter generation preflight requires OPENROUTER_API_KEY');
    }
    return { status: 'ready', generation: 'OpenRouter Image Generation' };
  }
  throw new Error(`Unsupported generation mode: ${generationMode}`);
}
