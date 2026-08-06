#!/usr/bin/env node
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { installDemoAuth } from '../web/demo-auth.js';
import { MonitorEventStore } from './event-store.js';
import { AgentSupervisor } from './agent-supervisor.js';
import { registerMonitorRoutes } from './routes.js';
import { resolveMonitorRuntimeConfig } from './runtime-config.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const { runtimeRoot, appHealthUrl } = resolveMonitorRuntimeConfig({
  projectRoot,
});
const store = new MonitorEventStore({ filename: path.join(runtimeRoot, 'monitor', 'events.jsonl') });
await store.initialize();
const supervisor = new AgentSupervisor({
  store,
  runsRoot: path.join(runtimeRoot, 'runs'),
  stateRoot: path.join(runtimeRoot, 'supervisor'),
  sourceRoot: process.env.ZEELY_SOURCE_ROOT ?? projectRoot,
  agentEnabled: process.env.ZEELY_SUPERVISOR_AGENT === 'true',
});
await supervisor.start();
const app = Fastify({
  logger: true,
  bodyLimit: 64 * 1024,
  logController: new Fastify.LogController({
    disableRequestLogging: (request) => request.url.split('?')[0] === '/api/health',
  }),
});
const auth = process.env.ZEELY_DEMO_PIN ? {
  pin: process.env.ZEELY_DEMO_PIN,
  secret: process.env.ZEELY_SESSION_SECRET,
  secure: process.env.ZEELY_COOKIE_SECURE !== 'false',
} : null;
installDemoAuth(app, auth);

let appHealth = { status: 'unknown', checked_at: null, detail: null };
async function checkApp() {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(appHealthUrl, { signal: AbortSignal.timeout(5_000) });
    appHealth = { status: response.ok ? 'up' : 'degraded', checked_at: checkedAt, detail: `HTTP ${response.status}` };
  } catch (error) {
    appHealth = { status: 'down', checked_at: checkedAt, detail: error.message.slice(0, 300) };
  }
  return appHealth;
}

await registerMonitorRoutes(app, {
  store,
  statusProvider: async () => ({ status: 'ok', service: 'monitor', uptime_seconds: Math.floor(process.uptime()), app: await checkApp(), supervisor: supervisor.status() }),
});
app.get('/api/health', async () => ({ status: 'ok', service: 'monitor', app: appHealth }));
app.get('/', async (request, reply) => reply.sendFile('monitor.html'));
await app.register(fastifyStatic, { root: path.join(projectRoot, 'web', 'public'), prefix: '/' });

let previousStatus = null;
const heartbeat = async () => {
  const state = await checkApp();
  if (state.status !== previousStatus) {
    await store.append({ source: 'watchdog', type: 'service.app_status', severity: state.status === 'up' ? 'info' : 'error', data: state });
    previousStatus = state.status;
  }
};
await store.append({ source: 'watchdog', type: 'service.monitor_started', data: { pid: process.pid } });
await heartbeat();
const timer = setInterval(() => heartbeat().catch(() => {}), 10_000);
app.addHook('onClose', async () => { clearInterval(timer); await supervisor.close(); });

const port = Number.parseInt(process.env.MONITOR_PORT ?? '4174', 10);
await app.listen({ host: '127.0.0.1', port });
