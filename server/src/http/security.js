import { DomainError } from '../domain/errors.js';

export const COOKIES = Object.freeze({ visitor: 'mb_card', staff: 'mb_staff' });

export function cookieOptions(config, maxAgeSec) {
  return { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', maxAge: maxAgeSec };
}

/**
 * §15 C06: browser state-changing requests authenticated by Cookie must come
 * from our own origin. Device APIs (Bearer) are exempt; Origin is never used
 * as a device credential.
 */
export function verifyOrigin(config) {
  return async function originHook(request) {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    const origin = request.headers.origin;
    const expected = config.publicOrigin ?? `${request.protocol}://${request.headers.host}`;
    if (origin) {
      if (origin !== expected) throw new DomainError('BAD_ORIGIN', 'この操作は許可されていない送信元からです', { status: 403 });
      return;
    }
    if (request.headers['sec-fetch-site'] === 'same-origin') return;
    throw new DomainError('BAD_ORIGIN', 'Origin ヘッダーが必要です', { status: 403 });
  };
}

// The Windows PC screen (/pc/) shows the camera, print and ball dashboard
// screens in same-origin frames; every other page refuses to be framed.
const FRAMEABLE = /^\/(camera|print|balls)\/(?:index\.html)?(?:\?|$)/;

export function securityHeaders(reply) {
  const frameable = FRAMEABLE.test(reply.request?.url ?? '');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('X-Frame-Options', frameable ? 'SAMEORIGIN' : 'DENY');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  reply.header('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
    "connect-src 'self'", "media-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-src 'self'", frameable ? "frame-ancestors 'self'" : "frame-ancestors 'none'", "form-action 'self'",
  ].join('; '));
}

export function errorHandler(error, request, reply) {
  if (error instanceof DomainError) {
    const body = { error: error.code, message: error.message };
    if (error.details !== undefined) Object.assign(body, error.details);
    if (error.status === 429) reply.header('Retry-After', '60');
    return reply.code(error.status).send(body);
  }
  if (error.validation) {
    return reply.code(422).send({ error: 'VALIDATION_FAILED', message: '入力の形式が正しくありません', details: error.validation.map((v) => `${v.instancePath} ${v.message}`) });
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: error.code ?? 'BAD_REQUEST', message: '要求を処理できません' });
  }
  request.log.error({ err: error }, 'unhandled error');
  return reply.code(500).send({ error: 'INTERNAL', message: 'サーバーで問題が発生しました。もう一度お試しください' });
}

export function clientIp(request) {
  return request.ip ?? 'unknown';
}
