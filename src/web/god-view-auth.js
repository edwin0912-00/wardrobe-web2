import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_SECURE = '__Host-zeely_god_view';
const COOKIE_DEV = 'zeely_god_view_dev';
const DEFAULT_SESSION_SECONDS = 30 * 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1_000;

function parseCookies(header = '') {
  return Object.fromEntries(header
    .split(';')
    .map((item) => item.trim().split('=').map(decodeURIComponent))
    .filter(([key, value]) => key && value));
}

function sameText(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function signature(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * A separate, read-only control-room session. This deliberately does not reuse
 * an anonymous profile cookie: possession of a browser profile must never turn
 * into cross-profile access.
 */
export class GodViewAuth {
  constructor({
    key,
    sessionSecret = key,
    secure = true,
    sessionSeconds = DEFAULT_SESSION_SECONDS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    windowMs = DEFAULT_WINDOW_MS,
    clock = () => Date.now(),
  } = {}) {
    if (typeof key !== 'string' || key.length < 32) {
      throw new Error('ZEELY_GOD_VIEW_KEY must contain at least 32 characters');
    }
    if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
      throw new Error('ZEELY_GOD_VIEW_SESSION_SECRET must contain at least 32 characters');
    }
    if (!Number.isInteger(sessionSeconds) || sessionSeconds < 60 || sessionSeconds > 8 * 60 * 60) {
      throw new Error('God View sessionSeconds must be between 60 and 28800');
    }
    this.key = key;
    this.sessionSecret = sessionSecret;
    this.secure = secure;
    this.sessionSeconds = sessionSeconds;
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.clock = clock;
    this.attempts = new Map();
  }

  get cookieName() {
    return this.secure ? COOKIE_SECURE : COOKIE_DEV;
  }

  #readSession(request) {
    const supplied = parseCookies(request.headers.cookie)[this.cookieName];
    if (typeof supplied !== 'string') return null;
    const [expiresAtText, nonce, suppliedSignature] = supplied.split('.');
    if (!/^\d{13}$/.test(expiresAtText) || !/^[A-Za-z0-9_-]{22,}$/.test(nonce) || !/^[A-Za-z0-9_-]{20,}$/.test(suppliedSignature)) {
      return null;
    }
    const payload = `${expiresAtText}.${nonce}`;
    if (!sameText(signature(this.sessionSecret, payload), suppliedSignature)) return null;
    const expiresAt = Number(expiresAtText);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.clock()) return null;
    return { expiresAt };
  }

  #setCookie(reply, value, maxAge) {
    const secureFlag = this.secure ? '; Secure' : '';
    reply.header(
      'Set-Cookie',
      `${this.cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureFlag}`,
    );
  }

  session(request) {
    return this.#readSession(request);
  }

  require(request, reply) {
    const session = this.session(request);
    if (session) return session;
    reply.code(401).send({ error: 'God View authentication required', code: 'GOD_VIEW_AUTH_REQUIRED' });
    return null;
  }

  login(request, reply, candidate) {
    const now = this.clock();
    const key = String(request.ip ?? 'unknown');
    const current = this.attempts.get(key);
    const state = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : current;
    if (state.count >= this.maxAttempts) {
      reply.header('Retry-After', String(Math.ceil((state.resetAt - now) / 1_000)));
      reply.code(429).send({ error: 'Too many God View attempts', code: 'GOD_VIEW_RATE_LIMITED' });
      return null;
    }
    if (!sameText(this.key, candidate ?? '')) {
      state.count += 1;
      this.attempts.set(key, state);
      reply.code(401).send({ error: 'Invalid God View key', code: 'GOD_VIEW_AUTH_FAILED' });
      return null;
    }
    this.attempts.delete(key);
    const expiresAt = now + this.sessionSeconds * 1_000;
    const payload = `${expiresAt}.${randomBytes(24).toString('base64url')}`;
    this.#setCookie(reply, `${payload}.${signature(this.sessionSecret, payload)}`, this.sessionSeconds);
    return { expires_at: new Date(expiresAt).toISOString() };
  }

  logout(reply) {
    this.#setCookie(reply, '', 0);
  }
}

// Beta is a closed tester link, not the public product. The operator explicitly
// wants every beta tester to reach the read-only global catalogue through the
// hidden control. This object keeps that exception isolated to an explicit
// runtime flag; production still uses GodViewAuth above.
export class OpenTesterGodViewAuth {
  session() {
    // A finite Date-safe value keeps the common session route representation
    // identical to the password-protected implementation.
    return { expiresAt: Date.now() + 24 * 60 * 60 * 1_000 };
  }

  require() {
    return this.session();
  }

  login() {
    return { expires_at: null };
  }

  logout() {}
}
