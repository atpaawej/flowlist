import { Layer } from "effect";
import { makeDatabaseLayer, type DatabaseService } from "@/services/Database";
import { UserService, UserServiceLayer, type UserServiceApi } from "@/services/UserService";
import { TodoService, TodoServiceLayer, type TodoServiceApi } from "@/services/TodoService";
import { TagService, TagServiceLayer, type TagServiceApi } from "@/services/TagService";

export { Database } from "@/services/Database";
export { UserService, TodoService, TagService };
export type { UserServiceApi, TodoServiceApi, TagServiceApi };

/** Every service the app layer provides. */
export type AppServices =
  | DatabaseService
  | UserServiceApi
  | TodoServiceApi
  | TagServiceApi;

/**
 * Composes every service for a single request. The database driver (native
 * D1 binding in production, REST API in local dev) is passed in so the same
 * layer graph works in both environments.
 */
export function makeAppLayer(db: DatabaseService): Layer.Layer<AppServices> {
  const dbLayer = makeDatabaseLayer(db);

  return Layer.mergeAll(
    dbLayer,
    UserServiceLayer.pipe(Layer.provide(dbLayer)),
    TodoServiceLayer.pipe(Layer.provide(dbLayer)),
    TagServiceLayer.pipe(Layer.provide(dbLayer))
  );
}
