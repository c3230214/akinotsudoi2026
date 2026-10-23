/**
 * Pure domain rules shared by the HTTP layer and tests.
 * This module deliberately has no dependency on HTTP, a database, or the DOM.
 */

export const COLORS = Object.freeze(['red', 'green', 'lightblue', 'white']);

// Cell indexes are zero-based and ordered 1 through 9 from left to right,
// top to bottom. These are the 8 horizontal, vertical, and diagonal lines.
export const LINES = Object.freeze([
  Object.freeze([0, 1, 2]),
  Object.freeze([3, 4, 5]),
  Object.freeze([6, 7, 8]),
  Object.freeze([0, 3, 6]),
  Object.freeze([1, 4, 7]),
  Object.freeze([2, 5, 8]),
  Object.freeze([0, 4, 8]),
  Object.freeze([2, 4, 6]),
]);

/**
 * Validate the nine-cell mark array. null is allowed only for an unconfirmed
 * camera-read result, never for a finalized mark array.
 *
 * @param {unknown} marks
 * @param {{allowNull?: boolean}} options
 * @returns {Array<boolean|null>} the original array after validation
 */
export function validateMarks(marks, { allowNull = false } = {}) {
  if (!Array.isArray(marks) || marks.length !== 9) {
    throw new TypeError('marks must be an array containing exactly 9 entries');
  }

  for (const [index, mark] of marks.entries()) {
    if (typeof mark === 'boolean') continue;
    if (allowNull && mark === null) continue;
    throw new TypeError(`marks[${index}] must be boolean${allowNull ? ' or null' : ''}`);
  }

  return marks;
}

/** Count lines whose three cells are explicitly marked true. */
export function completeLines(marks) {
  validateMarks(marks, { allowNull: true });
  return LINES.reduce(
    (count, line) => count + (line.every((index) => marks[index] === true) ? 1 : 0),
    0,
  );
}

/**
 * Map completed-line count to eligible draws as defined in the specification.
 * A line count is a count of completed lines, not a client-submitted draw count.
 */
export function entitledDraws(lineCount) {
  if (!Number.isInteger(lineCount) || lineCount < 0 || lineCount > 8) {
    throw new RangeError('lineCount must be an integer from 0 to 8');
  }
  if (lineCount === 0) return 0;
  if (lineCount <= 2) return 1;
  if (lineCount <= 7) return 2;
  return 3;
}
