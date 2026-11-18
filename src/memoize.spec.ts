// memoize.spec.ts

/*
 * Copyright (c) 2023-2026 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { LRUCache } from 'lru-cache';

import memoize from './index.ts';

describe('memoize', () => {
  it('returns the same value as the underlying function', async () => {
    assert.equal(await memoize(async () => 123)(), 123);
    assert.equal(await memoize(async (argument) => argument)(456), 456);
    assert.equal(await memoize(async (argument) => argument)(false), false);
  });

  it('returns different rejected promise (delayed) given the same arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (first: string, second: string) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      if (count === 3) {
        return 'success';
      }
      throw new Error(`${first} ${second} ${count++}`);
    });
    const promise1 = memoizedFunction('hello', 'world');
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    const promise2 = memoizedFunction('hello', 'world');
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    const promise3 = memoizedFunction('hello', 'world');
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    const promise4 = memoizedFunction('hello', 'world');
    assert.notEqual(promise1, promise2);
    assert.notEqual(promise2, promise3);
    await assert.rejects(promise1, { message: 'hello world 0' });
    await assert.rejects(promise2, { message: 'hello world 1' });
    await assert.rejects(promise3, { message: 'hello world 2' });
    assert.equal(await promise4, 'success');
  });

  it('returns same rejected promise (immediate) given the same arguments', async () => {
    const memoizedFunction = memoize(async (first: string, second: string) => {
      throw new Error(`${first} ${second}`);
    });
    const promise1 = memoizedFunction('hello', 'world');
    const promise2 = memoizedFunction('hello', 'world');
    const promise3 = memoizedFunction('hello', 'world');
    assert.equal(promise1, promise2);
    assert.equal(promise2, promise3);
    await assert.rejects(promise1, { message: 'hello world' });
    await assert.rejects(promise2, { message: 'hello world' });
    await assert.rejects(promise3, { message: 'hello world' });
  });

  it('returns the same promise, ensuring function is only called once', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (first: string, second: string) => {
      count += 1;
      return `${first} ${second}`;
    });
    const promise1 = memoizedFunction('hello', 'world');
    const promise2 = memoizedFunction('hello', 'world');
    const promise3 = memoizedFunction('hello', 'world');
    assert.equal(promise1, promise2);
    assert.equal(promise2, promise3);
    assert.deepEqual(await Promise.all([promise1, promise2, promise3]), [
      'hello world',
      'hello world',
      'hello world',
    ]);
    assert.equal(count, 1);
  });

  it('returns different promises for different arguments, function is called each time', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (first: string, second: number) => {
      count += 1;
      return `${first} ${second}`;
    });
    const promise1 = memoizedFunction('hello', 1);
    const promise2 = memoizedFunction('hello', 2);
    const promise3 = memoizedFunction('hello', 3);
    assert.notEqual(promise1, promise2);
    assert.notEqual(promise2, promise3);
    assert.deepEqual(await Promise.all([promise1, promise2, promise3]), [
      'hello 1',
      'hello 2',
      'hello 3',
    ]);
    assert.equal(count, 3);
  });

  it('uses a custom key for arguments that cannot be structurally serialized', async () => {
    const first = Promise.resolve('first');
    const second = Promise.resolve('second');
    const cache = new Map<number, Promise<string>>();
    const memoizedFunction = memoize(
      (id: number, _data: Map<string, number>) => (id === 1 ? first : second),
      { cacheKey: ([id]) => id, cache },
    );

    assert.equal(memoizedFunction(1, new Map()), first);
    assert.equal(memoizedFunction(2, new Map()), second);
    assert.equal(cache.get(1), first);
    assert.equal(await first, 'first');
    assert.equal(memoizedFunction(1, new Map([['ignored', 2]])), first);
  });

  it('uses structural keys with a custom cache unless a key function is supplied', async () => {
    const cache = new Map<string, Promise<number>>();
    const memoizedFunction = memoize(
      async (value: { a: number; b: number }) => value.a + value.b,
      { cache },
    );
    const promise = memoizedFunction({ a: 1, b: 2 });
    assert.equal(memoizedFunction({ b: 2, a: 1 }), promise);
    assert.equal(await promise, 3);

    cache.clear();
    assert.notEqual(memoizedFunction({ a: 1, b: 2 }), promise);
  });

  it('reuses recent promises and recomputes evicted entries with lru-cache', async () => {
    const cache = new LRUCache<string, Promise<string>>({
      max: 2,
      ttl: 60_000,
    });
    const readUser = memoize(async (id: string) => id, {
      cacheKey: ([id]) => id,
      cache,
    });

    const first = readUser('first');
    const second = readUser('second');
    assert.equal(await first, 'first');
    // reading first again makes second the least recently used entry.
    assert.equal(readUser('first'), first);
    assert.equal(await readUser('third'), 'third');

    assert.equal(cache.size, 2);
    assert.equal(cache.has('first'), true);
    assert.equal(cache.has('second'), false);
    assert.equal(cache.has('third'), true);
    assert.equal(readUser('first'), first);
    assert.notEqual(readUser('second'), second);
  });

  it('preserves a replacement cache entry when an evicted promise rejects', async () => {
    const pending = Promise.withResolvers<number>();
    const cache = new Map<number, Promise<number>>();
    let result = pending.promise;
    const memoizedFunction = memoize(() => result, {
      cacheKey: () => 1,
      cache,
    });
    const evicted = memoizedFunction();
    cache.delete(1);
    result = Promise.resolve(2);
    const replacement = memoizedFunction();

    pending.reject(new Error('evicted promise failed'));
    await assert.rejects(evicted, /evicted promise failed/u);
    assert.equal(memoizedFunction(), replacement);
  });

  it('preserves the original rejection when a custom cache fails to delete it', async () => {
    const cache = new Map<string, Promise<never>>();
    const memoizedFunction = memoize(
      async () => {
        throw new Error('original failure');
      },
      {
        cache: {
          get: (key) => cache.get(key),
          set: (key, value) => cache.set(key, value),
          delete: () => {
            throw new Error('cache cleanup failed');
          },
        },
      },
    );

    await assert.rejects(memoizedFunction(), /original failure/u);
  });

  it('returns the same promise for identical object arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(
      async (first: { x: number }, second: { y: number }) => {
        count += 1;
        return `${JSON.stringify(first)} ${JSON.stringify(second)}`;
      },
    );
    const promise1 = memoizedFunction({ x: 1 }, { y: 1 });
    const promise2 = memoizedFunction({ x: 1 }, { y: 1 });
    const promise3 = memoizedFunction({ x: 1 }, { y: 1 });
    assert.equal(promise1, promise2);
    assert.equal(promise2, promise3);
    assert.deepEqual(await Promise.all([promise1, promise2, promise3]), [
      '{"x":1} {"y":1}',
      '{"x":1} {"y":1}',
      '{"x":1} {"y":1}',
    ]);
    assert.equal(count, 1);
  });

  it('returns same promise for identical object arguments even if keys are in different order', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return JSON.stringify(argumentList);
    });
    const promise1 = memoizedFunction(
      { a: 2, b: 1 },
      2,
      { a: 1, b: { x: 'a', y: 'b' } },
      { b: 2, c: 3, a: [2, 1] },
    );
    const promise2 = memoizedFunction(
      { b: 1, a: 2 },
      2,
      { b: { y: 'b', x: 'a' }, a: 1 },
      { b: 2, a: [2, 1], c: 3 },
    );
    const promise3 = memoizedFunction(
      { b: 1, a: 2 },
      { b: { y: 'b', x: 'a' }, a: 1 },
      { b: 2, a: [2, 1], c: 3 },
      2,
    );
    const promise4 = memoizedFunction(
      { b: 2, a: [2, 1], c: 3 },
      2,
      { b: { y: 'b', x: 'a' }, a: 1 },
      { b: 1, a: 2 },
    );
    assert.equal(promise1, promise2);
    assert.notEqual(promise1, promise3);
    assert.notEqual(promise1, promise4);
    assert.notEqual(promise3, promise4);
    assert.deepEqual(await Promise.all([promise1, promise2]), [
      '[{"a":2,"b":1},2,{"a":1,"b":{"x":"a","y":"b"}},{"b":2,"c":3,"a":[2,1]}]',
      '[{"a":2,"b":1},2,{"a":1,"b":{"x":"a","y":"b"}},{"b":2,"c":3,"a":[2,1]}]',
    ]);
    assert.equal(
      await promise3,
      '[{"b":1,"a":2},{"b":{"y":"b","x":"a"},"a":1},{"b":2,"a":[2,1],"c":3},2]',
    );
    assert.equal(
      await promise4,
      '[{"b":2,"a":[2,1],"c":3},2,{"b":{"y":"b","x":"a"},"a":1},{"b":1,"a":2}]',
    );
    assert.equal(count, 3);
  });

  it('only uses own object properties when sorting cache keys', async () => {
    const memoizedFunction = memoize(async (value: object, _other: object) =>
      Object.hasOwn(value, '__proto__'),
    );
    const other = { ['__proto__']: null };
    const withProperty = { ['__proto__']: other };

    assert.equal(await memoizedFunction({}, other), false);
    assert.equal(await memoizedFunction(withProperty, other), true);
  });

  it('supports bigint arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return JSON.stringify(argumentList, (_, value: unknown) => {
        if (typeof value === 'bigint') {
          return `${value}n`;
        }
        return value;
      });
    });
    const promise1 = memoizedFunction(1n, { a: 2n, b: [3n, -4n] }, 5n);
    const promise2 = memoizedFunction(1n, { a: 2n, b: [3, -4n] }, 5n);
    const promise3 = memoizedFunction(1n, { a: 2n, b: ['3n', -4n] }, 5n);
    assert.notEqual(promise1, promise2);
    assert.notEqual(promise1, promise3);
    assert.equal(await promise1, '["1n",{"a":"2n","b":["3n","-4n"]},"5n"]');
    assert.equal(await promise2, '["1n",{"a":"2n","b":[3,"-4n"]},"5n"]');
    assert.equal(await promise3, '["1n",{"a":"2n","b":["3n","-4n"]},"5n"]');
    assert.equal(count, 3);
  });

  it('distinguishes non-finite numbers from null and strings in cache keys', async () => {
    const memoizedFunction = memoize(async (argument) => argument);
    const values = [
      NaN,
      Infinity,
      -Infinity,
      null,
      'NaN',
      'Infinity',
      '-Infinity',
    ];
    const argumentsToTest = values.flatMap((value) => [
      value,
      [value],
      { value },
    ]);

    const promises = argumentsToTest.map((argument) =>
      memoizedFunction(argument),
    );
    assert.deepEqual(await Promise.all(promises), argumentsToTest);

    for (const [index, argument] of argumentsToTest.entries()) {
      assert.equal(memoizedFunction(argument), promises[index]);
    }
  });

  it('distinguishes positive and negative zero in cache keys', async () => {
    const memoizedFunction = memoize(async (value: number) => 1 / value);
    const negative = memoizedFunction(-0);

    assert.equal(await memoizedFunction(0), Infinity);
    assert.equal(await negative, -Infinity);
    assert.equal(memoizedFunction(-0), negative);
  });

  it('supports unique undefined vs null arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return JSON.stringify(argumentList);
    });
    const promise1 = memoizedFunction(1, undefined, 2);
    const promise2 = memoizedFunction(1, null, 2);
    const promise3 = memoizedFunction(1, undefined);
    const promise4 = memoizedFunction(1);
    const promise5 = memoizedFunction(1, 'undefined');

    // even though JSON.stringify converts undefined to null, memoize will still recognize the difference
    assert.notEqual(promise1, promise2);
    assert.notEqual(promise2, promise3);
    assert.notEqual(promise3, promise4);
    assert.notEqual(promise3, promise5);
    assert.equal(await promise1, '[1,null,2]');
    assert.equal(await promise2, '[1,null,2]');
    assert.equal(await promise3, '[1,null]');
    assert.equal(await promise4, '[1]');
    assert.equal(await promise5, '[1,"undefined"]');
    assert.equal(count, 5);
  });

  it('support unique symbol arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return JSON.stringify(argumentList);
    });
    const symbol1 = Symbol('hello');
    const symbol2 = Symbol('world');
    const promise1 = memoizedFunction(symbol1, symbol2);
    const promise2 = memoizedFunction(null, null);
    const promise3 = memoizedFunction(symbol1, symbol2);
    const promise4 = memoizedFunction(symbol1, symbol1);

    // even though JSON.stringify converts symbols to null, memoize will still recognize the difference
    assert.notEqual(promise1, promise2);
    assert.equal(promise1, promise3);
    assert.notEqual(promise3, promise4);
    assert.equal(await promise1, '[null,null]');
    assert.equal(await promise2, '[null,null]');
    assert.equal(await promise3, '[null,null]');
    assert.equal(await promise4, '[null,null]');
    assert.equal(count, 3);
  });

  it('uses function identity for direct and nested arguments', async () => {
    type Callback = () => number;
    const memoizedFunction = memoize(
      async (
        direct: Callback,
        [inArray]: [Callback],
        { inObject }: { inObject: Callback },
      ) => [direct(), inArray(), inObject()],
    );
    const createCallback = (value: number) => () => value;
    const first = createCallback(1);
    const second = createCallback(2);
    assert.equal(first.toString(), second.toString());

    const firstPromise = memoizedFunction(first, [first], { inObject: first });
    assert.equal(
      memoizedFunction(first, [first], { inObject: first }),
      firstPromise,
    );
    assert.deepEqual(await firstPromise, [1, 1, 1]);
    assert.deepEqual(
      await memoizedFunction(second, [first], { inObject: first }),
      [2, 1, 1],
    );
    assert.deepEqual(
      await memoizedFunction(first, [second], { inObject: first }),
      [1, 2, 1],
    );
    assert.deepEqual(
      await memoizedFunction(first, [first], { inObject: second }),
      [1, 1, 2],
    );
  });

  it('supports plain objects with a constructor data property', async () => {
    const memoizedFunction = memoize(
      async (value: { constructor: string }) => value.constructor,
    );
    const first = memoizedFunction({ constructor: 'widget' });

    assert.equal(memoizedFunction({ constructor: 'widget' }), first);
    assert.equal(await first, 'widget');
    assert.equal(await memoizedFunction({ constructor: 'gadget' }), 'gadget');
  });

  it('throw TypeError if passed a non-literal object argument', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (_: unknown) => {
      count += 1;
      return count;
    });

    assert.equal(await memoizedFunction({}), 1);
    assert.equal(await memoizedFunction(Object.create({})), 1);

    assert.equal(
      // eslint-disable-next-line no-object-constructor
      await memoizedFunction(new Object() as Record<string, string>),
      1,
    );

    assert.equal(await memoizedFunction([]), 2);
    assert.equal(await memoizedFunction(Array.from([])), 2);
    // eslint-disable-next-line unicorn/no-new-array
    assert.equal(await memoizedFunction(new Array(0)), 2);
    // eslint-disable-next-line @typescript-eslint/no-array-constructor
    assert.equal(await memoizedFunction(new Array()), 2);

    assert.throws(() => memoizedFunction(new WeakMap()), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new Map()), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new WeakSet()), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new Set()), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new Error()), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });

    assert.equal(count, 2);
  });

  it('supports Date arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return JSON.stringify(argumentList, (_, value: unknown) => {
        if (value instanceof Date) {
          return value.toISOString();
        }
        return value;
      });
    });
    const now = new Date();
    const alsoNow = new Date(now);
    const then = new Date(0);
    const promise1 = memoizedFunction(now);
    const promise2 = memoizedFunction(alsoNow);
    const promise3 = memoizedFunction(then);
    assert.equal(promise1, promise2);
    assert.notEqual(promise1, promise3);
    assert.equal(await promise1, `["${now.toISOString()}"]`);
    assert.equal(await promise2, `["${now.toISOString()}"]`);
    assert.equal(await promise3, `["${then.toISOString()}"]`);
    assert.equal(count, 2);
  });

  it('supports URL arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return JSON.stringify(argumentList, (_, value: unknown) => {
        if (value instanceof URL) {
          return value.toJSON();
        }
        return value;
      });
    });
    const url1 = new URL('https://example.com/');
    const url2 = new URL('https://example.com:443/');
    const url3 = new URL('https://other-example.com/');
    const promise1 = memoizedFunction(url1);
    const promise2 = memoizedFunction(url2);
    const promise3 = memoizedFunction(url3);
    assert.equal(promise1, promise2);
    assert.notEqual(promise1, promise3);
    assert.equal(await promise1, `["${url1}"]`);
    assert.equal(await promise2, `["${url1}"]`);
    assert.equal(await promise3, `["${url3}"]`);
    assert.equal(count, 2);
  });

  it('keys Buffer arguments by their bytes and distinguishes their JSON form', async () => {
    const buffer = Buffer.from([1, 2]);
    const sameBytes = Buffer.from([0, 1, 2, 3]).subarray(1, 3);
    const otherBytes = Buffer.from([1, 3]);
    const memoizedFunction = memoize(async (value: unknown) =>
      Buffer.isBuffer(value),
    );
    const memoizedNested = memoize(async ([{ value }]: [{ value: unknown }]) =>
      Buffer.isBuffer(value),
    );

    const promise = memoizedFunction(buffer);
    assert.equal(memoizedFunction(sameBytes), promise);
    assert.notEqual(memoizedFunction(otherBytes), promise);
    assert.equal(await promise, true);
    assert.equal(await memoizedFunction(buffer.toJSON()), false);

    const nested = memoizedNested([{ value: buffer }]);
    assert.equal(memoizedNested([{ value: sameBytes }]), nested);
    assert.equal(await memoizedNested([{ value: buffer.toJSON() }]), false);
  });

  it('keys Uint8Array arguments by bytes separately from Buffers and plain objects', async () => {
    const value = new Uint8Array([1, 2]);
    const sameBytes = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);
    const memoizedFunction = memoize(async (argument: unknown) => argument);

    const promise = memoizedFunction(value);
    assert.equal(memoizedFunction(sameBytes), promise);
    assert.notEqual(memoizedFunction(new Uint8Array([1, 3])), promise);
    assert.notEqual(memoizedFunction(Buffer.from(value)), promise);
    assert.notEqual(memoizedFunction({ 0: 1, 1: 2 }), promise);
    assert.equal(await promise, value);
  });

  it('keys Uint8Array values without a global Buffer', async () => {
    const memoizedFunction = memoize(async (value: Uint8Array) => value.length);
    const value = new Uint8Array([1, 2]);
    const bufferDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'Buffer',
    );
    assert.ok(bufferDescriptor);

    Object.defineProperty(globalThis, 'Buffer', { value: undefined });
    let promise: Promise<number>;
    try {
      promise = memoizedFunction(value);
      assert.equal(memoizedFunction(new Uint8Array([1, 2])), promise);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', bufferDescriptor);
    }
    assert.equal(await promise, 2);
  });

  it('rejects typed arrays other than Uint8Array', () => {
    const memoizedFunction = memoize(async (value: object) => value);
    assert.throws(() => memoizedFunction(new Int16Array([1, 2])), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
  });

  it('uses distinct cache keys for built-in values and their JSON representations', async () => {
    const createValues = () => [
      new Date(123),
      new Date(NaN),
      new URL('https://example.com/'),
      Temporal.Instant.from('1970-01-01T00:00:00.123Z'),
      Temporal.Instant.from('1970-01-01T00:00:00.123000001Z'),
      Temporal.PlainDate.from('2026-11-18'),
      Temporal.PlainDateTime.from('2026-11-18T12:30:00'),
      Temporal.PlainTime.from('12:30:00'),
      Temporal.PlainYearMonth.from('2026-11'),
      Temporal.PlainMonthDay.from('11-18'),
      Temporal.Duration.from('PT1S'),
      Temporal.ZonedDateTime.from('2026-11-18T12:30:00[UTC]'),
      Temporal.ZonedDateTime.from('2026-11-18T13:30:00[Europe/Paris]'),
    ];
    const values = createValues();
    const equivalents = createValues();
    const serialized = values.map((value) => value.toJSON());
    const memoizedFunction = memoize(async (argument: unknown) => argument);
    const memoizedNested = memoize(
      async (argument: { values: unknown[] }) => argument,
    );

    for (const [index, value] of values.entries()) {
      const promise = memoizedFunction(value);
      assert.equal(memoizedFunction(equivalents[index]), promise);
      assert.notEqual(memoizedFunction(serialized[index]), promise);
    }
    assert.equal(new Set(values.map(memoizedFunction)).size, values.length);

    const nestedPromise = memoizedNested({ values });
    assert.equal(memoizedNested({ values: equivalents }), nestedPromise);
    assert.notEqual(memoizedNested({ values: serialized }), nestedPromise);
    assert.equal((await nestedPromise).values, values);
  });

  it('uses inherited custom toJSON projections for cache keys', async () => {
    class LabeledDate extends Date {
      readonly label: string;

      constructor(label: string) {
        super(0);
        this.label = label;
      }

      override toJSON() {
        return this.label;
      }
    }

    const bytePrototype = {
      toJSON(this: { label: string }) {
        return { label: this.label };
      },
    };
    Reflect.setPrototypeOf(bytePrototype, Uint8Array.prototype);
    const labeledBytes = (label: string) => {
      const bytes = Object.assign(new Uint8Array([1, 2]), { label });
      Reflect.setPrototypeOf(bytes, bytePrototype);
      return bytes;
    };

    const readDate = memoize(async (value: LabeledDate) => value.label);
    const readBytes = memoize(
      async (value: ReturnType<typeof labeledBytes>) => value.label,
    );
    assert.equal(await readDate(new LabeledDate('first')), 'first');
    assert.equal(await readDate(new LabeledDate('second')), 'second');
    assert.equal(await readBytes(labeledBytes('first')), 'first');
    assert.equal(await readBytes(labeledBytes('second')), 'second');
  });

  it('uses custom JSON projections for date-like objects', () => {
    const memoizedFunction = memoize(async (value: unknown) => value);
    const dateWithCustomFormat = Object.assign(new Date(0), {
      toISOString: () => 'custom date format',
    });
    const dateLike = Object.create(Date.prototype, {
      valueOf: { value: () => 0 },
      toISOString: { value: () => 'date-like projection' },
    }) as object;
    const custom = Object.create({
      [Symbol.toStringTag]: 'Custom',
      toJSON: () => 'custom type projection',
    }) as object;

    assert.equal(
      memoizedFunction(dateWithCustomFormat),
      memoizedFunction('custom date format'),
    );
    assert.equal(
      memoizedFunction(dateLike),
      memoizedFunction('date-like projection'),
    );
    assert.equal(
      memoizedFunction(custom),
      memoizedFunction('custom type projection'),
    );
  });

  it('uses the serialized value when a proxy getter overrides the descriptor value', () => {
    const memoizedFunction = memoize(async (value: unknown) => value);
    const project = (value: object) =>
      new Proxy(
        { value },
        {
          get: (_target, key) => (key === 'value' ? 'projected' : undefined),
        },
      );
    const promise = memoizedFunction({ value: 'projected' });

    assert.equal(memoizedFunction(project({})), promise);
    assert.equal(memoizedFunction(project(new Temporal.Instant(0n))), promise);
  });

  it('recognizes built-in values from another realm', () => {
    const createValues = `[
      new Uint8Array([1, 2]),
      new Date(123),
      Temporal.Instant.fromEpochMilliseconds(123),
      Temporal.PlainDate.from('2026-11-18'),
      Temporal.PlainDateTime.from('2026-11-18T12:30:00'),
      Temporal.PlainTime.from('12:30:00'),
      Temporal.PlainYearMonth.from('2026-11'),
      Temporal.PlainMonthDay.from('11-18'),
      Temporal.Duration.from({ milliseconds: 1000 }),
      Temporal.ZonedDateTime.from('2026-11-18T12:30:00[UTC]'),
    ]`;
    // eslint-disable-next-line sonarjs/code-eval -- fixed test fixture, evaluated with local constructors
    const localValues = runInNewContext(createValues, {
      Uint8Array,
      Date,
      Temporal,
    }) as object[];
    // eslint-disable-next-line sonarjs/code-eval -- fixed test fixture, evaluated with foreign constructors
    const foreignValues = runInNewContext(createValues) as object[];
    const memoizedFunction = memoize(async (value: unknown) => value);

    for (const [index, value] of foreignValues.entries()) {
      const promise = memoizedFunction(value);
      assert.equal(memoizedFunction(localValues[index]), promise);
      const json = JSON.stringify(value);
      const projection = JSON.parse(json) as string | object;
      assert.notEqual(memoizedFunction(projection), promise);
    }
  });

  it('preserves Temporal fields that default JSON serialization combines or omits', () => {
    const duration = memoize(
      async (value: Temporal.Duration) => value.milliseconds,
    );
    const yearMonth = memoize(async (value: Temporal.PlainYearMonth) => value);
    const monthDay = memoize(async (value: Temporal.PlainMonthDay) => value);

    assert.notEqual(
      duration(Temporal.Duration.from({ seconds: 1 })),
      duration(Temporal.Duration.from({ milliseconds: 1000 })),
    );
    assert.notEqual(
      duration(Temporal.Duration.from({ milliseconds: 1 })),
      duration(Temporal.Duration.from({ microseconds: 1000 })),
    );
    assert.notEqual(
      yearMonth(new Temporal.PlainYearMonth(2026, 11, 'iso8601', 1)),
      yearMonth(new Temporal.PlainYearMonth(2026, 11, 'iso8601', 2)),
    );
    assert.notEqual(
      monthDay(new Temporal.PlainMonthDay(11, 18, 'iso8601', 2025)),
      monthDay(new Temporal.PlainMonthDay(11, 18, 'iso8601', 2026)),
    );
  });

  it('throw TypeError if passed a circular object argument', async () => {
    const memoizedFunction = memoize(async (value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'toJSON' in value &&
        typeof value.toJSON === 'function'
      ) {
        return value.toJSON();
      }
    });

    const object1 = { x: 1 } as { x: number; y: object; toJSON: () => string };
    object1.y = object1;

    assert.throws(() => memoizedFunction(object1), {
      name: 'TypeError',
      message:
        'Converting circular structure to JSON\n' +
        "    --> starting at object with constructor 'Object'\n" +
        "    --- property 'y' closes the circle",
    });

    // ...but it works if there is a toJSON() method
    object1.toJSON = () => 'string!';
    assert.equal(await memoizedFunction(object1), 'string!');
  });
});
