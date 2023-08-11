// memoize.spec.ts

/*
 * Copyright (c) 2023 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

import { strict as assert } from 'node:assert';

import memoize from './index';

describe('memoize', () => {
  it('returns the same value as the underlying function', async () => {
    assert.equal(await memoize(async () => 123)(), 123);
    assert.equal(await memoize(async (argument) => argument)(456), 456);
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
    assert.deepEqual(await Promise.all([promise1, promise2, promise3]), ['hello world', 'hello world', 'hello world']);
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
    assert.deepEqual(await Promise.all([promise1, promise2, promise3]), ['hello 1', 'hello 2', 'hello 3']);
    assert.equal(count, 3);
  });

  it('returns the same promise for identical object arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (first: { x: number }, second: { y: number }) => {
      count += 1;
      return `${JSON.stringify(first)} ${JSON.stringify(second)}`;
    });
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
      return `${JSON.stringify(argumentList)}`;
    });
    const promise1 = memoizedFunction({ a: 2, b: 1 }, 2, { a: 1, b: { x: 'a', y: 'b' } }, { b: 2, c: 3, a: [2, 1] });
    const promise2 = memoizedFunction({ b: 1, a: 2 }, 2, { b: { y: 'b', x: 'a' }, a: 1 }, { b: 2, a: [2, 1], c: 3 });
    const promise3 = memoizedFunction({ b: 1, a: 2 }, { b: { y: 'b', x: 'a' }, a: 1 }, { b: 2, a: [2, 1], c: 3 }, 2);
    const promise4 = memoizedFunction({ b: 2, a: [2, 1], c: 3 }, 2, { b: { y: 'b', x: 'a' }, a: 1 }, { b: 1, a: 2 });
    assert.equal(promise1, promise2);
    assert.notEqual(promise1, promise3);
    assert.notEqual(promise1, promise4);
    assert.notEqual(promise3, promise4);
    assert.deepEqual(await Promise.all([promise1, promise2]), [
      '[{"a":2,"b":1},2,{"a":1,"b":{"x":"a","y":"b"}},{"b":2,"c":3,"a":[2,1]}]',
      '[{"a":2,"b":1},2,{"a":1,"b":{"x":"a","y":"b"}},{"b":2,"c":3,"a":[2,1]}]',
    ]);
    assert.equal(await promise3, '[{"b":1,"a":2},{"b":{"y":"b","x":"a"},"a":1},{"b":2,"a":[2,1],"c":3},2]');
    assert.equal(await promise4, '[{"b":2,"a":[2,1],"c":3},2,{"b":{"y":"b","x":"a"},"a":1},{"b":1,"a":2}]');
    assert.equal(count, 3);
  });

  it('supports bigint arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return `${JSON.stringify(argumentList, (_, value: unknown) => {
        if (typeof value === 'bigint') {
          return `${value}n`;
        }
        return value;
      })}`;
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

  it('supports unique undefined vs null arguments', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return `${JSON.stringify(argumentList)}`;
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
      return `${JSON.stringify(argumentList)}`;
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

  it('throw TypeError if passed a function argument', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (_: unknown) => {
      count += 1;
    });
    // Typescript won't allow this to happen, but Javascript will
    assert.throws(() => memoizedFunction(memoizedFunction as unknown as string), {
      name: 'TypeError',
      message: 'Function arguments cannot be memoized',
    });
    assert.equal(count, 0);
  });

  it('throw TypeError if passed a non-literal object argument', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (_: unknown) => {
      count += 1;
      return count;
    });

    assert.equal(await memoizedFunction({}), 1);
    assert.equal(await memoizedFunction(Object.create({})), 1);
    // eslint-disable-next-line no-new-object
    assert.equal(await memoizedFunction(new Object() as Record<string, string>), 1);

    assert.equal(await memoizedFunction([]), 2);
    // eslint-disable-next-line unicorn/prefer-spread
    assert.equal(await memoizedFunction(Array.from([])), 2);
    // eslint-disable-next-line unicorn/no-new-array
    assert.equal(await memoizedFunction(new Array(0)), 2);
    // eslint-disable-next-line @typescript-eslint/no-array-constructor
    assert.equal(await memoizedFunction(new Array()), 2);

    assert.throws(() => memoizedFunction(new WeakMap() as unknown as string), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new Map() as unknown as string), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new WeakSet() as unknown as string), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new Set() as unknown as string), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });
    assert.throws(() => memoizedFunction(new Error() as unknown as string), {
      name: 'TypeError',
      message: 'Object argument cannot be memoized',
    });

    assert.equal(count, 2);
  });
});
