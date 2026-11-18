# Memoize

Copyright © 2023-2026 [Check Digit, LLC](https://checkdigit.com)

`@checkdigit/memoize` memoizes async functions, with cache eviction on reject.
The resulting promise is cached, guaranteeing the underlying function is called at most once for a given set of
arguments, unless the promise ultimately rejects.

If the promise is rejected, it will be removed from the memoize cache.  
This allows the function to be retried.

## Install

```shell
$ npm install @checkdigit/memoize
```

## Use

```ts
import memoize from '@checkdigit/memoize';

async function doIt(parameter: number): Promise<number> {
  console.log('doing it', parameter); // doing it 123, doing it 456 (note parameter=123 only executed once)
  return parameter * 2;
}

const memoizedDoIt = memoize(doIt);

const value1 = await memoizedDoIt(123);
const value2 = await memoizedDoIt(456);
const value3 = await memoizedDoIt(123); // uses cached result

console.log('the results were', value1, value2, value3); // the results were 246 912 246
```

## Notes

`Uint8Array`, Node.js `Buffer`, `Date`, `URL`, and all eight built-in `Temporal` value types have type-specific
cache keys. Equal values of the same type share a cache entry, including when passed in arrays or as object data
properties.

`Uint8Array` and `Buffer` are keyed by their bytes and type. The corresponding JSON values have
separate cache entries.

## Cache options

Pass `cacheKey` to compute a key from the full argument list. A custom key skips structural serialization and
can use any value your cache accepts. Pass `cache` to use a synchronous store with `get`, `set`, and `delete`
methods. The store holds the original promises and returns `undefined` on a miss.

```ts
const cache = new Map<number, Promise<string>>();
const readName = memoize(
  async (user: { id: number; name: string }) => user.name,
  {
    cacheKey: ([user]) => user.id,
    cache,
  },
);

await readName({ id: 1, name: 'Alice' });
cache.delete(1);
```

Supply a dedicated cache or namespace keys when sharing one between functions. Evicting a pending promise
allows the next call for that key to start new work. The memoizer removes rejected promises it inserted.

### Bounded cache with `lru-cache`

Install `lru-cache` alongside `@checkdigit/memoize`. Given an async `getUser(id)` function that returns a `User`:

```ts
import memoize from '@checkdigit/memoize';
import { LRUCache } from 'lru-cache';

const user = memoize(getUser, {
  cacheKey: ([id]) => id,
  // cache keeps up to 500 entries. 60-second TTL starts when the promise is inserted.
  cache: new LRUCache({ max: 500, ttl: 60_000 }),
});
```

## License

MIT
