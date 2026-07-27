const TOKEN_ENDPOINT = 'https://rest.fal.ai/tokens/';

export function createFalRealtimeTokenIssuer({
  apiKey = process.env.FAL_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) return null;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  return async ({ app, expiresInSeconds }) => {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        allowed_apps: [app],
        token_expiration: expiresInSeconds,
      }),
    });
    if (!response.ok) {
      throw new Error(`fal realtime token request failed (${response.status})`);
    }
    const data = await response.json();
    if (typeof data.token !== 'string' || data.token.length < 16) {
      throw new Error('fal realtime token response is invalid');
    }
    return data.token;
  };
}
