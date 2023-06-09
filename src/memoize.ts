// memoize.ts

/*
 * Copyright (c) 2021-2023 Check Digit, LLC
 *
 * This code is licensed under the MIT license (see LICENSE.txt for details).
 */

import type { URL } from 'node:url';

// arguments must be stringify-able
export type Argument = string | number | boolean | null | Date | URL | Argument[] | { [key: string]: Argument };

/**
 * Memoize an async function.  The promise is cached, not the value.  This guarantees the underlying function is
 * called at most once for a given set of arguments, unless the promise is rejected.
 * If the promise is rejected, it will be removed from the memoize cache.  This allows the function to be retried.
 *
 * @param function_ function to memoize
 */
export default <Return, Arguments extends Argument[]>(
  function_: (...arguments_: Arguments) => Promise<Return>
): ((...arguments_: Arguments) => Promise<Return>) => {
  const cache = new Map<string, Promise<Return>>();
  return (...arguments_) => {
    const key = JSON.stringify(arguments_);
    let value = cache.get(key);
    if (value === undefined) {
      value = function_(...arguments_);
      cache.set(key, value);
      value.catch(() => {
        // on a reject, evict key from cache
        cache.delete(key);
      });
    }
    return value;
  };
};
