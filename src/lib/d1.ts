import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import {
  DatabaseError,
  type DatabaseService,
} from "@/services/Database";

/**
 * Minimal structural type for a Cloudflare D1 binding — avoids needing
 * @cloudflare/workers-types in application code.
 */
interface D1Statement {
  bind(...params: unknown[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Binding {
  prepare(sql: string): D1Statement;
}

/**
 * Production driver: uses the native `DB` binding available inside the
 * Cloudflare Worker (set by OpenNext via the wrangler config).
 */
function bindingDatabase(db: D1Binding): DatabaseService {
  return {
    all: <T>(sql: string, params: readonly unknown[] = []) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(sql)
            .bind(...params)
            .all<T>()
            .then((r) => r.results),
        catch: (cause) => new DatabaseError(`D1 query failed: ${sql}`, cause),
      }),
    execute: (sql: string, params: readonly unknown[] = []) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(sql)
            .bind(...params)
            .run()
            .then(() => undefined),
        catch: (cause) => new DatabaseError(`D1 execute failed: ${sql}`, cause),
      }),
  };
}

/**
 * Development driver: talks to the REAL remote D1 database over the
 * Cloudflare D1 REST API, so local dev never touches a local database.
 */
function restDatabase(config: {
  accountId: string;
  databaseId: string;
  token: string;
}): DatabaseService {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;

  const query = async <T>(
    sql: string,
    params: readonly unknown[]
  ): Promise<T[]> => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params: [...params] }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`D1 REST API ${res.status}: ${text}`);
    }

    const json = (await res.json()) as {
      success: boolean;
      errors?: unknown[];
      result?: Array<{ results: T[] }>;
    };

    if (!json.success) {
      throw new Error(`D1 REST API error: ${JSON.stringify(json.errors)}`);
    }

    return json.result?.[0]?.results ?? [];
  };

  return {
    all: <T>(sql: string, params: readonly unknown[] = []) =>
      Effect.tryPromise({
        try: () => query<T>(sql, params),
        catch: (cause) => new DatabaseError(`D1 query failed: ${sql}`, cause),
      }),
    execute: (sql: string, params: readonly unknown[] = []) =>
      Effect.tryPromise({
        try: () => query(sql, params).then(() => undefined),
        catch: (cause) => new DatabaseError(`D1 execute failed: ${sql}`, cause),
      }),
  };
}

/**
 * Reads the wrangler OAuth session token from its config file so local dev
 * can authenticate against the Cloudflare API without extra setup.
 */
function readWranglerToken(): string {
  const candidates = [
    process.env.APPDATA &&
      path.join(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml"),
    path.join(os.homedir(), ".wrangler", "config", "default.toml"),
    path.join(os.homedir(), ".config", ".wrangler", "config", "default.toml"),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      const token = content.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
      const expires = content.match(/expiration_time\s*=\s*"([^"]+)"/)?.[1];

      if (!token) continue;
      if (expires && new Date(expires).getTime() < Date.now()) {
        throw new Error(
          "Your wrangler session has expired. Run `wrangler whoami` to refresh it, " +
            "or set CLOUDFLARE_API_TOKEN in .env.local."
        );
      }
      return token;
    } catch (e) {
      if (e instanceof Error && e.message.includes("wrangler session")) throw e;
    }
  }

  throw new Error(
    "No Cloudflare credentials found for local dev. " +
      "Either run `wrangler whoami` to sign in, or set CLOUDFLARE_API_TOKEN in .env.local."
  );
}

/**
 * Resolves the database driver for the current runtime:
 * 1. Inside the Cloudflare Worker (production) → native D1 binding
 * 2. Otherwise (local `next dev`) → D1 REST API against the remote database
 */
export async function getDatabase(): Promise<DatabaseService> {
  const context = (
    globalThis as Record<PropertyKey, unknown>
  )[Symbol.for("__cloudflare-context__")] as
    | { env?: Record<string, unknown> }
    | undefined;

  const binding = context?.env?.DB as D1Binding | undefined;
  if (binding && typeof binding.prepare === "function") {
    return bindingDatabase(binding);
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  if (!accountId || !databaseId) {
    throw new Error(
      "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_D1_DATABASE_ID in .env.local."
    );
  }

  const token =
    process.env.CLOUDFLARE_API_TOKEN?.trim() || readWranglerToken();

  return restDatabase({ accountId, databaseId, token });
}
