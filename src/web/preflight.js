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

export async function runLocalPreflight({ commandRunner = execFileAsync, generationMode = 'higgsfield', codexStatus = null } = {}) {
  if (generationMode === 'codex-imagegen-test') {
    const [, loginStatus] = await Promise.all([
      run('codex', ['--version'], commandRunner),
      run('codex', ['login', 'status'], commandRunner),
    ]);
    if (!/logged in using chatgpt/i.test(loginStatus)
      || codexStatus?.account?.type !== 'chatgpt'
      || codexStatus?.capabilities?.imageGeneration !== true) {
      throw new Error('Codex imagegen preflight requires ChatGPT login and imageGeneration capability');
    }
    // Keep the public health surface generic: it must never disclose the local
    // worker implementation or the authenticated account type.
    return { status: 'ready', generation: 'Codex Image Generation — test only', test_only: true };
  }
  if (generationMode !== 'higgsfield') throw new Error(`Unsupported generation mode: ${generationMode}`);
  const [codexResult, higgsfieldResult, accountResult] = await Promise.allSettled([
    run('codex', ['--version'], commandRunner),
    run('higgsfield', ['--version'], commandRunner),
    run('higgsfield', ['account', 'status', '--json'], commandRunner),
  ]);

  const codexVersion = codexResult.status === 'fulfilled'
    ? codexResult.value
    : 'unavailable';
  const higgsfieldVersion = higgsfieldResult.status === 'fulfilled'
    ? higgsfieldResult.value
    : 'unavailable';
  if (codexResult.status === 'rejected' || higgsfieldResult.status === 'rejected') {
    return {
      status: 'degraded',
      codex: codexVersion,
      higgsfield: higgsfieldVersion,
      higgsfield_account: 'not_checked',
      warning: [codexResult, higgsfieldResult]
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason.message)
        .join('; '),
    };
  }
  if (accountResult.status === 'rejected') return {
    status: 'degraded', codex: codexVersion, higgsfield: higgsfieldVersion,
    higgsfield_account: 'temporarily_unavailable', warning: accountResult.reason.message,
  };
  let account;
  try { account = JSON.parse(accountResult.value); } catch { return { status: 'degraded', codex: codexVersion, higgsfield: higgsfieldVersion, higgsfield_account: 'invalid_response' }; }
  if (!Number.isFinite(account.credits)) return { status: 'degraded', codex: codexVersion, higgsfield: higgsfieldVersion, higgsfield_account: 'not_ready' };
  return {
    status: 'ready',
    codex: codexVersion,
    higgsfield: higgsfieldVersion,
    higgsfield_plan: account.subscription_plan_type,
    higgsfield_credits: account.credits,
  };
}
