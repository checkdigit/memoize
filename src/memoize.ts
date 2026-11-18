// memoize.ts

/*
 * Copyright (c) 2023-2026 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

// arguments must be stringify-able
export type Argument =
  string | symbol | bigint | number | boolean | null | undefined | object;

export type MemoizableFunction<Arguments extends Argument[], Return> = (
  ...argumentList: Arguments
) => Promise<Return>;

const jsonValueTypes = [
  ['Date', Date.prototype],
  ['URL', URL.prototype],
  ['Temporal.Instant', Temporal.Instant.prototype],
  ['Temporal.PlainDate', Temporal.PlainDate.prototype],
  ['Temporal.PlainDateTime', Temporal.PlainDateTime.prototype],
  ['Temporal.PlainTime', Temporal.PlainTime.prototype],
  ['Temporal.PlainYearMonth', Temporal.PlainYearMonth.prototype],
  ['Temporal.PlainMonthDay', Temporal.PlainMonthDay.prototype],
  ['Temporal.Duration', Temporal.Duration.prototype],
  ['Temporal.ZonedDateTime', Temporal.ZonedDateTime.prototype],
] as const;

function toJSONPrototype(original: object): object | undefined {
  let prototype = Reflect.getPrototypeOf(original);
  while (prototype !== null) {
    if (Object.hasOwn(prototype, 'toJSON')) {
      return prototype;
    }
    prototype = Reflect.getPrototypeOf(prototype);
  }
  return undefined;
}

function hasDefaultToJSON(
  prototype: object | undefined,
  expected: unknown,
): boolean {
  if (prototype === undefined) {
    return expected === undefined;
  }

  const serializer: unknown = Object.getOwnPropertyDescriptor(
    prototype,
    'toJSON',
  )?.value;
  // other realms have different function objects for the same built-in.
  return (
    typeof serializer === 'function' &&
    typeof expected === 'function' &&
    (serializer === expected ||
      Function.prototype.toString.call(serializer) ===
        Function.prototype.toString.call(expected))
  );
}

function binaryValueKey(original: object): string | undefined {
  if (!ArrayBuffer.isView(original)) {
    return undefined;
  }
  const buffer = typeof Buffer === 'undefined' ? undefined : Buffer;
  const isBuffer = buffer?.isBuffer(original) === true;
  const bufferPrototype: unknown = buffer?.prototype;
  const serializer: unknown =
    isBuffer && typeof bufferPrototype === 'object' && bufferPrototype !== null
      ? Object.getOwnPropertyDescriptor(bufferPrototype, 'toJSON')?.value
      : undefined;
  if (!hasDefaultToJSON(toJSONPrototype(original), serializer)) {
    return undefined;
  }

  try {
    const bytes = Uint8Array.prototype.toBase64.call(original as Uint8Array);
    return `${isBuffer ? 'Buffer' : 'Uint8Array'}:${bytes}`;
  } catch {
    // the intrinsic rejects other views, even if they have a matching type tag.
    return undefined;
  }
}

function builtInValueKey(
  original: object,
  serialized: string | object | null,
): string | undefined {
  if (Object.hasOwn(original, 'toJSON')) {
    return undefined;
  }

  if (typeof serialized === 'object' && serialized !== null) {
    return binaryValueKey(original);
  }

  const prototype = toJSONPrototype(original);
  if (prototype === undefined) {
    return undefined;
  }
  // Date.prototype lacks a toStringTag. The intrinsic below verifies the brand.
  const tag: unknown =
    Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value ??
    'Date';
  const match = jsonValueTypes.find(([type]) => type === tag);
  if (match === undefined) {
    return undefined;
  }
  const serializer: unknown = Object.getOwnPropertyDescriptor(
    match[1],
    'toJSON',
  )?.value;
  if (!hasDefaultToJSON(prototype, serializer)) {
    return undefined;
  }

  try {
    if (tag === 'Date') {
      const time = Date.prototype.getTime.call(original);
      const json = Number.isNaN(time)
        ? null
        : Date.prototype.toISOString.call(original);
      return json === serialized ? `Date:${time}` : undefined;
    }

    // check the intrinsic brand instead of trusting Symbol.toStringTag alone.
    if (match[1].toJSON.call(original) !== serialized) {
      return undefined;
    }

    switch (match[0]) {
      case 'Temporal.Duration': {
        // JSON preserves the larger units and combines seconds with the subsecond fields.
        const { milliseconds, microseconds, nanoseconds } =
          original as Temporal.Duration;
        return `Temporal.Duration:${serialized}:${milliseconds},${microseconds},${nanoseconds}`;
      }
      case 'Temporal.PlainYearMonth': {
        return `Temporal.PlainYearMonth:${Temporal.PlainYearMonth.prototype.toString.call(original, { calendarName: 'always' })}`;
      }
      case 'Temporal.PlainMonthDay': {
        return `Temporal.PlainMonthDay:${Temporal.PlainMonthDay.prototype.toString.call(original, { calendarName: 'always' })}`;
      }
      case 'Temporal.ZonedDateTime': {
        const { epochNanoseconds, timeZoneId, calendarId } =
          original as Temporal.ZonedDateTime;
        return `Temporal.ZonedDateTime:${epochNanoseconds},${timeZoneId},${calendarId}`;
      }
      default: {
        return `${match[0]}:${serialized}`;
      }
    }
  } catch {
    return undefined;
  }
}

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
            const builtInKey = builtInValueKey(original, value);
            if (builtInKey !== undefined) {
              return `${seed}:${builtInKey}`;
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
