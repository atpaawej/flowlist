import { Schema } from "effect";

export const EnvSchema = Schema.Struct({
  PORT: Schema.optional(Schema.String),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: Schema.String,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: Schema.optional(Schema.String),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: Schema.optional(Schema.String),
  CLERK_SECRET_KEY: Schema.String,
  CLOUDFLARE_ACCOUNT_ID: Schema.optional(Schema.String),
  CLOUDFLARE_D1_DATABASE_ID: Schema.optional(Schema.String),
  CLOUDFLARE_API_TOKEN: Schema.optional(Schema.String),
});

export type Env = typeof EnvSchema.Type;

export const parseEnv = (env: Record<string, string | undefined> = process.env) =>
  Schema.decodeUnknownSync(EnvSchema)(env);
