import { Effect, Exit, Cause } from "effect";

/**
 * Runs an Effect and returns a Promise resolving to the value,
 * or throwing a formatted error if it fails or defects.
 */
export async function runPromiseSafe<A, E>(
  effect: Effect.Effect<A, E>
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const pretty = Cause.pretty(exit.cause);
  throw new Error(`Effect execution failed: ${pretty}`);
}

/**
 * Refinement helper to check if an unknown error matches a specific class instance
 */
export function isInstanceOf<T>(ctor: new (...args: any[]) => T) {
  return (u: unknown): u is T => u instanceof ctor;
}
