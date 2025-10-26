import { Logger } from './logger';

export function time<T>(name: string, fn: () => T): T {
    const s = Date.now();
    const res = fn();
    Logger.debug(`${name} took ${Date.now() - s} ms`);
    return res;
}

