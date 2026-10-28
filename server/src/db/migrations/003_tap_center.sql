-- 003_tap_center: cell ⑤ (ビンゴに参加しよう) is achieved by tapping it on the
-- digital card; it has no stamp QR (2026-10-28). The token_hash is not a
-- sha256 hex value, so no scanned QR can ever match this point.
INSERT OR IGNORE INTO stamp_points (point_id, name, cell_index, category, token_hash, active, created_at)
VALUES ('tap-cell-5', '⑤ ビンゴに参加しよう（タップ）', 4, NULL, 'tap-only:cell-5', 1, '2026-10-28T00:00:00.000+09:00');
