import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const TERMINAL_PROBLEMS = new Set(['FAILED', 'NEEDS_INPUT']);
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filename);
}

function phaseComment(run) {
  if (run.status === 'NEEDS_INPUT') return `Зупинка на ${run.phase}: ${run.message}. Це не зависання; supervisor відкрив incident і перевіряє, чи input справді недостатній, чи правило pipeline помилкове.`;
  if (run.status === 'FAILED') return `Помилка на ${run.inner_state ?? run.phase}: ${run.message}. Incident зафіксовано; запускається окремий bug-hunt.`;
  if (run.status === 'COMPLETED') return 'Run завершився: усі обов’язкові outputs пройшли pipeline та QA.';
  const comments = {
    UPLOADED: 'Файли повністю збережені сервером. Далі мережевий upload уже не бере участі.',
    GARMENT_CONDITIONING: 'VLM зараз класифікує речі, групує кілька ракурсів однієї речі та готує canonical references.',
    CORE_PIPELINE: 'Canonical references готові; почалась генерація avatar/outfit із checkpoint та QA.',
    OPTIONAL_SCENE: 'Core outputs готові; створюється необов’язкова Art Director scene.',
  };
  return comments[run.inner_state ?? run.phase] ?? `Pipeline перейшов у ${run.inner_state ?? run.phase}: ${run.message}`;
}

export class AgentSupervisor {
  constructor({ store, runsRoot, stateRoot, sourceRoot, clock = () => new Date(), agentEnabled = false }) {
    this.store = store;
    this.runsRoot = path.resolve(runsRoot);
    this.stateRoot = path.resolve(stateRoot);
    this.sourceRoot = path.resolve(sourceRoot);
    this.clock = clock;
    this.agentEnabled = agentEnabled;
    this.statePath = path.join(this.stateRoot, 'state.json');
    this.state = { version: 1, last_event_id: null, started_at: null, incidents: {}, active_incident: null };
    this.timer = null;
    this.runningAgent = null;
  }

  async initialize() {
    await mkdir(path.join(this.stateRoot, 'incidents'), { recursive: true });
    try { this.state = JSON.parse(await readFile(this.statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.state.started_at = this.state.started_at ?? this.clock().toISOString();
    await atomicJson(this.statePath, this.state);
  }

  status() {
    return { status: 'up', agent_enabled: this.agentEnabled, active_incident: this.state.active_incident,
      incidents_seen: Object.keys(this.state.incidents).length, started_at: this.state.started_at };
  }

  async start() {
    await this.initialize();
    await this.tick();
    this.timer = setInterval(() => this.tick().catch(() => {}), 1_000);
  }

  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async #readRun(runId) {
    if (!/^[0-9a-f-]{36}$/i.test(runId ?? '')) return null;
    try { return JSON.parse(await readFile(path.join(this.runsRoot, runId, 'run.json'), 'utf8')); } catch { return null; }
  }

  async #comment(run, message, severity = 'info', type = 'agent.comment') {
    await this.store.append({ source: 'agent', type, severity, run_id: run?.run_id,
      data: { stage: run?.inner_state ?? run?.phase, status: run?.status, message } });
  }

  async #openIncident(run, event, historical) {
    const key = fingerprint(`${run.status}|${run.phase}|${run.error?.name ?? ''}|${run.message}`);
    const known = this.state.incidents[key];
    if (known) return;
    const incident = { id: key, run_id: run.run_id, status: historical ? 'observed' : 'open', attempts: known?.attempts ?? 0,
      created_at: this.clock().toISOString(), trigger_event_id: event.id,
      summary: { status: run.status, phase: run.phase, message: run.message, error_name: run.error?.name ?? null } };
    this.state.incidents[key] = incident;
    const incidentPath = path.join(this.stateRoot, 'incidents', `${key}.json`);
    await atomicJson(incidentPath, incident);
    await this.#comment(run, `Incident ${key} створено: ${run.message}`, 'error', 'agent.incident_opened');
    if (!historical && this.agentEnabled) this.#runAgent(incident, incidentPath).catch(() => {});
  }

  async #runAgent(incident, incidentPath) {
    if (this.runningAgent || this.state.active_incident) return;
    const { stdout: status } = await execute('git', ['status', '--porcelain'], { cwd: this.sourceRoot, timeout: 10_000 });
    if (status.trim()) {
      await this.store.append({ source: 'agent', type: 'agent.repair_queued', severity: 'warn', run_id: incident.run_id,
        data: { message: `Incident ${incident.id} очікує чистий Git workspace; автоматичний patch не запущено.` } });
      return;
    }
    incident.attempts += 1;
    this.state.active_incident = incident.id;
    await atomicJson(this.statePath, this.state);
    const outputPath = path.join(this.stateRoot, 'incidents', `${incident.id}-agent-result.md`);
    const prompt = [
      'You are the isolated Zeely production bug-hunt subagent.',
      `Read the sanitized incident JSON at ${incidentPath}.`,
      'Inspect source code and technical JSON/event logs only. Never open or transmit runtime images, .env files, secrets/**, keys, cookies, credentials, or personal data.',
      'First decide whether this is a real code defect or correct NEEDS_INPUT. If correct behavior, make no code changes and explain why.',
      'If it is a code defect: reproduce it with a deterministic test, implement the smallest root-cause fix, run targeted tests and npm test.',
      'Do not change model policy, secrets, runtime user data, deployment configuration, or unrelated files. Do not commit, push, deploy, restart, or delete anything.',
      'Finish with exact evidence: root cause, changed files, test commands/results, and whether the patch is safe to review.',
    ].join('\n');
    await this.store.append({ source: 'agent', type: 'agent.repair_started', severity: 'warn', run_id: incident.run_id,
      data: { message: `Codex bug-hunt ${incident.id} запущено, attempt ${incident.attempts}/3.` } });
    this.runningAgent = execute('codex', ['exec', prompt, '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--model', 'gpt-5.6-terra', '--output-last-message', outputPath, '-C', this.sourceRoot],
      { cwd: this.sourceRoot, timeout: 45 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    try {
      await this.runningAgent;
      incident.status = 'review_required';
      await this.store.append({ source: 'agent', type: 'agent.repair_result', severity: 'warn', run_id: incident.run_id,
        data: { message: `Bug-hunt ${incident.id} повернув результат. Patch залишено у source workspace для незалежних тестів і review; автоматичного deploy немає.` } });
    } catch (error) {
      incident.status = incident.attempts >= 3 ? 'stopped' : 'failed';
      await this.store.append({ source: 'agent', type: 'agent.repair_failed', severity: 'error', run_id: incident.run_id,
        data: { message: `Bug-hunt ${incident.id} завершився помилкою: ${error.message.slice(0, 500)}` } });
    } finally {
      this.runningAgent = null;
      this.state.active_incident = null;
      await atomicJson(incidentPath, incident);
      await atomicJson(this.statePath, this.state);
    }
  }

  async #detectStalls() {
    let entries;
    try { entries = await readdir(this.runsRoot, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const run = await this.#readRun(entry.name);
      if (!run || run.status !== 'RUNNING') continue;
      const limit = run.phase === 'GARMENT_CONDITIONING' ? 8 * 60_000 : 25 * 60_000;
      if (this.clock().valueOf() - Date.parse(run.updated_at) <= limit) continue;
      const key = fingerprint(`stall|${run.run_id}|${run.phase}|${run.updated_at}`);
      if (this.state.incidents[key]) continue;
      this.state.incidents[key] = { id: key, run_id: run.run_id, status: 'open', attempts: 0, created_at: this.clock().toISOString() };
      await this.#comment(run, `Stall: ${run.phase} не змінював persisted state понад ${Math.round(limit / 60_000)} хвилин.`, 'error', 'agent.stall_detected');
    }
  }

  async tick() {
    const events = await this.store.tail(500);
    const found = this.state.last_event_id ? events.findIndex((event) => event.id === this.state.last_event_id) : -1;
    const start = found >= 0 ? found + 1 : Math.max(0, events.length - 50);
    const historicalCutoff = Date.parse(this.state.started_at);
    for (const event of events.slice(start)) {
      this.state.last_event_id = event.id;
      if (event.source !== 'runner' || event.type !== 'run.phase' || !event.run_id) continue;
      const persisted = await this.#readRun(event.run_id);
      if (!persisted) continue;
      const run = { ...persisted, status: event.data?.status ?? persisted.status, phase: event.data?.stage ?? persisted.phase,
        inner_state: null, message: event.data?.message ?? persisted.message };
      const historical = Date.parse(event.at) < historicalCutoff;
      await this.#comment(run, phaseComment(run), TERMINAL_PROBLEMS.has(run.status) ? 'error' : 'info');
      if (TERMINAL_PROBLEMS.has(run.status)) await this.#openIncident(run, event, historical);
    }
    await this.#detectStalls();
    await atomicJson(this.statePath, this.state);
  }
}
