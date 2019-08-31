/**
 * @file SFTPProvider
 * @module SFTPProvider
 * @author Surmon <https://github.com/surmon-china>
 */

import * as path from 'path';
import * as Client from 'ssh2-sftp-client';
import { FileEntry } from 'ssh2-streams';
import { Client as SSH2Client, SFTPWrapper, ConnectConfig } from 'ssh2';
import { FileType, IFile, IFileStat, FoxFileProvider, transformOctalModeToStat, transformStatModeToOctal } from '@fox-finder/base';

export interface SFTPProviderOptions extends ConnectConfig {
  retries?: number;
  retry_factor?: number;
  retry_minTimeout?: number;
}

export class SFTPProvider implements FoxFileProvider<SFTPProviderOptions> {

  private sftpClient = null;
  private options: SFTPProviderOptions = null;

  private get ssh2Client(): SSH2Client {
    return this.sftpClient.client;
  }

  private get ssh2Sftp(): SFTPWrapper {
    return this.sftpClient.sftp;
  }

  private connect(): Promise<this> {
    return this.sftpClient.connect(this.options).then(() => this);
  }

  private sshExec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.ssh2Client.exec(command, (error, stream) => {
        if (error) {
          return reject(error);
        }
        stream.on('data',
          result => resolve(String(result)),
        )
        .stderr.on('data', reject);
      });
    });
  }

  constructor(options: SFTPProviderOptions) {
    this.options = options;
    this.sftpClient = new Client();
    this.connect();
  }

  private async getChildrenFilesRWState(targetPath: string): Promise<{ readables: string[], writables: string[] }> {
    const getCommand = type => `find ${path.join(targetPath, '*')} -maxdepth 0 -${type} -printf "%f\n"`;
    const [wCommand, rCommand] = [getCommand('writable'), getCommand('readable')];
    const getFiles = command => this.sshExec(command).then(
      files => files.split('\n').filter(name => !!name),
    );
    return {
      readables: await getFiles(rCommand),
      writables: await getFiles(wCommand),
    };
  }

  private checkAccess(filePath: string, type: 'w' | 'r'): Promise<boolean> {
    return this.sshExec(
      `if [ -${type} ${filePath} ]; then echo "true"; else echo "false"; fi`,
    ).then(
      result => Boolean(result),
    );
  }

  private isReadable(filePath: string): Promise<boolean> {
    return this.checkAccess(filePath, 'r');
  }

  private isWriteable(filePath: string): Promise<boolean> {
    return this.checkAccess(filePath, 'w');
  }

  private getSize(filePath: string): Promise<number> {
    return this.sshExec(
      `du -sb ${filePath} | awk "{print $1}"`,
      ).then(
        result => parseInt(result, 10),
      );
  }

  ensureAvailability(): Promise<this> {
    return this.ssh2Sftp
      ? Promise.resolve(this)
      : this.connect();
  }

  makeDir(targetPath: string, octalMode?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ssh2Sftp.mkdir(targetPath, { mode: octalMode }, error => {
        error ? reject(error) : resolve();
      });
    });
  }

  listFile(targetPath: string, keyword?: string): Promise<IFile[]> {
    return new Promise((resolve, reject) => {
      this.ssh2Sftp.readdir(targetPath, (error, list) => {
        if (error) {
          reject(error);
        } else {
          keyword = keyword && keyword.trim();
          resolve(
            keyword
              ? list.filter(file => file.filename.includes(keyword))
              : list,
          );
        }
      });
    })
    .then(async (list: FileEntry[]) => {
      const { writables, readables } = await this.getChildrenFilesRWState(targetPath);
      return list.map(file => {
        const fileType = file.longname.substr(0, 1);
        const fileMode = file.longname.substr(1, 9);
        const fullPath = path.join(targetPath, file.filename);
        const isDirectory = fileType === 'd';
        return {
          type: isDirectory ? FileType.Directory : FileType.File,
          name: file.filename,
          path: fullPath,
          size: file.attrs.size,
          ext: !isDirectory
            ? path.extname(file.filename).substr(1)
            : null,
          modify_at: file.attrs.mtime * 1000,
          access_at: file.attrs.atime * 1000,
          create_at: null,
          readable: readables.includes(file.filename),
          writeable: writables.includes(file.filename),
          unix: {
            mode_stat: fileMode,
            mode_octal: transformStatModeToOctal(fileMode),
            uid: String(file.attrs.uid),
            gid: String(file.attrs.uid),
          },
        };
      });
    });
  }

  writeFile(targetPath: string, data: Buffer, octalMode?: number): Promise<void> {
    const options = octalMode ? { mode: octalMode } : null;
    return this.sftpClient.put(data, targetPath, options);
  }

  readFile(targetPath: string): Promise<Buffer> {
    return this.sftpClient.get(targetPath);
  }

  stat(targetPath: string): Promise<IFileStat> {
    return new Promise((resolve, reject) => {
      this.ssh2Sftp.stat(targetPath, async (error, stats) => {
        if (error) {
          reject(error);
        } else {
          const isDirectory = stats.isDirectory();
          const statMode = transformOctalModeToStat(String(stats.mode));
          const newStat: IFileStat = {
            type: isDirectory ? FileType.Directory : FileType.File,
            name: path.basename(targetPath),
            path: targetPath,
            size: stats.size,
            ext: !isDirectory
              ? path.extname(targetPath).substr(1)
              : null,
            modify_at: stats.mtime * 1000,
            access_at: stats.atime * 1000,
            create_at: null,
            readable: await this.isReadable(targetPath),
            writeable: await this.isWriteable(targetPath),
            unix: {
              mode_stat: statMode,
              mode_octal: transformStatModeToOctal(statMode),
              uid: String(stats.uid),
              gid: String(stats.uid),
            },
          };

          if (isDirectory) {
            newStat.file_count = 0;
            newStat.directory_count = 0;
            newStat.total_size = await this.getSize(targetPath);
            const result = await this.sftpClient.list(targetPath);
            result.forEach(file => {
              if (file.type === 'd') {
                newStat.directory_count ++;
              } else {
                newStat.file_count ++;
              }
            });
          }
          resolve(newStat);
        }
      });
    });
  }

  copy(srcPath: string, destPath: string): Promise<string> {
    return this.sshExec(`cp ${srcPath} ${destPath}`);
  }

  move(srcPath: string, destPath: string): Promise<string> {
    return this.sshExec(`mv ${srcPath} ${destPath}`);
  }

  rename(srcPath: string, destPath: string): Promise<void> {
    return this.sftpClient.rename(srcPath, destPath);
  }

  remove(targetPath: string) {
    return this.sftpClient.delete(targetPath);
  }

  chmod(targetPath: string, mode: number): Promise<void> {
    return this.sftpClient.chmod(targetPath, mode);
  }
}
