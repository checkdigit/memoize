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

  it.only('returns same promise for identical object arguments even if keys in different orders', async () => {
    let count = 0;
    const memoizedFunction = memoize(async (...argumentList) => {
      count += 1;
      return `${JSON.stringify(argumentList)}`;
    });
    const promise1 = memoizedFunction({ a: 2, b: 1 }, 2, { a: 1, b: { x: 'a', y: 'b' } }, { b: 2, c: 3, a: [2, 1] });
    const promise2 = memoizedFunction({ b: 1, a: 2 }, 2, { b: { y: 'b', x: 'a' }, a: 1 }, { b: 2, a: [2, 1], c: 3 });
    const promise3 = memoizedFunction({ b: 1, a: 2 }, { b: { y: 'b', x: 'a' }, a: 1 }, { b: 2, a: [2, 1], c: 3 }, 2);
    assert.equal(promise1, promise2);
    assert.notEqual(promise1, promise3);
    assert.deepEqual(await Promise.all([promise1, promise2]), [
      '[{"a":2,"b":1},2,{"a":1,"b":{"x":"a","y":"b"}},{"b":2,"c":3,"a":[2,1]}]',
      '[{"a":2,"b":1},2,{"a":1,"b":{"x":"a","y":"b"}},{"b":2,"c":3,"a":[2,1]}]',
    ]);
    assert.deepEqual(await promise3, '[{"b":1,"a":2},{"b":{"y":"b","x":"a"},"a":1},{"b":2,"a":[2,1],"c":3},2]');
    assert.equal(count, 2);
  });
});
