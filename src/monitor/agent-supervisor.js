import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const TERMINAL_PROBLEMS = new Set(['FAILED', 'NEEDS_INPUT']);
const RETRYABLE_INCIDENTS = new Set(['open', 'queued', 'failed']);
const AGENT_TIMEOUT_MS = 12 * 60_000;
const DEFAULT_LEASE_MS = AGENT_TIMEOUT_MS + 60_000;
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filename);
}

function phaseComment(run) {
  if (run.status === 'NEEDS_INPUT') return `Зупинка на ${run.phase}: ${run.message}. Це не зависання; supervisor відкрив incident і перевіряє, чи input справді недостатній, чи правило pipeline помилкове.`;
  if (run.status === 'FAILED') return `Помилка на ${run.inner_state ?? run.phase}: ${run.message}. Incident зафіксовано; запускається окремий bug-hunt.`;
  if (run.status === 'COMPLETED') return 'Run завершився: усі обов’язкові outputs пройшли pipeline та QA.';
  const comments = {
    UPLOADED: 'Файли повністю збережені сервером. Далі мережевий upload уже не бере участі.',
    GARMENT_CONDITIONING: 'VLM визначає категорію кожної речі й фіксує лише видимі характеристики у картці речі.',
    GARMENT_GROUPING: 'VLM завершив класифікацію: фото об’єднані у групи ракурсів тієї самої речі.',
    GARMENT_GENERATING: 'Створено задачу провайдера для підготовки еталонного зображення речі; supervisor стежить за журналом, повторного запуску не буде.',
    GARMENT_QA: 'Підготовлену річ завантажено; VLM порівнює її з усіма вихідними ракурсами.',
    CORE_PIPELINE: 'Еталонні референси готові; почалась генерація аватара й образу з checkpoint та QA.',
    OPTIONAL_SCENE: 'Core outputs готові; створюється необов’язковий editorial still.',
  };
  return comments[run.inner_state ?? run.phase] ?? `Pipeline перейшов у ${run.inner_state ?? run.phase}: ${run.message}`;
}

export class AgentSupervisor {
  constructor({
    store,
    runsRoot,
    stateRoot,
    sourceRoot,
    clock = () => new Date(),
    agentEnabled = false,
    executor = execute,
    gitStatus = null,
    leaseMs = DEFAULT_LEASE_MS,
  }) {
    this.store = store;
    this.runsRoot = path.resolve(runsRoot);
    this.stateRoot = path.resolve(stateRoot);
    this.sourceRoot = path.resolve(sourceRoot);
    this.clock = clock;
    this.agentEnabled = agentEnabled;
    this.executor = executor;
    this.gitStatus = gitStatus ?? (async () => {
      const { stdout } = await execute('git', ['status', '--porcelain'], { cwd: this.sourceRoot, timeout: 10_000 });
      return { clean: !stdout.trim() };
    });
    this.leaseMs = leaseMs;
    this.ownerId = fingerprint(`${process.pid}|${this.clock().toISOString()}|${Math.random()}`);
    this.statePath = path.join(this.stateRoot, 'state.json');
    this.state = { version: 2, last_event_id: null, started_at: null, incidents: {}, active_incident: null, active_lease: null };
    this.timer = null;
    this.runningAgent = null;
    this.runningIncidentId = null;
    this.dispatchChain = Promise.resolve();
    this.closed = false;
  }

  async initialize() {
    await mkdir(path.join(this.stateRoot, 'incidents'), { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.statePath, 'utf8'));
      this.state = {
        ...this.state,
        ...saved,
        version: 2,
        incidents: saved.incidents && typeof saved.incidents === 'object' ? saved.incidents : {},
        active_lease: saved.active_lease ?? null,
      };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.state.started_at = this.state.started_at ?? this.clock().toISOString();
    await this.#reconcileActiveIncident();
    await atomicJson(this.statePath, this.state);
    await this.#dispatchNext();
  }

  status() {
    return { status: 'up', agent_enabled: this.agentEnabled, active_incident: this.state.active_incident,
      incidents_seen: Object.keys(this.state.incidents).length, started_at: this.state.started_at };
  }

  async start() {
    this.closed = false;
    await this.initialize();
    await this.tick();
    this.timer = setInterval(() => this.tick().catch(() => {}), 1_000);
  }

  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; this.closed = true; }

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
    const incident = { id: key, run_id: run.run_id, status: historical ? 'observed' : 'queued', attempts: known?.attempts ?? 0,
      created_at: this.clock().toISOString(), trigger_event_id: event.id,
      summary: { status: run.status, phase: run.phase, message: run.message, error_name: run.error?.name ?? null } };
    this.state.incidents[key] = incident;
    const incidentPath = path.join(this.stateRoot, 'incidents', `${key}.json`);
    await atomicJson(incidentPath, incident);
    await this.#comment(run, `Incident ${key} створено: ${run.message}`, 'error', 'agent.incident_opened');
  }

  #incidentPath(incidentId) {
    return path.join(this.stateRoot, 'incidents', `${incidentId}.json`);
  }

  #leaseIsLive(incidentId) {
    const lease = this.state.active_lease;
    return lease?.incident_id === incidentId
      && lease.owner_id === this.ownerId
      && Number.isFinite(Date.parse(lease.expires_at))
      && Date.parse(lease.expires_at) > this.clock().valueOf();
  }

  async #reconcileActiveIncident() {
    const activeId = this.state.active_incident;
    if (!activeId) {
      this.state.active_lease = null;
      return;
    }
    if (this.runningAgent && this.runningIncidentId === activeId) return;
    if (this.#leaseIsLive(activeId)) return;

    const incident = this.state.incidents[activeId];
    if (incident) {
      if ((incident.attempts ?? 0) >= 3) {
        incident.status = 'stopped';
        incident.queue_reason = 'attempt_limit';
      } else if (!['observed', 'review_required', 'stopped'].includes(incident.status)) {
        incident.status = 'queued';
        incident.queue_reason = 'restart_recovery';
      }
      await atomicJson(this.#incidentPath(activeId), incident);
      await this.store.append({ source: 'agent', type: 'agent.repair_requeued', severity: 'warn', run_id: incident.run_id,
        data: { message: `Stale supervisor lock for incident ${activeId} released; incident returned to the FIFO queue.` } });
    }
    this.state.active_incident = null;
    this.state.active_lease = null;
  }

  async #isGitClean() {
    const result = await this.gitStatus({ sourceRoot: this.sourceRoot });
    if (typeof result === 'boolean') return result;
    if (typeof result === 'string') return !result.trim();
    if (typeof result?.clean === 'boolean') return result.clean;
    return !(result?.stdout ?? '').trim();
  }

  #dispatchNext() {
    if (!this.agentEnabled || this.closed) return Promise.resolve();
    this.dispatchChain = this.dispatchChain
      .then(() => this.#dispatchOnce())
      .catch(async (error) => {
        await this.store.append({ source: 'agent', type: 'agent.dispatch_failed', severity: 'error',
          data: { message: `Supervisor dispatch failed: ${(error?.message ?? String(error)).slice(0, 500)}` } });
      });
    return this.dispatchChain;
  }

  async #dispatchOnce() {
    if (this.runningAgent) return;
    await this.#reconcileActiveIncident();
    if (this.state.active_incident) return;

    const incident = Object.values(this.state.incidents)
      .filter((candidate) => RETRYABLE_INCIDENTS.has(candidate.status) && (candidate.attempts ?? 0) < 3)
      .sort((left, right) => {
        const timestampDifference = Date.parse(left.created_at) - Date.parse(right.created_at);
        return timestampDifference || left.id.localeCompare(right.id);
      })[0];
    if (!incident) return;

    let clean;
    try {
      clean = await this.#isGitClean();
    } catch (error) {
      const shouldNotify = incident.queue_reason !== 'git_check_failed';
      incident.status = 'queued';
      incident.queue_reason = 'git_check_failed';
      await atomicJson(this.#incidentPath(incident.id), incident);
      await atomicJson(this.statePath, this.state);
      if (shouldNotify) {
        await this.store.append({ source: 'agent', type: 'agent.repair_queued', severity: 'warn', run_id: incident.run_id,
          data: { message: `Incident ${incident.id} remains queued because Git status could not be verified: ${(error?.message ?? String(error)).slice(0, 300)}` } });
      }
      return;
    }
    if (!clean) {
      const shouldNotify = incident.queue_reason !== 'dirty_git';
      incident.status = 'queued';
      incident.queue_reason = 'dirty_git';
      await atomicJson(this.#incidentPath(incident.id), incident);
      await atomicJson(this.statePath, this.state);
      if (shouldNotify) {
        await this.store.append({ source: 'agent', type: 'agent.repair_queued', severity: 'warn', run_id: incident.run_id,
          data: { message: `Incident ${incident.id} очікує чистий Git workspace; автоматичний patch не запущено.` } });
      }
      return;
    }

    await this.#launchAgent(incident);
  }

  async #launchAgent(incident) {
    const incidentPath = this.#incidentPath(incident.id);
    incident.attempts += 1;
    incident.status = 'running';
    incident.queue_reason = null;
    this.state.active_incident = incident.id;
    const acquiredAt = this.clock();
    this.state.active_lease = {
      incident_id: incident.id,
      owner_id: this.ownerId,
      acquired_at: acquiredAt.toISOString(),
      expires_at: new Date(acquiredAt.valueOf() + this.leaseMs).toISOString(),
    };
    await atomicJson(incidentPath, incident);
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
    const executionPromise = Promise.resolve().then(() => this.executor('codex', ['exec', prompt, '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--model', 'gpt-5.6-terra', '--output-last-message', outputPath, '-C', this.sourceRoot],
      { cwd: this.sourceRoot, timeout: AGENT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }));
    this.runningAgent = executionPromise;
    this.runningIncidentId = incident.id;
    this.#settleAgent(incident, incidentPath, outputPath, executionPromise).catch(async (error) => {
      await this.store.append({ source: 'agent', type: 'agent.dispatch_failed', severity: 'error', run_id: incident.run_id,
        data: { message: `Supervisor could not settle incident ${incident.id}: ${(error?.message ?? String(error)).slice(0, 500)}` } });
    });
  }

  async #settleAgent(incident, incidentPath, outputPath, executionPromise) {
    try {
      await executionPromise;
      const result = await readFile(outputPath, 'utf8');
      if (!result.trim()) throw new Error('Codex bug-hunt returned no review artifact');
      incident.status = 'review_required';
      incident.queue_reason = null;
      await this.store.append({ source: 'agent', type: 'agent.repair_result', severity: 'warn', run_id: incident.run_id,
        data: { message: `Bug-hunt ${incident.id} повернув результат. Patch залишено у source workspace для незалежних тестів і review; автоматичного deploy немає.` } });
    } catch (error) {
      incident.status = incident.attempts >= 3 ? 'stopped' : 'queued';
      incident.queue_reason = incident.attempts >= 3 ? 'attempt_limit' : 'agent_failed';
      await this.store.append({ source: 'agent', type: 'agent.repair_failed', severity: 'error', run_id: incident.run_id,
        data: { message: `Bug-hunt ${incident.id} завершився помилкою: ${(error?.message ?? String(error)).slice(0, 500)}` } });
    } finally {
      if (this.runningAgent === executionPromise) this.runningAgent = null;
      if (this.runningIncidentId === incident.id) this.runningIncidentId = null;
      if (this.state.active_incident === incident.id) this.state.active_incident = null;
      if (this.state.active_lease?.incident_id === incident.id) this.state.active_lease = null;
      await atomicJson(incidentPath, incident);
      await atomicJson(this.statePath, this.state);
      await this.#dispatchNext();
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
      const incident = { id: key, run_id: run.run_id, status: 'queued', attempts: 0, created_at: this.clock().toISOString(),
        summary: { status: run.status, phase: run.phase, message: run.message, error_name: 'PipelineStall' } };
      this.state.incidents[key] = incident;
      await atomicJson(this.#incidentPath(key), incident);
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
    await this.#dispatchNext();
  }
}
