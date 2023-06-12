# Memoize

Copyright (c) 2023 [Check Digit, LLC](https://checkdigit.com)

Memoize is a small async function used by Check Digit services for memoizing promises with cache eviction on reject.
The promise being cached guarantees the underlying function is called at most once for a given set of arguments, unless
the promise is rejected. If the promise is rejected, it will be removed from the memoize cache.  
This allows the function to be retried.

### Install

```
$ npm install @checkdigit/memoize
```

### Use

```
import { memoize } from '@checkdigit/memoize';

const promise = memoize((_param: _paramType) => _asyncFunction(_param));

const value = await promise(_paramValue);
```

## License

MIT
