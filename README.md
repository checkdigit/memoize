# Memoize

Copyright (c) 2023 [Check Digit, LLC](https://checkdigit.com)

`@checkdigit/memoize` memoizes async functions, with cache eviction on reject.
The resulting promise is cached, guaranteeing the underlying function is called at most once for a given set of
arguments, unless the promise ultimately rejects.

If the promise is rejected, it will be removed from the memoize cache.  
This allows the function to be retried.

### Install

```
$ npm install @checkdigit/memoize
```

### Use

```
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

## License

MIT
