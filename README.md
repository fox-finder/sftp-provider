
# sftp-provider

sftp provider for [@fox-finder](https://github.com/fox-finder)

## Usage

```bash
yarn add @fox-finder/sftp-provider
```

```typescript
import { IFile, FileProvider } from '@fox-finder/base'
import { SFTPProvider } from '@fox-finder/sftp-provider';

const sftpProvider = new SFTPProvider({
  /* options... */
});

sftpProvider.listFile('/Users/mypath/somefiles').then(data => {
  console.log('\n - list data \n', data);
});
```

## Acknowledgements

- [ssh2](https://github.com/mscdex/ssh2)
- [ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client)
