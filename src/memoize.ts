// memoize.ts

/*
 * Copyright (c) 2023 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

// arguments must be stringify-able
export type Argument =
  | string
  | bigint
  | number
  | boolean
  | null
  | undefined
  | Date
  | URL
  | Argument[]
  | { [key: string]: Argument };

export type MemoizableFunction<Arguments extends Argument[], Return> = (...argumentList: Arguments) => Promise<Return>;

/**
 * Memoize an async function.  The promise is cached, not the value.  This guarantees the underlying function is
 * called at most once for a given set of arguments, unless the promise is rejected.
 * If the promise is rejected, it will be removed from the memoize cache.  This allows the function to be retried.
 *
 * @param memoizableFunction async function to memoize
 */
export default <Arguments extends Argument[], Return>(
  memoizableFunction: MemoizableFunction<Arguments, Return>,
): MemoizableFunction<Arguments, Return> => {
  const cache = new Map<string, Promise<Return>>();

  // use a random seed so the cache key remains unique when serializing BigInts and undefined into strings
  const seed = Math.random().toString();

  return (...argumentList) => {
    // create a set of all object keys used in the argument list
    const keys = new Set<string | number>();

    // in addition to building the set of keys, convert any BigInts to strings
    const converted = JSON.stringify(argumentList, (key, value: unknown) => {
      keys.add(key);
      if (typeof value === 'bigint') {
        return `${seed}:${value}n`;
      }
      if (value === undefined) {
        return `${seed}:undefined'`;
      }
      return value;
    });

    // create a cache key so that e.g. [{ a: 1, b: 2 }] and [{ b: 2, a: 1 }] map to the same cache entry
    const cacheKey = JSON.stringify(JSON.parse(converted), [...keys].sort());

    let value = cache.get(cacheKey);
    if (value === undefined) {
      value = memoizableFunction(...argumentList);
      cache.set(cacheKey, value);
      value.catch(() => {
        // on a reject, evict key from cache
        cache.delete(cacheKey);
      });
    }
    return value;
  };
};
