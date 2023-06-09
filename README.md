# Memoize

Copyright (c) 2021-2023 [Check Digit, LLC](https://checkdigit.com)

Memoize is a light-weight utility library used by Check Digit services for memoization purposes.

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
