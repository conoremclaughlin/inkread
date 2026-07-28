import { getClientStore } from '../store/clientStore';

/**
 * Crash visibility for release builds. React error boundaries only catch errors
 * thrown during render/lifecycle — an uncaught async error or a rejected promise
 * slips past and, with no red-box in release, leaves a blank page. So we also
 * install a global handler, and persist the last error to the client-store so it
 * survives a relaunch and can be retrieved and screenshotted after the fact.
 */

export interface RecordedError {
  message: string;
  stack?: string;
  /** Where it came from: 'render' | 'fatal' | 'uncaught' | a custom tag. */
  context?: string;
  at: string;
}

const KEY = 'last_error';

/** Pure — normalize any thrown value into a recordable shape. */
export function formatError(error: unknown, context: string | undefined, at: string): RecordedError {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack, context, at };
  }
  let message: string;
  try {
    message = typeof error === 'string' ? error : JSON.stringify(error);
  } catch {
    message = String(error);
  }
  return { message, context, at };
}

/** Persist the last error. Never throws — it runs on the failure path. */
export async function recordError(error: unknown, context?: string): Promise<void> {
  try {
    const store = await getClientStore();
    await store.setMeta(KEY, JSON.stringify(formatError(error, context, new Date().toISOString())));
  } catch {
    // Storage itself failed — nothing more we can safely do here.
  }
}

export async function getLastError(): Promise<RecordedError | undefined> {
  try {
    const store = await getClientStore();
    const raw = await store.getMeta(KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as RecordedError;
  } catch {
    return undefined;
  }
}

export async function clearLastError(): Promise<void> {
  try {
    const store = await getClientStore();
    await store.setMeta(KEY, '');
  } catch {
    // ignore
  }
}

interface ErrorUtilsShim {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

/**
 * Route uncaught JS errors (the ones an ErrorBoundary misses) to `onError` and
 * to storage, then chain the previous handler so dev red-boxes still work.
 * Returns whether a handler was installed (RN provides global.ErrorUtils).
 */
export function installGlobalErrorHandler(onError: (error: RecordedError) => void): boolean {
  const shim = (globalThis as { ErrorUtils?: ErrorUtilsShim }).ErrorUtils;
  if (!shim?.setGlobalHandler) return false;
  const previous = shim.getGlobalHandler?.();
  shim.setGlobalHandler((error, isFatal) => {
    const context = isFatal ? 'fatal' : 'uncaught';
    const record = formatError(error, context, new Date().toISOString());
    void recordError(error, context);
    try {
      onError(record);
    } finally {
      previous?.(error, isFatal);
    }
  });
  return true;
}
