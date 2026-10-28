-- 002_drop_kiosk: the visitor-facing kiosk iPads were dropped from the venue
-- set-up (2026-10-28), so their pairing tables are no longer used.
DROP TABLE IF EXISTS kiosk_devices;
DROP TABLE IF EXISTS kiosk_pairings;
