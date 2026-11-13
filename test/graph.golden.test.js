/**
 * 黄金基准：用一批「已确认的视觉结果」锁住复杂历史下的布局。
 *
 * `test/fixtures/graph-golden.json` 里的期望值来自**既有产品的实际输出**（逐行图宽、
 * 颜色槽、路径 d 串、圆点坐标），是行为数据而非代码：实现只需复现这些数字。
 *
 * 与 `graph.contract.test.js` 的分工：
 * - 契约测试：规则级断言（少量、可读，说明「为什么」）；
 * - 黄金基准：覆盖复杂拓扑（多条并行分支、合并、stash、未提交改动、展开、直角风格），
 *   防止「简单样例过了但复杂图变形」。
 *
 * 实现者同样**不得修改**本文件与 fixture。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLayout } from '../src/graph.js';

const golden = JSON.parse(await readFile(new URL('./fixtures/graph-golden.json', import.meta.url), 'utf8'));

const projectPath = (p) => ({ d: p.d, colour: p.colour, committed: p.committed, dashed: p.dashed });
const projectPoint = (p) => ({
  x: p.x,
  y: p.y,
  colour: p.colour,
  current: p.current,
  stash: p.stash,
  stashInternal: p.stashInternal,
  committed: p.committed,
});

for (const c of golden.cases) {
  test(`黄金基准：${c.name}`, () => {
    const model = buildLayout(c.commits, {
      head: c.options.head,
      expandedRow: c.options.expandedRow,
      firstParentOnly: c.options.firstParentOnly,
      muteMerges: c.options.muteMerges,
      style: c.options.style,
    });

    assert.deepEqual(model.rowWidths, c.expected.rowWidths, '逐行图宽必须与基准一致');
    assert.deepEqual(model.rowSlots, c.expected.rowSlots, '每行颜色槽必须与基准一致');
    assert.deepEqual(model.muted, c.expected.muted, '灰化行必须与基准一致');
    assert.equal(model.contentWidth, c.expected.contentWidth, '内容宽必须与基准一致');
    assert.equal(model.height, c.expected.height, '总高必须与基准一致');
    assert.deepEqual(model.paths.map(projectPath), c.expected.paths, '路径（d 串/颜色/虚线）必须一致');
    assert.deepEqual(model.points.map(projectPoint), c.expected.points, '圆点坐标与样式必须一致');
  });
}
