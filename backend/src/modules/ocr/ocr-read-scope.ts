import {AsyncLocalStorage} from 'node:async_hooks';

// Inspection only. A write must never inherit a cached source or review.
const scope = new AsyncLocalStorage<Map<string, Promise<unknown>>>();
export function inspectOnce<T>(read: () => Promise<T>): Promise<T> {
 return scope.run(new Map(), read);
}
export function ocrReadOnce<T>(key: string, read: () => Promise<T>): Promise<T> {
 const cache = scope.getStore();
 if (!cache) return read();
 let result = cache.get(key);
 if (!result) { result = read(); cache.set(key, result); }
 return result as Promise<T>;
}
