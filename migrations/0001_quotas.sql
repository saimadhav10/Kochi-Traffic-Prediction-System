-- Counters only: no API keys, addresses, coordinates, or journey history.
CREATE TABLE quota_usage (
  product TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL CHECK (used > 0),
  daily_limit INTEGER NOT NULL,
  rolling_limit INTEGER NOT NULL,
  PRIMARY KEY (product, day),
  CONSTRAINT QUOTA_LIMIT_REACHED CHECK (used <= daily_limit)
) WITHOUT ROWID;

-- Today plus the preceding 31 UTC dates covers every 31-day billing period.
CREATE TRIGGER quota_usage_insert BEFORE INSERT ON quota_usage BEGIN
  SELECT CASE WHEN COALESCE((SELECT SUM(used) FROM quota_usage
    WHERE product = NEW.product AND day >= date(NEW.day, '-31 days')), 0) + NEW.used > NEW.rolling_limit
    THEN RAISE(ABORT, 'QUOTA_LIMIT_REACHED') END;
END;
CREATE TRIGGER quota_usage_update BEFORE UPDATE ON quota_usage BEGIN
  SELECT CASE WHEN COALESCE((SELECT SUM(used) FROM quota_usage
    WHERE product = NEW.product AND day >= date(NEW.day, '-31 days')), 0) - OLD.used + NEW.used > NEW.rolling_limit
    THEN RAISE(ABORT, 'QUOTA_LIMIT_REACHED') END;
END;

CREATE TABLE quota_windows (
  id TEXT PRIMARY KEY,
  used INTEGER NOT NULL CHECK (used > 0),
  ceiling INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CONSTRAINT QUOTA_LIMIT_REACHED CHECK (used <= ceiling)
) WITHOUT ROWID;
CREATE INDEX quota_windows_expiry ON quota_windows(expires_at);
