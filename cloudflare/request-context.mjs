// Per-request Worker ExecutionContext for server code that runs inside the app handler
// (2026-10-28 load audit, F12). worker.mjs runs each app request inside `runWithRequestContext`;
// `afterResponse` then hands background work to `waitUntil`, so the response returns first.
// The store lives on globalThis because the app server bundle (dist/server/index.mjs) and
// worker.mjs may each carry their own copy of this module.
import { AsyncLocalStorage } from "node:async_hooks";

/** @typedef {{ waitUntil(promise: Promise<unknown>): void }} WaitUntilContext */
const KEY = "__lootsplitRequestContext__";
/** @returns {Record<string, AsyncLocalStorage<WaitUntilContext> | undefined>} */
const shared = () => /** @type {any} */ (globalThis);
function storage() {
  const global = shared();
  return (global[KEY] ??= new AsyncLocalStorage());
}

/**
 * Runs `work` with `context` (a Worker ExecutionContext) available to `afterResponse`.
 * @template T
 * @param {WaitUntilContext | undefined} context
 * @param {() => T} work
 * @returns {T}
 */
export function runWithRequestContext(context, work) {
  return context && typeof context.waitUntil === "function"
    ? storage().run(context, work)
    : work();
}

/**
 * Runs `task` after the response when a Worker request context is available (waitUntil);
 * otherwise (tests, local dev, the standby host) it awaits `task` as before. `task` must handle
 * and log its own failures; a rejection is caught here so it never becomes unhandled.
 * @param {() => Promise<unknown>} task
 * @returns {Promise<void>}
 */
export async function afterResponse(task) {
  const context = shared()[KEY]?.getStore();
  if (context && typeof context.waitUntil === "function") {
    context.waitUntil(
      Promise.resolve()
        .then(task)
        .catch((error) => console.warn("Background task failed after the response.", error)),
    );
    return;
  }
  await task();
}
