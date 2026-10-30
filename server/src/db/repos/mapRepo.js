const toPlace = (r) => ({
  id: r.place_id, kind: r.kind, name: r.name, shortName: r.short_name, organizer: r.organizer,
  description: r.description, category: r.category, x: r.x, y: r.y, w: r.w, d: r.d, h: r.h,
  color: r.color, details: JSON.parse(r.details_json), sortOrder: r.sort_order, published: r.published === 1,
  updatedAt: r.updated_at,
});

const toProgram = (r) => ({
  id: r.program_id, stageId: r.stage_id, title: r.title, organizer: r.organizer, startsAt: r.starts_at,
  endsAt: r.ends_at, description: r.description, sortOrder: r.sort_order, status: r.status, updatedAt: r.updated_at,
});

export function listPlaces(db, { publishedOnly = true } = {}) {
  return db.prepare(`SELECT * FROM map_places WHERE (? = 0 OR published = 1) ORDER BY sort_order, place_id`)
    .all(publishedOnly ? 1 : 0).map(toPlace);
}

export function listPrograms(db, stageId = null) {
  return db.prepare('SELECT * FROM stage_programs WHERE (? IS NULL OR stage_id = ?) ORDER BY starts_at, sort_order, program_id')
    .all(stageId, stageId).map(toProgram);
}

export function getVenue(db) {
  const r = db.prepare('SELECT venue_json, updated_at FROM map_meta WHERE id = 1').get();
  return r ? { ...JSON.parse(r.venue_json), updatedAt: r.updated_at } : null;
}

/** Replace the whole published map in one transaction (caller wraps in tx). */
export function replaceMap(db, { venue, places, programs, at }) {
  db.prepare('DELETE FROM stage_programs').run();
  db.prepare('DELETE FROM map_places').run();
  db.prepare(`INSERT INTO map_meta (id, venue_json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET venue_json = excluded.venue_json, updated_at = excluded.updated_at`).run(JSON.stringify(venue), at);
  const ins = db.prepare(`INSERT INTO map_places (place_id, kind, name, short_name, organizer, description, category, x, y, w, d, h, color, details_json, sort_order, published, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of places) {
    ins.run(p.id, p.kind, p.name, p.shortName ?? null, p.organizer ?? null, p.description ?? null, p.category ?? null,
      p.x, p.y, p.w, p.d, p.h, p.color ?? null, JSON.stringify(p.details ?? {}), p.sortOrder ?? 0, p.published === false ? 0 : 1, at);
  }
  const insP = db.prepare(`INSERT INTO stage_programs (program_id, stage_id, title, organizer, starts_at, ends_at, description, sort_order, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const g of programs) {
    insP.run(g.id, g.stageId, g.title, g.organizer ?? null, g.startsAt, g.endsAt ?? null, g.description ?? null, g.sortOrder ?? 0, g.status ?? 'scheduled', at);
  }
}
