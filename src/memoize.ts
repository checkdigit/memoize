// memoize.ts

/*
 * Copyright (c) 2023-2026 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

import builtInKey from './built-in-key.ts';

// arguments must be stringify-able
export type Argument =
  string | symbol | bigint | number | boolean | null | undefined | object;

export type MemoizableFunction<Arguments extends Argument[], Return> = (
  ...argumentList: Arguments
) => Promise<Return>;

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
  const functionKeys = new WeakMap<object, string>();

  // use a random seed to distinguish encoded values from ordinary strings
  const seed = crypto.getRandomValues(new Uint32Array(4)).join('-');
  let referenceId = 0;

  return (...argumentList) => {
    const converted = JSON.stringify(
      argumentList,
      // eslint-disable-next-line sonarjs/function-return-type
      function (this: object, key: string, value: Argument) {
        if (typeof value === 'string' || typeof value === 'object') {
          // JSON.stringify calls toJSON before the replacer. Read data properties without invoking getters again.
          const original: unknown = Object.getOwnPropertyDescriptor(
            this,
            key,
          )?.value;
          if (typeof original === 'object' && original !== null) {
            const builtInKeyResult = builtInKey(original, value);
            if (builtInKeyResult !== undefined) {
              return `${seed}:${builtInKeyResult}`;
            }
          }
        }

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
              symbolUniqueStringValue = `${seed}:symbol:${++referenceId}`;
              symbols.set(value, symbolUniqueStringValue);
            }
            return symbolUniqueStringValue;
          }

          case 'function': {
            let functionKey = functionKeys.get(value);
            if (functionKey === undefined) {
              functionKey = `${seed}:function:${++referenceId}`;
              functionKeys.set(value, functionKey);
            }
            return functionKey;
          }

          case 'object': {
            if (value === null) {
              return null;
            }
            // if the object is an array, it is safe to memoize
            if (Array.isArray(value)) {
              return value as unknown[];
            }
            // Check the prototype so an own constructor property can be ordinary data.
            const prototype = Reflect.getPrototypeOf(value);
            if (
              prototype !== null &&
              Reflect.get(prototype, 'constructor', value) === Object
            ) {
              return value;
            }
            throw new TypeError(`Object argument cannot be memoized`);
          }

          case 'number': {
            if (Object.is(value, -0)) {
              return `${seed}:number:-0`;
            }
            // JSON.stringify would otherwise serialize all non-finite numbers as null
            return Number.isFinite(value) ? value : `${seed}:number:${value}`;
          }

          case 'boolean':
          case 'string': {
            return value;
          }
        }
      },
    );

    // sort each object's own keys while preserving array order.
    const cacheKey = JSON.stringify(
      JSON.parse(converted),
      (_, value: unknown) => {
        if (
          value === null ||
          typeof value !== 'object' ||
          Array.isArray(value)
        ) {
          return value;
        }
        const record = value as Record<string, unknown>;
        // eslint-disable-next-line sonarjs/no-alphabetical-sort, unicorn/require-array-sort-compare -- use default UTF-16 code-unit ordering
        const keys = Object.keys(record).toSorted();
        return Object.fromEntries(keys.map((key) => [key, record[key]]));
      },
    );

    let value = cache.get(cacheKey);
    if (value === undefined) {
      value = memoizableFunction(...argumentList);
      cache.set(cacheKey, value);
      // eslint-disable-next-line @checkdigit/no-promise-instance-method, unicorn/prefer-await -- preserve the cached promise's identity
      value.catch(() => {
        // on a reject, evict key from cache
        cache.delete(cacheKey);
      });
    }
    return value;
  };
};
