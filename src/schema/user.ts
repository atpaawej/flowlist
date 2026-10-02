import { Schema } from "effect";

export const UserSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export type UserInput = typeof UserSchema.Type;
