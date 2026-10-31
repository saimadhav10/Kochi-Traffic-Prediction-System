export type Product = "base" | "traffic" | "flow" | "geocode" | "route";
export interface Statement {
  bind(...values: (string | number)[]): Statement;
}
export interface QuotaDatabase {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ success: boolean }[]>;
}
export class QuotaError extends Error {
  code: string;
  status: number;
  constructor(
    code:
      | "USAGE_LIMIT_REACHED"
      | "RATE_LIMIT_REACHED"
      | "VISITOR_LIMIT_REACHED"
      | "QUOTA_UNAVAILABLE",
  ) {
    super(code);
    this.code = code;
    this.status = code === "QUOTA_UNAVAILABLE" ? 503 : 429;
  }
}

export const budgets: Record<
  Product,
  { daily: number; rolling: number; perSecond: number; perIpMinute: number }
> = {
  base: { daily: 1800, rolling: 120_000, perSecond: 10, perIpMinute: 180 },
  traffic: { daily: 1800, rolling: 120_000, perSecond: 8, perIpMinute: 180 },
  flow: { daily: 100, rolling: 8_000, perSecond: 1, perIpMinute: 12 },
  geocode: { daily: 100, rolling: 8_000, perSecond: 1, perIpMinute: 10 },
  route: { daily: 200, rolling: 12_000, perSecond: 1, perIpMinute: 10 },
};

export async function anonymousIdentity(
  ip: string | null,
  salt: string,
  date: Date,
): Promise<string> {
  if (!ip || ip.length > 80 || !/^[a-fA-F0-9:.]+$/.test(ip) || salt.length < 32)
    throw new QuotaError("QUOTA_UNAVAILABLE");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${date.toISOString().slice(0, 10)}:${ip}`),
    ),
  );
  return [...bytes.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function reserveQuota(
  db: QuotaDatabase,
  product: Product,
  identity: string,
  now = new Date(),
): Promise<void> {
  const budget = budgets[product],
    day = now.toISOString().slice(0, 10),
    second = Math.floor(now.getTime() / 1000),
    minute = Math.floor(second / 60);
  const window = (id: string, ceiling: number, expires: number) =>
    db
      .prepare(
        `
    INSERT INTO quota_windows(id, used, ceiling, expires_at) VALUES (?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET used = used + 1, ceiling = excluded.ceiling
  `,
      )
      .bind(id, ceiling, expires);
  try {
    // D1 batches are transactional. Any exceeded counter rolls back every reservation.
    const result = await db.batch([
      window(
        `ip:${identity}:${product}:${minute}`,
        budget.perIpMinute,
        (minute + 2) * 60,
      ),
      window(`burst:${product}:${second}`, budget.perSecond, second + 120),
      window(
        `all:${day}`,
        4000,
        Date.parse(`${day}T00:00:00Z`) / 1000 + 172_800,
      ),
      db
        .prepare(
          `INSERT INTO quota_usage(product, day, used, daily_limit, rolling_limit) VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(product, day) DO UPDATE SET used = used + 1, daily_limit = excluded.daily_limit, rolling_limit = excluded.rolling_limit
      `,
        )
        .bind(product, day, budget.daily, budget.rolling),
    ]);
    if (result.length !== 4 || result.some((item) => !item.success))
      throw new Error("Accounting failed");
  } catch (error) {
    // Never forward database error details or a raw visitor identity.
    const message = error instanceof Error ? error.message : "";
    throw new QuotaError(
      message.includes("RATE_LIMIT_REACHED")
        ? "RATE_LIMIT_REACHED"
        : message.includes("VISITOR_LIMIT_REACHED")
          ? "VISITOR_LIMIT_REACHED"
          : message.includes("QUOTA_LIMIT_REACHED")
            ? "USAGE_LIMIT_REACHED"
            : "QUOTA_UNAVAILABLE",
    );
  }
}

export async function cleanQuotas(db: QuotaDatabase, now = new Date()) {
  // Short-lived, anonymous burst counters expire. Daily aggregate usage is kept 33 days.
  return db.batch([
    db
      .prepare("DELETE FROM quota_windows WHERE expires_at < ?")
      .bind(Math.floor(now.getTime() / 1000)),
    db
      .prepare("DELETE FROM quota_usage WHERE day < date(?, '-32 days')")
      .bind(now.toISOString().slice(0, 10)),
  ]);
}
