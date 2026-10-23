const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 8601 in Japan time with an explicit +09:00 offset, e.g. 2026-11-01T10:15:30.123+09:00 */
export function toJst(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError('invalid date');
  return `${new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 23)}+09:00`;
}

export const nowJst = () => toJst(Date.now());

export function addMs(iso, ms) {
  return toJst(Date.parse(iso) + ms);
}
