export class RunNotFoundError extends Error {
  constructor(runId) {
    super(`Run ${runId} не знайдено`);
    this.name = 'RunNotFoundError';
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchRunWithRetry(runId, {
  fetchImpl = globalThis.fetch,
  delays = [0, 500, 1_000, 2_000, 4_000, 8_000],
  waitImpl = wait,
  onRetry = () => {},
  retryNotFound = false,
  timeoutMs = 8_000,
} = {}) {
  let lastError = new Error('Не вдалося відновити run');
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await waitImpl(delays[attempt]);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Run status request timed out')), timeoutMs);
    try {
      const response = await fetchImpl(`/api/runs/${encodeURIComponent(runId)}`, { cache: 'no-store', signal: controller.signal });
      if (response.status === 404) {
        const notFound = new RunNotFoundError(runId);
        if (!retryNotFound || attempt === delays.length - 1) throw notFound;
        lastError = notFound;
        onRetry({ attempt: attempt + 1, error: notFound });
        continue;
      }
      if (!response.ok) throw new Error(`Server тимчасово повернув HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof RunNotFoundError) throw error;
      lastError = error;
      if (attempt < delays.length - 1) onRetry({ attempt: attempt + 1, error });
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}
