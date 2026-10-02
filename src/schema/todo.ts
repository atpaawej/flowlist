import { Schema } from "effect";

export const PrioritySchema = Schema.Union([
  Schema.Literal("low"),
  Schema.Literal("medium"),
  Schema.Literal("high"),
]);

export const SortOptionSchema = Schema.Union([
  Schema.Literal("custom"),
  Schema.Literal("priority"),
  Schema.Literal("dueDate"),
  Schema.Literal("createdAt"),
]);

export const StatusFilterSchema = Schema.Union([
  Schema.Literal("active"),
  Schema.Literal("completed"),
  Schema.Literal("all"),
]);

export const CreateTodoSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  dueDate: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  priority: Schema.optional(PrioritySchema),
  tagNames: Schema.optional(Schema.Array(Schema.String)),
});

export const UpdateTodoSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  dueDate: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  priority: Schema.optional(PrioritySchema),
  completed: Schema.optional(Schema.Boolean),
  sortOrder: Schema.optional(Schema.Number),
  tagNames: Schema.optional(Schema.Array(Schema.String)),
});

export const ReorderSchema = Schema.Struct({
  orderedIds: Schema.Array(Schema.String),
});

export type CreateTodoInput = typeof CreateTodoSchema.Type;
export type UpdateTodoInput = typeof UpdateTodoSchema.Type;
