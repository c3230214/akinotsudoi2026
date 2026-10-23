/**
 * Paper-card content and category reference.
 * Background names describe the reference image only; they are not approved
 * CSS color values. Mark assignment rules remain undecided in the source spec.
 */
export const CELLS = Object.freeze([
  Object.freeze({ index: 0, number: 1, category: 'committee', label: '実行委員会企画を体験しよう', backgroundFamily: 'salmon' }),
  Object.freeze({ index: 1, number: 2, category: 'panel_feedback', label: 'パネルをみて感想を書こう', backgroundFamily: 'white' }),
  Object.freeze({ index: 2, number: 3, category: 'workshop', label: '体験工房で体験しよう', backgroundFamily: 'lightblue' }),
  Object.freeze({ index: 3, number: 4, category: 'workshop', label: '体験工房で体験しよう', backgroundFamily: 'lightblue' }),
  Object.freeze({ index: 4, number: 5, category: 'participation', label: 'ビンゴに参加しよう', backgroundFamily: 'white' }),
  Object.freeze({ index: 5, number: 6, category: 'committee', label: '実行委員会企画を体験しよう', backgroundFamily: 'salmon' }),
  Object.freeze({ index: 6, number: 7, category: 'committee', label: '実行委員会企画を体験しよう', backgroundFamily: 'salmon' }),
  Object.freeze({ index: 7, number: 8, category: 'stage_feedback', label: '発表をみて感想を書こう', backgroundFamily: 'white' }),
  Object.freeze({ index: 8, number: 9, category: 'workshop', label: '体験工房で体験しよう', backgroundFamily: 'lightblue' }),
]);

export const CELL_COUNT = CELLS.length;
