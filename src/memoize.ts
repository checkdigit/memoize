// memoize.ts

/*
 * Copyright (c) 2023-2025 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

// arguments must be stringify-able
export type Argument =
  | string
  | symbol
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
  const symbols = new Map<symbol, string>();

  // use a random seed so the cache key remains unique when serializing BigInts and undefined into strings
  const seed = crypto.randomUUID();

  return (...argumentList) => {
    const keys = new Set<string | number>();
    // eslint-disable-next-line sonarjs/function-return-type
    const converted = JSON.stringify(argumentList, (key, value: Argument) => {
      // create a set of all object keys used in the argument list
      keys.add(key);

      // convert BigInts, symbols and undefined to unique strings
      switch (typeof value) {
        case 'bigint': {
          return `${seed}:${value}n`;
        }

        case 'undefined': {
          return `${seed}:undefined'`;
        }

        case 'symbol': {
          let symbolUniqueStringValue = symbols.get(value);
          if (symbolUniqueStringValue === undefined) {
            symbolUniqueStringValue = `${seed}:symbol:${crypto.randomUUID()}`;
            symbols.set(value, symbolUniqueStringValue);
          }
          return symbolUniqueStringValue;
        }

        case 'function': {
          throw new TypeError('Function arguments cannot be memoized');
        }

        case 'object': {
          if (value === null) {
            return null;
          }
          // if the object is an array, it is safe to memoize
          if (Array.isArray(value)) {
            return value;
          }
          // if the object doesn't inherit from anything, it is safe to memoize
          if (value.constructor === Object) {
            return value;
          }
          throw new TypeError(`Object argument cannot be memoized`);
        }

        case 'number':
        case 'boolean':
        case 'string': {
          return value;
        }
      }
    });

    // create a cache key so that e.g. [{ a: 1, b: 2 }] and [{ b: 2, a: 1 }] map to the same cache entry
    // eslint-disable-next-line sonarjs/no-alphabetical-sort
    const cacheKey = JSON.stringify(JSON.parse(converted), [...keys].sort());

    let value = cache.get(cacheKey);
    if (value === undefined) {
      value = memoizableFunction(...argumentList);
      cache.set(cacheKey, value);
      // eslint-disable-next-line @checkdigit/no-promise-instance-method
      value.catch(() => {
        // on a reject, evict key from cache
        cache.delete(cacheKey);
      });
    }
    return value;
  };
};
