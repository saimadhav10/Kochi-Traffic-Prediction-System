import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  anonymousIdentity,
  reserveQuota,
  cleanQuotas,
} from "../src/server/quota.ts";
import { handleApi } from "../src/server/api.ts";

const now = new Date("2026-10-31T12:00:00Z");
const salt = "test-only-quota-salt-at-least-32-characters";
const secret = "test-only-provider-credential";
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_quotas.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0002_rate_limits.sql", import.meta.url),
      "utf8",
    ),
  );
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          return { sql, values };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map((statement) => {
          sqlite.prepare(statement.sql).run(...statement.values);
          return { success: true };
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite };
}
const publicRequest = (extra = {}) =>
  new Request("https://kochi.example/api/flow?lat=9.98&lon=76.30", {
    headers: { "cf-connecting-ip": "203.0.113.42", ...extra },
  });
const publicEnv = (db) => ({
  TOMTOM_API_KEY: secret,
  QUOTA_DB: db,
  QUOTA_SALT: salt,
  PUBLIC_ACCESS_ENABLED: "true",
});
const seed = (sqlite, product, day, count, rolling = 120_000) =>
  sqlite
    .prepare("INSERT INTO quota_usage VALUES (?, ?, ?, ?, ?)")
    .run(product, day, count, count, rolling);

test("atomic reservations admit only one concurrent request at the daily boundary and roll back all other counters", async (t) => {
  const { db, sqlite } = fixture(t);
  seed(sqlite, "base", "2026-10-31", 1799);
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, (_, index) =>
      reserveQuota(db, "base", `visitor-${index}`, now),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT used FROM quota_usage WHERE product='base'").get()
      .used,
    1800,
  );
  assert.equal(
    sqlite
      .prepare("SELECT used FROM quota_windows WHERE id='all:2026-10-31'")
      .get().used,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM quota_windows").get().n,
    3,
  );
  for (const result of results.filter((result) => result.status === "rejected"))
    assert.equal(result.reason.code, "USAGE_LIMIT_REACHED");
});

test("rolling usage covers 32 UTC dates and is not reset by a deployment or month change", async (t) => {
  const { db, sqlite } = fixture(t);
  seed(sqlite, "route", "2026-10-01", 12_000, 12_000);
  await assert.rejects(
    reserveQuota(db, "route", "visitor", new Date("2026-11-01T00:00:00Z")),
    { code: "USAGE_LIMIT_REACHED" },
  );
  await reserveQuota(db, "route", "visitor", new Date("2026-11-02T00:00:00Z"));
  assert.equal(
    sqlite.prepare("SELECT used FROM quota_usage WHERE day='2026-11-02'").get()
      .used,
    1,
  );
});

test("per-IP minute limits and global bursts apply across independently constructed adapters", async (t) => {
  const { db, sqlite } = fixture(t);
  const otherAdapter = { prepare: db.prepare, batch: db.batch };
  for (let i = 0; i < 10; i++)
    await reserveQuota(
      i % 2 ? db : otherAdapter,
      "geocode",
      "visitor",
      new Date(now.getTime() + i * 2000),
    );
  await assert.rejects(
    reserveQuota(
      otherAdapter,
      "geocode",
      "visitor",
      new Date(now.getTime() + 25_000),
    ),
    { code: "VISITOR_LIMIT_REACHED" },
  );
  await reserveQuota(
    db,
    "geocode",
    "visitor",
    new Date(now.getTime() + 60_000),
  );
  await assert.rejects(
    reserveQuota(
      otherAdapter,
      "geocode",
      "different-visitor",
      new Date(now.getTime() + 60_000),
    ),
    { code: "RATE_LIMIT_REACHED" },
  );
  assert.equal(
    sqlite.prepare("SELECT used FROM quota_usage WHERE product='geocode'").get()
      .used,
    11,
  );
});

test("the global daily admission ceiling rolls back a product reservation", async (t) => {
  const { db, sqlite } = fixture(t);
  sqlite
    .prepare("INSERT INTO quota_windows VALUES (?, ?, ?, ?)")
    .run("all:2026-10-31", 4000, 4000, 9999999999);
  await assert.rejects(reserveQuota(db, "route", "visitor", now), {
    code: "USAGE_LIMIT_REACHED",
  });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM quota_usage").get().n,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM quota_windows").get().n,
    1,
  );
  await reserveQuota(db, "route", "visitor", new Date("2026-11-01T00:00:00Z"));
});

test("anonymous identities are salted, rotate daily, and do not store the raw IP", async () => {
  const first = await anonymousIdentity("203.0.113.42", salt, now);
  assert.equal(first.length, 32);
  assert.ok(!first.includes("203.0.113"));
  assert.equal(await anonymousIdentity("203.0.113.42", salt, now), first);
  assert.notEqual(
    await anonymousIdentity("203.0.113.42", salt + "different", now),
    first,
  );
  assert.notEqual(
    await anonymousIdentity("203.0.113.42", salt, new Date("2026-11-01")),
    first,
  );
  await assert.rejects(anonymousIdentity(null, salt, now), {
    code: "QUOTA_UNAVAILABLE",
  });
});

test("counter cleanup removes expired anonymous entries but retains the rolling aggregate window", async (t) => {
  const { db, sqlite } = fixture(t);
  await reserveQuota(db, "route", "visitor", new Date("2026-09-01T00:00:00Z"));
  await reserveQuota(db, "route", "visitor", now);
  await cleanQuotas(db, new Date(now.getTime() + 180_000));
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM quota_windows WHERE id LIKE 'ip:%'")
      .get().n,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM quota_usage").get().n,
    1,
  );
});

test("accounting failures stop provider calls and never expose database error details", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {};
        },
      };
    },
    async batch() {
      throw new Error(`database unavailable: ${secret}`);
    },
  };
  let calls = 0;
  const response = await handleApi(publicRequest(), publicEnv(db), async () => {
    calls++;
    throw new Error();
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), { error: "QUOTA_UNAVAILABLE" });
});

test("a failed upstream call remains charged once with no automatic provider retries", async (t) => {
  const { db, sqlite } = fixture(t);
  let calls = 0;
  const response = await handleApi(publicRequest(), publicEnv(db), async () => {
    calls++;
    return new Response(secret, { status: 403 });
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.equal(
    sqlite.prepare("SELECT used FROM quota_usage WHERE product='flow'").get()
      .used,
    1,
  );
  assert.ok(!(await response.text()).includes(secret));
});

test("missing configuration, missing trusted identity and cross-site calls cannot forward to TomTom", async (t) => {
  const { db } = fixture(t);
  const requests = [
    [publicRequest(), { ...publicEnv(db), QUOTA_DB: undefined }],
    [publicRequest(), { ...publicEnv(db), QUOTA_SALT: "" }],
    [publicRequest(), { ...publicEnv(db), PUBLIC_ACCESS_ENABLED: "false" }],
    [publicRequest({ origin: "https://other.example" }), publicEnv(db)],
    [
      new Request("https://kochi.example/api/flow?lat=9.98&lon=76.3"),
      publicEnv(db),
    ],
  ];
  for (const [request, env] of requests) {
    let called = false;
    const response = await handleApi(request, env, async () => {
      called = true;
      throw new Error();
    });
    assert.ok([403, 503].includes(response.status));
    assert.equal(called, false);
  }
});

const png = () =>
  new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
const tileRequest = () =>
  new Request("https://kochi.example/api/tiles/base/12/2916/1933.png", {
    headers: { "cf-connecting-ip": "203.0.113.42" },
  });

test("a stalled public fetch cannot strand other requests in the same Worker isolate", async (t) => {
  const { db } = fixture(t);
  let release, started;
  const firstStarted = new Promise((resolve) => {
    started = resolve;
  });
  const first = handleApi(tileRequest(), publicEnv(db), () => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  await firstStarted;
  let timeout;
  try {
    const second = await Promise.race([
      handleApi(tileRequest(), publicEnv(db), async () => png()),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Second request was stranded")),
          1000,
        );
      }),
    ]);
    assert.equal(second.status, 200);
  } finally {
    clearTimeout(timeout);
    release(png());
    await first;
  }
});

test("a short tile burst retries only rolled-back accounting before making one provider call", async () => {
  let reservations = 0,
    providerCalls = 0;
  const db = {
    prepare() {
      return {
        bind() {
          return {};
        },
      };
    },
    async batch() {
      if (++reservations === 1)
        throw new Error("CHECK constraint failed: RATE_LIMIT_REACHED");
      return Array.from({ length: 4 }, () => ({ success: true }));
    },
  };
  const response = await handleApi(tileRequest(), publicEnv(db), async () => {
    providerCalls++;
    return png();
  });
  assert.equal(response.status, 200);
  assert.equal(reservations, 2);
  assert.equal(providerCalls, 1);
});
