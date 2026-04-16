/**
 * Frontend logger – mirrors console methods and forwards logs to the Rust backend.
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('httpClient', 'request sent', { url });
 *   logger.error('appStore', 'failed to load', { err });
 */

import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: string;
}

function send(entry: LogEntry) {
  // Fire-and-forget: don't await, don't let failures propagate
  invoke('frontend_log', { entry }).catch(() => {});
}

function formatData(data?: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  try {
    return typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export const logger = {
  error(module: string, message: string, data?: unknown) {
    console.error(`[${module}]`, message, data ?? '');
    send({ level: 'error', module, message, data: formatData(data) });
  },

  warn(module: string, message: string, data?: unknown) {
    console.warn(`[${module}]`, message, data ?? '');
    send({ level: 'warn', module, message, data: formatData(data) });
  },

  info(module: string, message: string, data?: unknown) {
    console.info(`[${module}]`, message, data ?? '');
    send({ level: 'info', module, message, data: formatData(data) });
  },

  debug(module: string, message: string, data?: unknown) {
    console.debug(`[${module}]`, message, data ?? '');
    send({ level: 'debug', module, message, data: formatData(data) });
  },
};
