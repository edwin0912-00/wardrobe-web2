import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function run(binary, args, commandRunner) {
  try {
    const result = await commandRunner(binary, args, { timeout: 20_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`${binary} preflight failed: ${error.message}`);
  }
}

export async function runLocalPreflight({ commandRunner = execFileAsync } = {}) {
  const [codexVersion, higgsfieldVersion, accountResult] = await Promise.all([
    run('codex', ['--version'], commandRunner),
    run('higgsfield', ['--version'], commandRunner),
    run('higgsfield', ['account', 'status', '--json'], commandRunner)
      .then((value) => ({ value })).catch((error) => ({ error })),
  ]);
  if (accountResult.error) return {
    status: 'degraded', codex: codexVersion, higgsfield: higgsfieldVersion,
    higgsfield_account: 'temporarily_unavailable', warning: accountResult.error.message,
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
