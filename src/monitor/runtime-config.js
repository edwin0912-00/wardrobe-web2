import path from 'node:path';

export function resolveMonitorRuntimeConfig({
  env = process.env,
  projectRoot,
} = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw new Error('MONITOR_PROJECT_ROOT_INVALID');
  }
  const runtimeRoot = path.resolve(env.ZEELY_RUNTIME_ROOT ?? path.join(projectRoot, 'runtime'));
  const healthUrl = new URL(env.ZEELY_APP_HEALTH_URL ?? 'http://127.0.0.1:4173/api/health');
  if (healthUrl.protocol !== 'http:'
    || healthUrl.hostname !== '127.0.0.1'
    || healthUrl.username
    || healthUrl.password
    || healthUrl.pathname !== '/api/health'
    || healthUrl.search
    || healthUrl.hash) {
    throw new Error('MONITOR_APP_HEALTH_URL_INVALID');
  }
  return Object.freeze({
    runtimeRoot,
    appHealthUrl: healthUrl.href,
  });
}
