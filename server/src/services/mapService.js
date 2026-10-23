import { tx } from '../db/connection.js';
import { getVenue, listPlaces, listPrograms, replaceMap } from '../db/repos/mapRepo.js';
import { appendActionLog } from '../db/repos/drawRepo.js';
import { invalid } from '../domain/errors.js';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ISO_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/;
export const PLACE_KINDS = Object.freeze(['booth', 'stage', 'facility', 'outdoor', 'area']);
/** Optional booth details shown only when the organisers supplied them (§18.3). */
export const DETAIL_FIELDS = Object.freeze({
  hours: '開催時間', location: '場所', target: '対象', requirement: '参加条件', capacity: '定員', fee: '費用', stampCategory: 'スタンプ対象種別',
});

// Shown until official data is imported. Only facts given in the spec.
const DEFAULT_VENUE = Object.freeze({ name: '大垣城ホール', width: 40, depth: 28, note: '会場配置は運営確認中です' });

function text(v, field, max, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) invalid(`${field} は必須です`);
    return null;
  }
  if (typeof v !== 'string' || v.length > max) invalid(`${field} は${max}文字以内の文字列です`);
  return v.trim();
}

function num(v, field, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) invalid(`${field} は${min}〜${max}の数値です`);
  return v;
}

export function validateMapImport(input) {
  if (!input || typeof input !== 'object') invalid('JSONオブジェクトを指定してください');
  const v = input.venue ?? {};
  const venue = {
    name: text(v.name, 'venue.name', 60, { required: true }),
    width: num(v.width, 'venue.width', 5, 500),
    depth: num(v.depth, 'venue.depth', 5, 500),
    note: text(v.note, 'venue.note', 200),
  };
  if (!Array.isArray(input.places) || input.places.length > 300) invalid('places は300件以内の配列です');
  const ids = new Set();
  const places = input.places.map((p, i) => {
    const at = `places[${i}]`;
    if (typeof p?.id !== 'string' || !ID_RE.test(p.id)) invalid(`${at}.id は英小文字・数字・-_ の40文字以内です`);
    if (ids.has(p.id)) invalid(`${at}.id ${p.id} が重複しています`);
    ids.add(p.id);
    if (!PLACE_KINDS.includes(p.kind)) invalid(`${at}.kind は ${PLACE_KINDS.join('/')} のいずれかです`);
    const x = num(p.x, `${at}.x`, -venue.width, venue.width * 2);
    const y = num(p.y, `${at}.y`, -venue.depth, venue.depth * 2);
    const details = {};
    if (p.details !== undefined) {
      if (!p.details || typeof p.details !== 'object' || Array.isArray(p.details)) invalid(`${at}.details はオブジェクトです`);
      for (const [k, val] of Object.entries(p.details)) {
        if (!Object.hasOwn(DETAIL_FIELDS, k)) invalid(`${at}.details.${k} は未対応の項目です（${Object.keys(DETAIL_FIELDS).join(', ')}）`);
        const t = text(val, `${at}.details.${k}`, 300);
        if (t) details[k] = t;
      }
    }
    if (p.color !== undefined && p.color !== null && !COLOR_RE.test(p.color)) invalid(`${at}.color は #RRGGBB 形式です`);
    return {
      id: p.id, kind: p.kind,
      name: text(p.name, `${at}.name`, 80, { required: true }),
      shortName: text(p.shortName, `${at}.shortName`, 12),
      organizer: text(p.organizer, `${at}.organizer`, 80),
      description: text(p.description, `${at}.description`, 1000),
      category: text(p.category, `${at}.category`, 40),
      x, y,
      w: num(p.w, `${at}.w`, 0.1, venue.width * 2),
      d: num(p.d, `${at}.d`, 0.1, venue.depth * 2),
      h: num(p.h ?? (p.kind === 'area' ? 0 : 1), `${at}.h`, 0, 20),
      color: p.color ?? null,
      details,
      sortOrder: Number.isInteger(p.sortOrder) ? p.sortOrder : i,
      published: p.published !== false,
    };
  });
  const programs = (input.programs ?? []).map((g, i) => {
    const at = `programs[${i}]`;
    if (typeof g?.id !== 'string' || !ID_RE.test(g.id)) invalid(`${at}.id が不正です`);
    const stage = places.find((p) => p.id === g.stageId);
    if (!stage || stage.kind !== 'stage') invalid(`${at}.stageId は kind=stage の場所IDです`);
    if (typeof g.startsAt !== 'string' || !ISO_OFFSET_RE.test(g.startsAt)) invalid(`${at}.startsAt は 2026-11-01T10:00+09:00 の形式です`);
    if (g.endsAt !== undefined && g.endsAt !== null && (typeof g.endsAt !== 'string' || !ISO_OFFSET_RE.test(g.endsAt))) invalid(`${at}.endsAt の形式が不正です`);
    if (g.endsAt && Date.parse(g.endsAt) < Date.parse(g.startsAt)) invalid(`${at}.endsAt が開始より前です`);
    if (g.status !== undefined && !['scheduled', 'changed', 'cancelled'].includes(g.status)) invalid(`${at}.status が不正です`);
    return {
      id: g.id, stageId: g.stageId, title: text(g.title, `${at}.title`, 120, { required: true }),
      organizer: text(g.organizer, `${at}.organizer`, 80), startsAt: g.startsAt, endsAt: g.endsAt ?? null,
      description: text(g.description, `${at}.description`, 1000), sortOrder: Number.isInteger(g.sortOrder) ? g.sortOrder : i,
      status: g.status ?? 'scheduled',
    };
  });
  const programIds = new Set();
  for (const g of programs) {
    if (programIds.has(g.id)) invalid(`programs の id ${g.id} が重複しています`);
    programIds.add(g.id);
  }
  return { venue, places, programs };
}

export function createMapService({ db, clock }) {
  function getPublicMap() {
    const venue = getVenue(db) ?? { ...DEFAULT_VENUE, updatedAt: null };
    const places = listPlaces(db, { publishedOnly: true });
    const programs = listPrograms(db).filter((g) => places.some((p) => p.id === g.stageId));
    return { venue, places, programs, detailLabels: DETAIL_FIELDS };
  }

  function exportMap() {
    const venue = getVenue(db) ?? { ...DEFAULT_VENUE };
    const { updatedAt, ...v } = venue;
    void updatedAt;
    return {
      venue: v,
      places: listPlaces(db, { publishedOnly: false }).map(({ updatedAt: _u, ...p }) => p),
      programs: listPrograms(db).map(({ updatedAt: _u, ...g }) => g),
    };
  }

  function importMap(input, actor) {
    const data = validateMapImport(input);
    const at = clock();
    tx(db, () => {
      replaceMap(db, { ...data, at });
      appendActionLog(db, { at, actor, type: 'importMap', action: { places: data.places.length, programs: data.programs.length }, result: 'ok' });
    });
    return { places: data.places.length, programs: data.programs.length };
  }

  return { getPublicMap, exportMap, importMap };
}
