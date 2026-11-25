// memoize.ts

import builtInKey from './built-in-key.ts';

// arguments must be stringify-able
export type Argument =
  string | symbol | bigint | number | boolean | null | undefined | object;

export type MemoizableFunction<Arguments extends Argument[], Return> = (
  ...argumentList: Arguments
) => Promise<Return>;

export interface MemoizeCache<Key, Return> {
  get: (key: Key) => Promise<Return> | undefined;
  peek?: (key: Key) => Promise<Return> | undefined;
  set: (key: Key, value: Promise<Return>) => void;
  delete: (key: Key) => void;
}

interface StructuralCacheOptions<Return> {
  cacheKey?: undefined;
  cache?: MemoizeCache<string, NoInfer<Return>>;
}

interface CustomKeyOptions<Arguments extends Argument[], Return, Key> {
  cacheKey: (argumentList: Readonly<Arguments>) => Key;
  cache?: MemoizeCache<Key, NoInfer<Return>>;
}

export type MemoizeOptions<Arguments extends Argument[], Return, Key = string> =
  StructuralCacheOptions<Return> | CustomKeyOptions<Arguments, Return, Key>;

function createStructuralKey(): (argumentList: readonly Argument[]) => string {
  const referenceIds = new WeakMap<object | symbol, number>();

  // use a random seed to distinguish encoded values from ordinary strings
  const seed = crypto.getRandomValues(new Uint32Array(4)).join('-');

  let referenceId = 0;
  const nextReferenceId = () => ++referenceId;

  return (argumentList) => {
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
            const registeredKey = Symbol.keyFor(value);
            if (registeredKey !== undefined) {
              return `${seed}:symbol:registered:${registeredKey}`;
            }
            return `${seed}:symbol:${referenceIds.getOrInsertComputed(value, nextReferenceId)}`;
          }

          case 'function': {
            return `${seed}:function:${referenceIds.getOrInsertComputed(value, nextReferenceId)}`;
          }

          case 'object': {
            if (value === null) {
              return null;
            }
            // if the object is an array, it is safe to memoize
            if (Array.isArray(value)) {
              return value as unknown[];
            }
            // check the prototype so an own constructor property can be ordinary data.
            const prototype = Reflect.getPrototypeOf(value);
            const constructor: unknown =
              prototype === null
                ? undefined
                : Reflect.get(prototype, 'constructor', value);
            // each realm has its own Object constructor with the same native source.
            if (
              constructor === Object ||
              (typeof constructor === 'function' &&
                Function.prototype.toString.call(constructor) ===
                  Function.prototype.toString.call(Object))
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
    return JSON.stringify(JSON.parse(converted), (_, value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value;
      }
      const record = value as Record<string, unknown>;
      // eslint-disable-next-line sonarjs/no-alphabetical-sort, unicorn/require-array-sort-compare -- use default UTF-16 code-unit ordering
      const keys = Object.keys(record).toSorted();
      return Object.fromEntries(keys.map((key) => [key, record[key]]));
    });
  };
}

function memoizeWithKey<Arguments extends Argument[], Return, Key>(
  memoizableFunction: MemoizableFunction<Arguments, Return>,
  keyFor: (arguments_: Arguments) => Key,
  cache: MemoizeCache<Key, Return> = new Map<Key, Promise<Return>>(),
): MemoizableFunction<Arguments, Return> {
  return (...argumentList) => {
    const key = keyFor(argumentList);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const promise = memoizableFunction(...argumentList);
    // eslint-disable-next-line @checkdigit/no-promise-instance-method, unicorn/prefer-await -- preserve the cached promise's identity
    promise.catch(() => {
      try {
        // custom cache may have evicted this promise and stored a newer one.
        const current =
          cache.peek === undefined ? cache.get(key) : cache.peek(key);
        if (current === promise) {
          cache.delete(key);
        }
      } catch {
        // cache error during cleanup must not create a second rejection.
      }
    });
    cache.set(key, promise);
    return promise;
  };
}

/**
 * Memoizes an async function by caching its original promise until eviction or rejection.
 *
 * @param memoizableFunction Async function to memoize.
 * @param options Optional key function and synchronous cache.
 */
export default function memoize<Arguments extends Argument[], Return>(
  memoizableFunction: MemoizableFunction<Arguments, Return>,
  options?: StructuralCacheOptions<Return>,
): MemoizableFunction<Arguments, Return>;
export default function memoize<Arguments extends Argument[], Return, Key>(
  memoizableFunction: MemoizableFunction<Arguments, Return>,
  options?: MemoizeOptions<Arguments, Return, Key>,
): MemoizableFunction<Arguments, Return>;
export default function memoize<Arguments extends Argument[], Return, Key>(
  memoizableFunction: MemoizableFunction<Arguments, Return>,
  options: MemoizeOptions<Arguments, Return, Key> = {},
): MemoizableFunction<Arguments, Return> {
  const { cacheKey, cache } = options;
  if (cacheKey === undefined) {
    return memoizeWithKey(memoizableFunction, createStructuralKey(), cache);
  }

  return memoizeWithKey(
    memoizableFunction,
    (argumentList) => cacheKey([...argumentList]),
    cache,
  );
}
