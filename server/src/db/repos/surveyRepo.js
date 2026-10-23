export function insertSurvey(db, { cardId, answers, at }) {
  const r = db.prepare('INSERT INTO surveys (card_id, answers_json, answered_at) VALUES (?, ?, ?) ON CONFLICT(card_id) DO NOTHING')
    .run(cardId, JSON.stringify(answers), at);
  return r.changes === 1;
}

export function findSurvey(db, cardId) {
  const r = db.prepare('SELECT * FROM surveys WHERE card_id = ?').get(cardId);
  return r ? { cardId: r.card_id, answers: JSON.parse(r.answers_json), answeredAt: r.answered_at, giftAt: r.gift_at, giftBy: r.gift_by } : null;
}

export function markGiftGiven(db, cardId, at, by) {
  return db.prepare('UPDATE surveys SET gift_at = ?, gift_by = ? WHERE card_id = ? AND gift_at IS NULL').run(at, by, cardId).changes === 1;
}

export function listSurveys(db) {
  return db.prepare('SELECT * FROM surveys ORDER BY answered_at').all()
    .map((r) => ({ cardId: r.card_id, answers: JSON.parse(r.answers_json), answeredAt: r.answered_at, giftAt: r.gift_at }));
}
