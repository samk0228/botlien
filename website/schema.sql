-- Botlien analytics. One flat event table, because every question this
-- dashboard answers is "how many of X in window W", and a single indexed
-- table answers all of them without a join.
--
-- `session` is the column that makes the funnel honest: a funnel counted in
-- raw events would let one person reloading the demo six times look like six
-- prospects. Every stage is counted in DISTINCT sessions instead.
--
-- `label` is the free slot: which demo tab was opened, which deck slide was
-- reached. `value` is the numeric slot: seconds spent, slide number.
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event    TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  session  TEXT,
  value    REAL,
  label    TEXT,
  path     TEXT,
  referrer TEXT,
  country  TEXT
);

-- Every dashboard query is a time window, usually narrowed to one event.
CREATE INDEX IF NOT EXISTS idx_events_ts       ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_event_ts ON events(event, ts);
-- The funnel groups by session inside a window.
CREATE INDEX IF NOT EXISTS idx_events_session  ON events(session, event);
