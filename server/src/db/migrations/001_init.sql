-- 001_init: initial schema. One database file holds exactly one event.
-- TODO(DECISION-C21): multi-event support would need event_id on every table.

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE draw_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  saved_at TEXT NOT NULL
) STRICT;

-- Append-only business log. Secrets are never written here.
CREATE TABLE action_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_json TEXT NOT NULL,
  result TEXT NOT NULL,
  message TEXT,
  revision_after INTEGER
) STRICT;
CREATE INDEX action_log_type ON action_log(action_type);

-- Idempotency keys for staff commands (§15 C08).
CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE machines (
  machine_id TEXT PRIMARY KEY,
  device_token_hash TEXT UNIQUE,
  token_issued_at TEXT,
  last_heartbeat_at TEXT,
  boot_id TEXT,
  heartbeat_json TEXT
) STRICT;

-- Receive progress per machine, boot and stream (§15 C09, C10).
CREATE TABLE device_streams (
  machine_id TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('ball', 'card')),
  last_seq INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (machine_id, boot_id, stream)
) STRICT;

CREATE TABLE device_events (
  machine_id TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('ball', 'card')),
  seq INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  detected_at TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  outcome_json TEXT NOT NULL,
  PRIMARY KEY (machine_id, boot_id, stream, seq)
) STRICT;

CREATE TABLE card_reads (
  read_id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  read_seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('paper', 'digital')),
  cells_json TEXT,
  corner_present INTEGER,
  qr_payload_present INTEGER NOT NULL DEFAULT 0,
  -- The QR claim is verified on receipt and never stored; only the card id is kept.
  qr_card_id TEXT,
  qr_error TEXT,
  read_at TEXT,
  received_at TEXT NOT NULL,
  image_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'dismissed', 'superseded')),
  session_id TEXT,
  UNIQUE (machine_id, boot_id, read_seq)
) STRICT;

CREATE TABLE cards (
  card_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('paper', 'digital')),
  token_hash TEXT UNIQUE,
  created_at TEXT NOT NULL,
  used_session_id TEXT,
  used_machine_id TEXT,
  used_at TEXT,
  intake_json TEXT
) STRICT;

CREATE TABLE stamp_points (
  point_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cell_index INTEGER CHECK (cell_index BETWEEN 0 AND 8),
  category TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK (cell_index IS NOT NULL OR category IS NOT NULL)
) STRICT;

CREATE TABLE stamps (
  card_id TEXT NOT NULL REFERENCES cards(card_id),
  cell_index INTEGER NOT NULL CHECK (cell_index BETWEEN 0 AND 8),
  point_id TEXT NOT NULL REFERENCES stamp_points(point_id),
  stamped_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  PRIMARY KEY (card_id, cell_index),
  UNIQUE (card_id, point_id)
) STRICT;

-- Venue map. Coordinates are map units (metres when the official drawing is
-- supplied); x/y is the floor position, w/d the footprint, h the block height.
CREATE TABLE map_places (
  place_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('booth', 'stage', 'facility', 'outdoor', 'area')),
  name TEXT NOT NULL,
  short_name TEXT,
  organizer TEXT,
  description TEXT,
  category TEXT,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL CHECK (w > 0),
  d REAL NOT NULL CHECK (d > 0),
  h REAL NOT NULL CHECK (h >= 0),
  color TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE stage_programs (
  program_id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES map_places(place_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  organizer TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'changed', 'cancelled')),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE map_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  venue_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE surveys (
  card_id TEXT PRIMARY KEY REFERENCES cards(card_id),
  answers_json TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  gift_at TEXT,
  gift_by TEXT
) STRICT;

CREATE TABLE staff (
  staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'prize', 'printer')),
  passcode_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE staff_sessions (
  session_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(staff_id),
  machine_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE kiosk_pairings (
  code_hash TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT NOT NULL
) STRICT;

CREATE TABLE kiosk_devices (
  kiosk_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  machine_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  delete_after TEXT NOT NULL
) STRICT;
