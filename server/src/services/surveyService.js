import { tx } from '../db/connection.js';
import { appendActionLog } from '../db/repos/drawRepo.js';
import { findSurvey, insertSurvey, listSurveys, markGiftGiven } from '../db/repos/surveyRepo.js';
import { fail, invalid } from '../domain/errors.js';

/**
 * TODO(DECISION-C16): questions, age groups, consent text and the thank-you
 * gift are not decided. The survey stays closed until an administrator saves
 * a configuration; nothing is invented here.
 */
const DEFAULT_CONFIG = Object.freeze({ enabled: false, ageGroups: [], consentText: '', commentLabel: '感想', giftEnabled: false });

export function createSurveyService({ db, clock }) {
  function getConfig() {
    const r = db.prepare("SELECT value FROM meta WHERE key = 'survey_config'").get();
    return r ? { ...DEFAULT_CONFIG, ...JSON.parse(r.value) } : { ...DEFAULT_CONFIG };
  }

  function setConfig(input, actor) {
    const cfg = {
      enabled: input?.enabled === true,
      ageGroups: Array.isArray(input?.ageGroups) ? input.ageGroups.map((s) => String(s).trim()).filter(Boolean).slice(0, 12) : [],
      consentText: typeof input?.consentText === 'string' ? input.consentText.trim().slice(0, 500) : '',
      commentLabel: typeof input?.commentLabel === 'string' && input.commentLabel.trim() ? input.commentLabel.trim().slice(0, 40) : '感想',
      giftEnabled: input?.giftEnabled === true,
    };
    if (cfg.enabled && (cfg.ageGroups.length === 0 || !cfg.consentText)) invalid('公開するには年齢区分と同意文を設定してください');
    if (cfg.ageGroups.some((g) => g.length > 20)) invalid('年齢区分は20文字以内です');
    const at = clock();
    tx(db, () => {
      db.prepare("INSERT INTO meta (key, value) VALUES ('survey_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(cfg));
      appendActionLog(db, { at, actor, type: 'setSurveyConfig', action: cfg, result: 'ok' });
    });
    return cfg;
  }

  function submit(cardId, body) {
    const cfg = getConfig();
    if (!cfg.enabled) fail('SURVEY_CLOSED', 'アンケートは準備中です', { status: 403 });
    if (!cfg.ageGroups.includes(body?.ageGroup)) invalid('年齢区分を選んでください');
    if (body?.consent !== true) invalid('同意が必要です');
    const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : '';
    const at = clock();
    const ok = tx(db, () => insertSurvey(db, { cardId, answers: { ageGroup: body.ageGroup, comment, consent: true }, at }));
    if (!ok) fail('ALREADY_ANSWERED', 'アンケートは回答済みです');
    return { answeredAt: at };
  }

  function giveGift(cardId, actor) {
    const cfg = getConfig();
    if (!cfg.giftEnabled) fail('GIFT_DISABLED', 'アンケートのお礼は設定されていません');
    const survey = findSurvey(db, cardId);
    if (!survey) fail('NOT_ANSWERED', 'このカードはアンケート未回答です', { status: 404 });
    const at = clock();
    const ok = tx(db, () => {
      const r = markGiftGiven(db, cardId, at, actor.name);
      if (r) appendActionLog(db, { at, actor, type: 'giveSurveyGift', action: { cardId }, result: 'ok' });
      return r;
    });
    if (!ok) fail('ALREADY_GIVEN', `お礼は ${survey.giftAt} に渡し済みです`);
    return { giftAt: at };
  }

  function summary() {
    const rows = listSurveys(db);
    const byAge = {};
    for (const r of rows) byAge[r.answers.ageGroup] = (byAge[r.answers.ageGroup] ?? 0) + 1;
    return { total: rows.length, byAge, gifts: rows.filter((r) => r.giftAt).length, comments: rows.filter((r) => r.answers.comment).map((r) => ({ at: r.answeredAt, ageGroup: r.answers.ageGroup, comment: r.answers.comment })) };
  }

  return { getConfig, setConfig, submit, giveGift, summary, find: (cardId) => findSurvey(db, cardId) };
}
