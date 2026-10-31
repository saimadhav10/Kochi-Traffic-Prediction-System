-- Distinguish short product bursts from visitor and daily ceilings.
ALTER TABLE quota_windows RENAME TO quota_windows_previous;
CREATE TABLE quota_windows (
  id TEXT PRIMARY KEY,
  used INTEGER NOT NULL CHECK (used > 0),
  ceiling INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CONSTRAINT RATE_LIMIT_REACHED CHECK (id NOT LIKE 'burst:%' OR used <= ceiling),
  CONSTRAINT VISITOR_LIMIT_REACHED CHECK (id NOT LIKE 'ip:%' OR used <= ceiling),
  CONSTRAINT QUOTA_LIMIT_REACHED CHECK (id NOT LIKE 'all:%' OR used <= ceiling)
) WITHOUT ROWID;
INSERT INTO quota_windows SELECT * FROM quota_windows_previous;
DROP TABLE quota_windows_previous;
CREATE INDEX quota_windows_expiry ON quota_windows(expires_at);
