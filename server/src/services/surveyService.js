import { tx } from '../db/connection.js';
import { appendActionLog } from '../db/repos/drawRepo.js';
import { findSurvey, insertSurvey, listSurveys, markGiftGiven } from '../db/repos/surveyRepo.js';
import { fail, invalid } from '../domain/errors.js';

/**
 * Quantified survey for the regional-issue results report (2026-10-28
 * request: 年代、性別、満足度 as fixed choices). Every answer is stored as a
 * numeric code plus its label, so it can be counted and averaged.
 * TODO(DECISION-C16): the choice lists and consent wording below are a
 * proposal; an administrator can edit them before the event.
 */
export const SATISFACTION = Object.freeze([
  { code: 5, label: 'とても満足' },
  { code: 4, label: '満足' },
  { code: 3, label: 'ふつう' },
  { code: 2, label: 'やや不満' },
  { code: 1, label: '不満' },
]);

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  ageGroups: ['10歳未満', '10代', '20代', '30代', '40代', '50代', '60代', '70歳以上'],
  genders: ['男性', '女性', 'その他', '回答しない'],
  consentText: '回答は個人が特定されない形で集計し、成果報告に使うことに同意します',
  commentLabel: '感想',
  giftEnabled: false,
});

function cleanList(v, max, field) {
  if (!Array.isArray(v)) invalid(`${field}を1行に1つずつ入力してください`);
  const list = v.map((s) => String(s).trim()).filter(Boolean).slice(0, max);
  if (list.length < 2) invalid(`${field}は2つ以上必要です`);
  if (list.some((g) => g.length > 20)) invalid(`${field}は1つ20文字以内です`);
  if (new Set(list).size !== list.length) invalid(`${field}に重複があります`);
  return list;
}

export function createSurveyService({ db, clock }) {
  function getConfig() {
    const r = db.prepare("SELECT value FROM meta WHERE key = 'survey_config'").get();
    const cfg = r ? { ...DEFAULT_CONFIG, ...JSON.parse(r.value) } : { ...DEFAULT_CONFIG };
    return { ...cfg, satisfaction: SATISFACTION };
  }

  function setConfig(input, actor) {
    const cfg = {
      enabled: input?.enabled === true,
      ageGroups: cleanList(input?.ageGroups, 12, '年代'),
      genders: cleanList(input?.genders, 8, '性別'),
      consentText: typeof input?.consentText === 'string' ? input.consentText.trim().slice(0, 500) : '',
      commentLabel: typeof input?.commentLabel === 'string' && input.commentLabel.trim() ? input.commentLabel.trim().slice(0, 40) : '感想',
      giftEnabled: input?.giftEnabled === true,
    };
    if (cfg.enabled && !cfg.consentText) invalid('公開するには同意文を設定してください');
    const at = clock();
    tx(db, () => {
      db.prepare("INSERT INTO meta (key, value) VALUES ('survey_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(cfg));
      appendActionLog(db, { at, actor, type: 'setSurveyConfig', action: cfg, result: 'ok' });
    });
    return getConfig();
  }

  function submit(cardId, body) {
    const cfg = getConfig();
    if (!cfg.enabled) fail('SURVEY_CLOSED', 'アンケートは準備中です', { status: 403 });
    const ageCode = cfg.ageGroups.indexOf(body?.ageGroup);
    if (ageCode < 0) invalid('年代を選んでください');
    const genderCode = cfg.genders.indexOf(body?.gender);
    if (genderCode < 0) invalid('性別を選んでください');
    const sat = SATISFACTION.find((x) => x.code === body?.satisfaction);
    if (!sat) invalid('満足度を選んでください');
    if (body?.consent !== true) invalid('同意が必要です');
    const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : '';
    const answers = {
      ageGroup: body.ageGroup, ageCode: ageCode + 1,
      gender: body.gender, genderCode: genderCode + 1,
      satisfaction: sat.code, satisfactionLabel: sat.label,
      comment, consent: true,
    };
    const at = clock();
    const ok = tx(db, () => insertSurvey(db, { cardId, answers, at }));
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

  /** Counts, satisfaction distribution and mean, overall and by 年代 / 性別. */
  function summary() {
    const rows = listSurveys(db).filter((r) => Number.isInteger(r.answers.satisfaction));
    const cfg = getConfig();
    const mean = (list) => (list.length ? Math.round((list.reduce((a, r) => a + r.answers.satisfaction, 0) / list.length) * 100) / 100 : null);
    const dist = (list) => Object.fromEntries(SATISFACTION.map((x) => [x.code, list.filter((r) => r.answers.satisfaction === x.code).length]));
    const by = (key, labels) => labels.map((label) => {
      const list = rows.filter((r) => r.answers[key] === label);
      return { label, count: list.length, mean: mean(list), distribution: dist(list) };
    });
    return {
      total: rows.length,
      satisfaction: { mean: mean(rows), distribution: dist(rows), labels: SATISFACTION },
      byAge: by('ageGroup', cfg.ageGroups),
      byGender: by('gender', cfg.genders),
      gifts: rows.filter((r) => r.giftAt).length,
      comments: rows.filter((r) => r.answers.comment).map((r) => ({ at: r.answeredAt, ageGroup: r.answers.ageGroup, comment: r.answers.comment })),
    };
  }

  /** One row per answer with numeric codes, for the results report. */
  function csvRows() {
    return listSurveys(db).map((r, i) => [i + 1, r.answeredAt, r.answers.ageCode ?? '', r.answers.ageGroup ?? '', r.answers.genderCode ?? '', r.answers.gender ?? '', r.answers.satisfaction ?? '', r.answers.satisfactionLabel ?? '', r.answers.comment ?? '']);
  }

  return { getConfig, setConfig, submit, giveGift, summary, csvRows, find: (cardId) => findSurvey(db, cardId) };
}

export const SURVEY_CSV_HEADER = ['no', 'answeredAt', 'ageCode', 'ageGroup', 'genderCode', 'gender', 'satisfaction', 'satisfactionLabel', 'comment'];
