
import { SFTPProvider } from '../src/index';

const sftpProvider = new SFTPProvider({
  host: '47.66.18.204',
  port: 22,
  username: 'root',
  password: 'password',
});

sftpProvider.ensureAvailability().then(() => {
  sftpProvider.listFile('/usr/local/wwwroot/nodepress')
    .then(data => {
      console.log('\n - list data \n', data, data.length);
    })
    .catch(error => {
      console.warn('\n - error \n', error);
    });

  sftpProvider.stat('/usr/local/wwwroot/nodepress').then(data => {
    console.log('\n - nodepress stat data \n', data);
  });

  sftpProvider.stat('/usr/local/wwwroot/nodepress/package.json').then(data => {
    console.log('\n - package stat data \n', data);
  });

  sftpProvider.readFile('/usr/local/wwwlogs/nodepress/out.log')
    .then(data => {
      console.log('\n - readFile data \n', data.toString());
    })
    .catch(error => {
      console.warn('\n - readFile error \n', error);
    });
});