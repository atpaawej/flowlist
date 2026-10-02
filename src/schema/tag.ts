import { Schema } from "effect";

export const CreateTagSchema = Schema.Struct({
  name: Schema.String,
});

export type CreateTagInput = typeof CreateTagSchema.Type;
