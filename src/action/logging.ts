import * as core from "@actions/core";

export function logInfo(message: string): void {
  core.info(message);
}

export function logWarning(message: string): void {
  core.warning(message);
}

export function logError(message: string): void {
  core.error(message);
}

export function logDebug(message: string): void {
  core.debug(message);
}

export async function withLogGroup<T>(name: string, fn: () => Promise<T>): Promise<T> {
  core.startGroup(name);
  try {
    return await fn();
  } finally {
    core.endGroup();
  }
}
