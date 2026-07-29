import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'zeely_demo_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PUBLIC_PATHS = new Set(['/login.html', '/login.css', '/login.js', '/api/auth/pin', '/api/health']);

function digest(secret, value) {
  return createHmac('sha256', secret).update(value).digest();
}

function equalDigest(secret, left, right) {
  return timingSafeEqual(digest(secret, left), digest(secret, right));
}

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value));
}

export function installDemoAuth(app, auth) {
  if (!auth) return;
  const { pin, secret, secure = true, maxAttempts = 5, windowMs = 15 * 60 * 1000 } = auth;
  if (!/^\d{4,12}$/.test(pin ?? '')) throw new Error('ZEELY_DEMO_PIN must contain 4 to 12 digits');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('ZEELY_SESSION_SECRET must contain at least 32 characters');

  const sessionToken = digest(secret, 'zeely-demo-session-v1').toString('base64url');
  const attempts = new Map();

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/video-source/')) return;
    const supplied = cookies(request.headers.cookie)[COOKIE_NAME];
    if (supplied && equalDigest(secret, supplied, sessionToken)) return;
    if (pathname.startsWith('/api/')) return reply.code(401).send({ error: 'PIN authentication required' });
    return reply.redirect(`/login.html?next=${encodeURIComponent(request.url)}`);
  });

  app.post('/api/auth/pin', async (request, reply) => {
    const key = request.ip;
    const now = Date.now();
    const current = attempts.get(key);
    const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    if (state.count >= maxAttempts) {
      return reply.header('Retry-After', Math.ceil((state.resetAt - now) / 1000)).code(429).send({ error: 'Too many attempts. Try again later.' });
    }

    const candidate = String(request.body?.pin ?? '');
    if (!equalDigest(secret, candidate, pin)) {
      state.count += 1;
      attempts.set(key, state);
      return reply.code(401).send({ error: 'Incorrect PIN' });
    }

    attempts.delete(key);
    const secureFlag = secure ? '; Secure' : '';
    reply.header('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secureFlag}`);
    return { authenticated: true };
  });
}
