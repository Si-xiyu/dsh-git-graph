import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 先构建客户端产物（lib/client.js 入库，必须与 src/ 同步），再打包分发包。
await import('./build.mjs');

const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir(new URL('../dist', import.meta.url), { recursive: true });

execFileSync('npm', ['pack', '--pack-destination', 'dist'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

console.log('打包完成：dist/dsh-vsc-git-graph-<版本>.tgz');

// 顺手把给试用者的安装说明放到包旁边，两个文件一起发出去就够了。
const note = await readFile(new URL('../docs/TRIAL-INSTALL.md', import.meta.url), 'utf8');
await writeFile(new URL('../dist/试用说明.md', import.meta.url), note);
console.log('安装说明：dist/试用说明.md');
