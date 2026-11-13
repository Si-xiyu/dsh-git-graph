/**
 *
 * 本文件由规格作者依据「可观察行为」编写，是实现者唯一的硬性约束：
 * 实现必须让它全部通过，且**不得修改本文件**。
 *
 * 规格：docs/GRAPH-SPEC.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLayout,
  UNCOMMITTED,
  PALETTE,
  ROW_STYLE,
  UNCOMMITTED_MARK,
  GREY,
} from '../src/graph.js';

/** 构造提交：`commit('A', ['B'])`。 */
const commit = (hash, parents = []) => ({
  hash,
  parents,
  message: hash,
  author: 'a',
  email: 'a@b',
  date: 0,
  heads: [],
  remotes: [],
  tags: [],
  stash: null,
});

/** 标准菱形：0 = 合并提交，1/2 两条并行分支，3 为共同父。 */
const diamond = () => [
  commit('C0', ['C1', 'C2']),
  commit('C1', ['C3']),
  commit('C2', ['C3']),
  commit('C3'),
];

test('线性历史：单列、同一颜色槽、每行图宽一致', () => {
  const commits = [commit('A', ['B']), commit('B', ['C']), commit('C')];
  const model = buildLayout(commits, { head: 'A' });

  assert.deepEqual(model.rowSlots, [0, 0, 0], '整条主链必须同一个颜色槽');
  assert.deepEqual(model.rowWidths, [30, 30, 30], '单列行宽 = insetX + 1*grid.x - 2');
  assert.equal(model.contentWidth, 32, '单列内容宽 = 2*insetX + 0*grid.x');
  assert.equal(model.points.length, 3);
  assert.equal(model.points[0].current, true, 'HEAD 指向的提交是当前提交');
  assert.equal(model.points[0].x, 16);
  assert.equal(model.points[0].y, 12);

  const committed = model.paths.filter((p) => p.committed);
  assert.equal(committed.length, 1, '连续竖直段必须合并为一条 path');
  assert.equal(committed[0].d, 'M16,12.0L16,60.0');
});

test('菱形分叉：第二父走新列，颜色槽按分支分配', () => {
  const model = buildLayout(diamond(), { head: 'C3' });

  assert.deepEqual(model.rowSlots, [0, 0, 1, 0], '合并提交与其第一父同槽；第二父开新槽');
  assert.deepEqual(model.rowWidths, [30, 46, 46, 30], '有两条线的行更宽（逐行图宽）');
  assert.equal(model.contentWidth, 48);

  const blue = model.paths.filter((p) => p.colour === PALETTE[0]);
  const pink = model.paths.filter((p) => p.colour === PALETTE[1]);
  assert.equal(blue.length, 1);
  assert.match(blue[0].d, /^M16,12\.0L16,84\.0$/);
  assert.equal(pink.length, 1);
  assert.equal(pink[0].d, 'M16,12.0C16,31.2 32,16.8 32,36.0L32,60.0C32,79.2 16,64.8 16,84.0');

  assert.equal(model.points[2].x, 32, 'C2 落在第 2 列');
  assert.equal(model.points[2].colour, PALETTE[1]);
});

test('颜色槽只在段结束后复用：长分支颜色不跳变', () => {
  const commits = [
    commit('M', ['A1', 'C1']),
    commit('A1', ['A2']),
    commit('C1', ['A2']),
    commit('A2', ['A3']),
    commit('A3', ['A4']),
    commit('A4'),
  ];
  const model = buildLayout(commits, { head: 'M' });
  const mainRows = [0, 1, 3, 4, 5].map((i) => model.rowSlots[i]);
  assert.ok(
    mainRows.every((slot) => slot === mainRows[0]),
    `第一父链颜色必须恒定，实际 ${JSON.stringify(mainRows)}`,
  );
  assert.notEqual(model.rowSlots[2], model.rowSlots[0], '岔出的分支必须换槽');
});

test('只跟随第一父：窗口外的第二父不再占列', () => {
  const commits = [commit('A', ['B', 'OUTSIDE']), commit('B')];
  const all = buildLayout(commits, { head: 'A' });
  const first = buildLayout(commits, { head: 'A', firstParentOnly: true });

  assert.ok(all.contentWidth > first.contentWidth, '悬挂的第二父会多占一列');
  assert.equal(first.contentWidth, 32, '只跟第一父时退化成单列');
  assert.deepEqual(first.rowWidths, [30, 30]);
});

test('灰化：合并提交可配；非 HEAD 祖先可配', () => {
  const byMerge = buildLayout(diamond(), { head: 'C3', muteMerges: true });
  assert.deepEqual(byMerge.muted, [true, false, false, false], '只有合并提交变灰');

  const byAncestor = buildLayout([commit('X'), ...diamond()], { head: 'C3', muteNonAncestors: true });
  assert.equal(byAncestor.muted[0], true, 'X 不是 C3 的祖先');
  assert.equal(byAncestor.muted[4], false, 'C3 是 HEAD，不变灰');
});

test('展开详情：整体拉伸，跨展开行的线被拆开', () => {
  const flat = buildLayout(diamond(), { head: 'C3' });
  const expanded = buildLayout(diamond(), { head: 'C3', expandedRow: 0 });

  assert.equal(expanded.height, flat.height + 250, '高度增加一个 expand');
  assert.equal(expanded.points[3].y, flat.points[3].y + 250, '展开行下方圆点整体下移');
  assert.equal(expanded.points[0].y, flat.points[0].y, '展开行自身不动');
  assert.ok(
    expanded.paths.some((p) => p.d.includes('32,36.0') && p.d.includes('32,310.0')),
    `跨展开行的线必须延伸过展开区，实际 ${JSON.stringify(expanded.paths.map((p) => p.d))}`,
  );
});

test('直角风格只有直线指令，圆角风格有贝塞尔', () => {
  const angular = buildLayout(diamond(), { head: 'C3', style: ROW_STYLE.Angular });
  const rounded = buildLayout(diamond(), { head: 'C3' });

  for (const p of angular.paths) {
    assert.ok(!p.d.includes('C'), `直角风格不得出现贝塞尔：${p.d}`);
  }
  assert.ok(rounded.paths.some((p) => p.d.includes('C')), '圆角风格必须有曲线');
});

test('未提交伪提交：灰色、默认空心圆在改动处', () => {
  const commits = [commit(UNCOMMITTED, ['B']), commit('B')];
  const model = buildLayout(commits, { head: 'B' });

  assert.equal(model.rowSlots[0], 0);
  assert.equal(model.points[0].current, true, '默认在未提交改动处画空心圆');
  assert.equal(model.points[0].colour, GREY, '未提交段是灰色');
  assert.equal(model.points[1].colour, PALETTE[0], '真实提交仍用色板色');
  const uncommitted = model.paths.filter((p) => !p.committed);
  assert.ok(uncommitted.length > 0, '未提交段必须单独成 path');
  assert.ok(uncommitted.every((p) => p.colour === GREY && p.dashed === false));

  const atHead = buildLayout(commits, { head: 'B', uncommittedMark: UNCOMMITTED_MARK.AtHead });
  assert.equal(atHead.points[0].current, false, '该风格下空心圆在 HEAD 上');
  assert.equal(atHead.points[1].current, true);
  assert.ok(
    atHead.paths.filter((p) => !p.committed).every((p) => p.dashed === true),
    '该风格下未提交段为虚线',
  );
});

test('stash 提交：双层圆标记', () => {
  const commits = [
    { ...commit('S', ['B']), stash: { selector: 'stash@{0}', baseHash: 'B' } },
    commit('B'),
  ];
  const model = buildLayout(commits, { head: 'B' });
  assert.equal(model.points[0].stash, true);
  assert.equal(model.points[1].stash, false);
});

test('stash 内部提交：灰色虚线，且不占用普通颜色槽', () => {
  const commits = [
    { ...commit('S', ['B', 'I', 'U']), stash: { selector: 'stash@{0}', baseHash: 'B' } },
    { ...commit('I', ['B']), stashInternal: { selector: 'stash@{0}', kind: 'index' } },
    { ...commit('U'), stashInternal: { selector: 'stash@{0}', kind: 'untracked' } },
    commit('T', ['B']),
    commit('B'),
  ];
  const model = buildLayout(commits, { head: 'B' });
  const rowOf = (hash) => commits.findIndex((c) => c.hash === hash);

  assert.equal(model.points[rowOf('I')].stashInternal, true);
  assert.equal(model.points[rowOf('I')].colour, GREY, 'index 内部提交用灰色');
  assert.equal(model.points[rowOf('U')].colour, GREY, 'untracked 内部提交用灰色');
  assert.equal(model.rowSlots[rowOf('I')], -1, '内部提交不占色板槽');
  assert.notEqual(model.points[rowOf('S')].colour, GREY, 'stash 本体仍是普通分支色');

  const internal = model.paths.filter((p) => p.colour === GREY);
  assert.ok(internal.length >= 2, '通向 index / untracked 的线各自成灰色 path');
  assert.ok(internal.every((p) => p.dashed === true), '内部提交的线是虚线');

  assert.equal(model.points[rowOf('T')].colour, PALETTE[1], '后续真实分支拿到下一个色板色');
});

test('父提交不在窗口内时画到底且不抛错', () => {
  const model = buildLayout([commit('A', ['OUTSIDE']), commit('B', ['OUTSIDE2'])], { head: 'A' });
  assert.equal(model.rowSlots.length, 2);
  assert.equal(model.points.length, 2);
  assert.ok(model.paths.length > 0, '窗口外父提交也必须画出线段');
});

test('导航索引：父 / 子 / 备选（含多子规则）', () => {
  const model = buildLayout(diamond(), { head: 'C3' });
  assert.equal(model.nav.firstParent(0), 1, '第一父在主链');
  assert.equal(model.nav.otherParent(0), 2, '第二父在另一分支');
  assert.equal(model.nav.firstParent(3), -1, '根提交没有父');
  assert.equal(model.nav.otherParent(3), -1, '根提交没有备选父');

  assert.equal(model.nav.firstChild(3), 1, 'C3 的首选子在主线');
  assert.equal(model.nav.otherChild(3), 2, 'C3 的备选子');
  assert.equal(model.nav.firstChild(0), -1, '最新提交没有子');

  // 越界不得抛错
  assert.equal(model.nav.firstParent(99), -1);
  assert.equal(model.nav.canDrop(99), false);
});

test('canDrop：合并提交与根提交不可摘，线性中间提交可以', () => {
  const model = buildLayout(diamond(), { head: 'C3' });
  assert.equal(model.nav.canDrop(0), false, '合并提交本身不可摘');
  assert.equal(model.nav.canDrop(3), false, '根提交不可摘');

  const linear = buildLayout([commit('A', ['B']), commit('B', ['C']), commit('C')], { head: 'A' });
  assert.equal(linear.nav.canDrop(1), true, '线性历史的中间提交可摘');
  assert.equal(linear.nav.canDrop(2), false, '根提交不可摘');
});

test('空输入：返回空模型，不抛错', () => {
  const model = buildLayout([], { head: null });
  assert.deepEqual(model.paths, []);
  assert.deepEqual(model.points, []);
  assert.equal(model.contentWidth, 16, '2*insetX - grid.x');
  assert.equal(model.height, 0);
  assert.equal(model.nav.firstParent(0), -1);
});

test('stash 内部段不会吞并普通父提交（普通提交必须有正常颜色槽）', () => {
  const commits = [
    { ...commit('I', ['B']), stashInternal: { selector: 'stash@{0}', kind: 'index' } },
    commit('B'),
  ];
  const model = buildLayout(commits, { head: 'B' });
  assert.equal(model.points[0].colour, GREY, '内部提交本身仍是灰色');
  assert.notEqual(model.rowSlots[1], -1, '普通提交不能被内部段占成 -1 槽');
  assert.equal(model.points[1].colour, PALETTE[0], '普通提交要有正常颜色');
});

test('自引用父提交不会画出多余路径或撑宽图谱', () => {
  const commits = [commit('A', ['B', 'A']), commit('B'), commit('C')];
  const model = buildLayout(commits, { head: 'A' });
  assert.equal(model.contentWidth, 32, '自引用边不得额外占列');
  assert.deepEqual(model.rowWidths, [30, 30, 30]);
  assert.ok(model.paths.length <= 2, `自引用不应产生多余路径，实际 ${model.paths.length}`);
});
