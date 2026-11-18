// built-in-key.ts

/*
 * Copyright (c) 2023-2026 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

// use the built-in prototypes to find each type's default toJSON method.
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

// find the nearest prototype that defines toJSON.
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

// check whether the value uses its built-in serializer, including across realms.
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

// key Buffers and Uint8Arrays by their type and bytes.
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

/**
 * Builds a type-specific cache key for supported built-in values.
 *
 * @param original The value before JSON serialization.
 * @param serialized The value passed to the JSON replacer after any `toJSON` call.
 * @returns The type-specific key, or `undefined` to use the normal serialization path.
 */
export default function builtInKey(
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
