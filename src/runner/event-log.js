import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export class AppendOnlyEventLog {
  constructor(filename, { clock = () => new Date() } = {}) {
    this.filename = path.resolve(filename);
    this.clock = clock;
    this.sequence = null;
  }

  async initialize() {
    await mkdir(path.dirname(this.filename), { recursive: true });
    try {
      const text = await readFile(this.filename, 'utf8');
      const lines = text.split('\n').filter(Boolean);
      this.sequence = lines.length === 0 ? 0 : JSON.parse(lines.at(-1)).sequence;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.sequence = 0;
    }
  }

  async append({ runId, jobId, jobHash, type, state, data = {} }) {
    if (this.sequence === null) await this.initialize();
    const sequence = this.sequence + 1;
    const eventId = createHash('sha256')
      .update(`${runId}:${sequence}:${type}:${state}`)
      .digest('hex');
    const event = {
      event_id: eventId,
      sequence,
      occurred_at: this.clock().toISOString(),
      run_id: runId,
      job_id: jobId,
      job_hash: jobHash,
      type,
      state,
      data,
    };
    const handle = await open(this.filename, 'a');
    try {
      await handle.write(`${JSON.stringify(event)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.sequence = sequence;
    return event;
  }
}
