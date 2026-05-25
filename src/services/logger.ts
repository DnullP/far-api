/**
 * Frontend logger – mirrors console methods and forwards logs to the Rust backend.
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('httpClient', 'request sent', { url });
 *   logger.error('appStore', 'failed to load', { err });
 */

import { forwardFrontendLog, type FrontendLogEntry } from "../api/logApi";
import { safeStringify } from "../api/logSanitizer";

function send(entry: FrontendLogEntry) {
  // Fire-and-forget: don't await, don't let failures propagate
  forwardFrontendLog({
    ...entry,
    href: typeof window === "undefined" ? undefined : window.location.href,
    ts: Date.now(),
  }).catch(() => {});
}

function formatData(data?: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  return typeof data === 'string' ? data : safeStringify(data);
}

export const logger = {
  error(module: string, message: string, data?: unknown) {
    const formatted = formatData(data);
    console.error(`[logger:${module}]`, message, formatted ?? '');
    send({ level: 'error', module, message, data: formatted });
  },

  warn(module: string, message: string, data?: unknown) {
    const formatted = formatData(data);
    console.warn(`[logger:${module}]`, message, formatted ?? '');
    send({ level: 'warn', module, message, data: formatted });
  },

  info(module: string, message: string, data?: unknown) {
    const formatted = formatData(data);
    console.info(`[logger:${module}]`, message, formatted ?? '');
    send({ level: 'info', module, message, data: formatted });
  },

  debug(module: string, message: string, data?: unknown) {
    const formatted = formatData(data);
    console.debug(`[logger:${module}]`, message, formatted ?? '');
    send({ level: 'debug', module, message, data: formatted });
  },
};
