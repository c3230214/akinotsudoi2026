import QRCode from 'qrcode';
import { DomainError } from '../../domain/errors.js';
import { COOKIES, clientIp, cookieOptions } from '../security.js';
import { createRateLimiter } from '../../services/rateLimiter.js';

const CARD_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function visitorRoutes(app, { cards, maps, surveys, notices, config }) {
  // TODO(DECISION-C23): limits are proposals; carrier NAT can put many
  // visitors behind one IP, so the IP limit is generous and the per-card
  // limit is the tighter one.
  const issueByIp = createRateLimiter({ windowMs: 60_000, max: 60 });
  const stampByIp = createRateLimiter({ windowMs: 60_000, max: 240 });
  const stampByCard = createRateLimiter({ windowMs: 60_000, max: 20 });

  // 2026-10-28: the intake QR is shown only after the survey is answered
  // (while the survey is open). The claim is withheld server-side, not just hidden.
  const cardView = (card) => {
    const view = cards.getCardView(card);
    const surveyRequired = surveys.getConfig().enabled && !surveys.find(card.id);
    return { ...view, surveyRequired, qrPayload: surveyRequired ? null : view.qrPayload };
  };
  const currentCard = (request) => cards.cardFromToken(request.cookies[COOKIES.visitor]);
  const requireCard = (request) => {
    const card = currentCard(request);
    if (!card) throw new DomainError('NO_CARD', 'カードがありません。カードを発行してください', { status: 401 });
    return card;
  };

  app.post('/api/visitor/cards', async (request, reply) => {
    const existing = currentCard(request);
    if (existing) return { ...cardView(existing), issued: false };
    if (!issueByIp.hit(clientIp(request)).allowed) throw new DomainError('RATE_LIMITED', '短時間に多くのカードが発行されました。少し待ってからお試しください', { status: 429 });
    const { token, cardId } = cards.issueCard();
    reply.setCookie(COOKIES.visitor, token, cookieOptions(config, CARD_COOKIE_MAX_AGE));
    return { ...cardView(cards.cardFromToken(token)), issued: true, cardId };
  });

  app.get('/api/visitor/card', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return cardView(requireCard(request));
  });

  app.get('/api/visitor/card/qr.svg', async (request, reply) => {
    const view = cardView(requireCard(request));
    if (view.surveyRequired && !view.used) throw new DomainError('SURVEY_REQUIRED', 'アンケートに答えると受付用QRを表示できます', { status: 403 });
    if (!view.qrPayload) throw new DomainError('CARD_USED', 'このカードは抽選済みです', { status: 410 });
    const svg = await QRCode.toString(view.qrPayload, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    return reply.header('Cache-Control', 'no-store').type('image/svg+xml; charset=utf-8').send(svg);
  });

  app.post('/api/visitor/stamps', {
    schema: { body: { type: 'object', required: ['payload'], properties: { payload: { type: 'string', maxLength: 400 }, cellIndex: { type: 'integer', minimum: 0, maximum: 8 } } } },
  }, async (request) => {
    const card = requireCard(request);
    if (!stampByIp.hit(clientIp(request)).allowed || !stampByCard.hit(card.id).allowed) {
      throw new DomainError('RATE_LIMITED', '読み取りが多すぎます。少し待ってからお試しください', { status: 429 });
    }
    const stamped = cards.stamp(card, request.body.payload, request.body.cellIndex ?? null);
    return { stamped, card: cardView(cards.cardFromToken(request.cookies[COOKIES.visitor])) };
  });

  app.post('/api/visitor/tap', {
    schema: { body: { type: 'object', required: ['cellIndex'], properties: { cellIndex: { type: 'integer', minimum: 0, maximum: 8 } } } },
  }, async (request) => {
    const card = requireCard(request);
    if (!stampByCard.hit(card.id).allowed) throw new DomainError('RATE_LIMITED', '操作が多すぎます。少し待ってからお試しください', { status: 429 });
    const stamped = cards.tapCell(card, request.body.cellIndex);
    return { stamped, card: cardView(cards.cardFromToken(request.cookies[COOKIES.visitor])) };
  });

  app.get('/api/visitor/survey', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const card = currentCard(request);
    const cfg = surveys.getConfig();
    const answered = card ? surveys.find(card.id) : null;
    return { enabled: cfg.enabled, ageGroups: cfg.ageGroups, genders: cfg.genders, satisfaction: cfg.satisfaction, consentText: cfg.consentText, commentLabel: cfg.commentLabel, giftEnabled: cfg.giftEnabled, answered: Boolean(answered), answeredAt: answered?.answeredAt ?? null, giftAt: answered?.giftAt ?? null, hasCard: Boolean(card) };
  });

  app.post('/api/visitor/survey', {
    schema: { body: { type: 'object', properties: { ageGroup: { type: 'string', maxLength: 40 }, gender: { type: 'string', maxLength: 40 }, satisfaction: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', maxLength: 1000 }, consent: { type: 'boolean' } } } },
  }, async (request) => {
    const card = requireCard(request);
    return surveys.submit(card.id, request.body);
  });

  app.get('/api/notices', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notices.publicNotices();
  });

  app.get('/api/map', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return maps.getPublicMap();
  });

  app.get('/api/booths', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return { booths: maps.getPublicMap().places.filter((p) => p.kind === 'booth') };
  });
}
