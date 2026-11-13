import { readFile, writeFile } from 'node:fs/promises';
const sources = ['graph', 'diff', 'styles', 'view', 'module'];
const chunks = [];
for (const name of sources) {
  const source = await readFile(new URL('../src/' + name + '.js', import.meta.url), 'utf8').then(text => text.replace(/^\uFEFF/, ''));
  if (/\bimport\b|\bexport\s+default\b/.test(source)) throw new Error(name + ': 禁止模块导入或默认导出');
  const stripped = source.replace(/^[\t ]*export (?=(?:function|class|const)\s)/gm, '');
  if (/\bexport\b/.test(stripped)) throw new Error(name + ': 不支持的导出形式');
  chunks.push(stripped);
}
const output = `(() => {\nwindow.__ModuleLoader__.load({\nid: "dsh-vsc-git-graph",\nfactory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\nObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n${chunks.join('\n')}\nreturn module.exports;\n}\n});\n})();\n`;
if (!output.includes('window.__ModuleLoader__.load') || !output.includes('id: "dsh-vsc-git-graph"')) throw new Error('产物标识校验失败');
new Function(output);
await writeFile(new URL('../lib/client.js', import.meta.url), output);
console.log('客户端构建成功');

