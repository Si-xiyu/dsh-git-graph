# 图谱布局规格（行为级）

本文件是「重新实现图谱布局引擎」的**唯一依据**。它只描述**输入、输出与必须成立的行为**，
不描述任何既有实现的内部结构、命名或代码流程。

> Clean room 声明
> - 实现者：**不得**阅读 `vendor/legacy-client-bundle.js`、不得 `git show` 任何历史提交、
>   不得查阅任何第三方 Git 图表库的源码。只允许读本文件与验收测试。
> - 验收测试是行为契约，实现者**不得修改**它来迁就实现。

---

## 1. 职责边界

输入一批**已按时间倒序排列**的提交（第 0 行最新），输出一份**纯数据**的绘制模型：

- 每一行提交应落在哪一列（泳道）、属于哪个颜色槽；
- 需要画哪些线段（SVG `path` 的 `d` 字符串）、什么颜色、是否虚线；
- 每一行圆点的位置与样式；
- 每一行的「图占多宽」（供表格把文字排在线的右侧）；
- 哪些行需要变灰；
- 若干导航查询（上下移动、能否摘除提交）。

引擎**不碰 DOM**，不关心 React，不做任何 I/O。

## 2. 术语

| 术语 | 含义 |
|---|---|
| 行（row） | 一个提交在列表中的位置，0 表示最新 |
| 列 / 泳道（lane） | 横向的像素位置，第 `x` 列的中心在 `insetX + x * grid.x` |
| 段（segment） | 一段连续的折线/曲线，属于某个颜色槽 |
| 槽（slot） | 调色板下标，同一槽的行与段用同一颜色 |
| 占位（reserve） | 某行某列被某条段经过，该行此列不可再被别的段使用 |

## 3. 输入

```js
commits = [{
  hash: string,                  // 唯一键；"UNCOMMITTED" 是伪提交的固定 hash
  parents: string[],             // 父提交 hash，父通常出现在更大的行号
  stash?: object|null,           // 该提交是某个 stash 的提交（stash 本身）
  stashInternal?: {selector, kind} | null, // stash 的 index / untracked 内部提交
  // 其余字段（作者、时间、refs…）引擎不使用
}]
```

`options`：

```js
{
  head: string|null,          // HEAD 指向的 hash（游离时为 null）
  expandedRow: number,        // 被展开详情行的行号；-1 表示没有
  firstParentOnly: false,     // 仅省略「窗口外」的非第一父连接；窗口内的旁支仍连接（与验收基准一致）
  muteMerges: false,          // 合并提交是否变灰
  muteNonAncestors: false,    // 非 HEAD 祖先是否变灰
  style: 'rounded'|'angular',
  palette: string[],          // 颜色数组（默认见 §11）
  grid: { x:16, y:24, insetX:16, insetY:12, expand:250 },
  uncommittedMark: 'at-changes'|'at-head',
  maxWidth: -1                // >0 时输出宽度被裁剪（仅影响 width，不影响坐标）
}
```

## 4. 输出契约

```js
buildLayout(commits, options) => {
  paths:  [{ d: string, colour: string, committed: boolean, dashed: boolean }],
  points: [{ row, x, colour, current, stash, stashInternal, committed }],
  rowWidths: number[],   // 每行「图占多宽」，见 R6
  rowSlots:  number[],   // 每行的颜色槽下标；-1 表示「内部灰」
  muted:     boolean[],  // 每行是否变灰
  contentWidth: number,
  width: number,         // maxWidth > 0 时被裁剪
  height: number,
  nav: {
    firstParent(row): number,     // 第一父所在行；没有则 -1
    otherParent(row): number,     // 第二父；只有一父时返回该父；没有父则 -1
    firstChild(row): number,      // 「首选子提交」行号；没有则 -1
    otherChild(row): number,      // 「另一个子提交」行号；只有一个子时返回它；没有则 -1
    canDrop(row): boolean         // 该提交能否被摘除（见 §9）
  }
}
```

`points` 的 `x` 是**列号**（整数），像素坐标由消费方按 §7 换算，或直接用 `points` 里的像素值
（二者择一，但**同一实现内必须一致**；验收测试按像素值断言）。

## 5. 布局规则

### R1 列占用与下一可用列
每一行维护一个整数 `nextFree`（初始 0）。某段经过该行并占用列 `x` 时：
若 `x === nextFree`，则把该列标记为**已被此段占用**，并令 `nextFree = x + 1`；
重复占用同一列（同一段或另一段）不会报错，但**不会**再次推进 `nextFree`。

> 直觉：`nextFree` 表示「这一行目前最右边被用过一列之后的第一个空列」。

### R2 段与槽
一条**段**表示「从某一行的提交，向下连接到它的某一个父提交」的连续路径。
- 一段有自己的**槽**，段内所有行使用同一颜色；
- 一段经过的每一行都必须按 R1 占位。

### R3 槽复用
维护数组 `slotEnd[slot] = 该槽上一次被占用到的行号`。
给起始行 `start` 分配槽时：取**最小的** `slot` 使 `slotEnd[slot] < start`；
若不存在这样的槽，则追加一个新槽（颜色 = `palette[slot % palette.length]`）。
段结束后写入 `slotEnd[slot] = 段结束行`。

> 直觉：颜色只有在「上一段用它的行已经过去」后才可复用，因此同一条分支全程同色。

### R4 合并连接
当某一行的提交有多个父，且**它的第一父已经在某条段上**时：第二父的连接优先
**复用第一父所在的列**；若该列在本行不可用，则按 R1 取本行的 `nextFree`。
从第一父那一段的当前末端继续向下画，遇到第一父所在行时结束。

### R5 未被覆盖的行
每一行的提交若尚未被任何段覆盖，则以它的 `nextFree` 作为起始列新开一段，槽按 R3 分配。
父提交不在 `commits` 内时（浅克隆/分页边界），线段画到列表末尾即止，不得报错、不得死循环。

### R6 每行图宽
```
rowWidths[row] = insetX + nextFree(row) * grid.x - 2
```
`nextFree` 取该行**最终**值（所有段都处理完之后）。

### R7 整体尺寸
```
maxColumn    = max(所有行 nextFree)
contentWidth = 2 * insetX + (maxColumn - 1) * grid.x
height       = rows * grid.y + insetY - grid.y / 2 + (expandedRow >= 0 ? grid.expand : 0)
width        = maxWidth > 0 ? min(contentWidth, maxWidth) : contentWidth
```
空输入：`contentWidth = 2*insetX - grid.x`（默认 16）、`height = 0`、数组皆空。

## 6. 绘制规则

### R8 坐标换算
```
px(x) = x * grid.x + insetX
py(row) = row * grid.y + insetY
```

### R9 段的 d 字符串
按行依次追加指令，**同一段内坐标连续则不再写 `M`**：
- 起点或断点：`M<px>,<py 一位小数>`
- 同列（竖线）：`L<px>,<py 一位小数>`
- 跨列（圆角）：`C<px1>,<py1+0.8y> <px2>,<py2-0.8y> <px2>,<py2>`
- 跨列（直角）：`L<拐点x>,<拐点y>` 再接 `L<px2>,<py2>`；拐点取
  「锁定起点 → `(px2, py2-0.38y)`」或「锁定终点 → `(px1, py1+0.38y)`」
- 所有 `px` 取**整数**，所有 `py` 取**一位小数**（`toFixed(1)`），不得带多余空格，
  即对照组 `M16,12.0L16,84.0`。

### R10 共线合并
同一段内相邻两条**竖直**线段（列相同、且上一条终点 `y` 等于下一条起点 `y`、提交态相同）
必须合并成一条，减少 path 数量与接缝。

### R11 提交态分段
一段内可能同时包含「已提交」与「未提交改动」两部分的线段时，必须拆成**不同的 path**
（颜色与虚线规则不同）：`committed` 字段标记属于哪一类。

### R12 虚线
以下情形该 path 使用虚线（`dashed: true`）：
- 该段属于 stash 内部提交（`stashInternal`）；
- 或该段是「未提交改动」段且 `uncommittedMark === 'at-head'`。

### R13 展开拉伸
`expandedRow >= 0` 时，展开行下方的所有内容整体下移 `grid.expand`：
- 完全位于展开行下方的线段：两端 `y` 都加 `expand`；
- 跨越展开行的**竖线**：终点 `y` 加 `expand`；
- 跨越展开行的**斜线**且「锁定起点」：保留原拐点，再从 `(px2, py1+grid.y)` 竖直延伸到
  `(px2, py2+expand)`，即拆成两条；
- 跨越展开行的**斜线**且「锁定终点」：先在原列竖直延伸到 `(px1, py2-grid.y+expand)`，
  再把两端都下移 `expand` 后继续；
- 圆点：`row > expandedRow` 时 `cy += expand`。

### R14 圆点
```
cx = px(x) ; cy = py(row) + (row > expandedRow ? expand : 0) ; r = 4
```
- 普通提交：实心，`fill = colour`；
- 当前提交（见 R15）：空心，`fill = 背景色`（由消费方负责），`stroke-width = 2`；
- stash 提交：`r = 4.5`，另加一个 `r = 2` 的内圈；
- stash 内部提交：`colour = '#808080'`。

## 7. 着色与灰化

### R15 当前提交
- `uncommittedMark === 'at-changes'` 且第 0 行是 `UNCOMMITTED`：第 0 行的圆点标记 `current`；
- 否则：`head` 所在的行（若在窗口内）标记 `current`。

### R16 颜色
- 普通行：`palette[rowSlots[row] % palette.length]`；
- 未提交改动段：`#808080`；
- stash 内部提交：`#808080`，且 `rowSlots[row] = -1`。

### R17 灰化（muted）
- `muteMerges` 且该行是多父提交且不是 stash 提交 → 灰；
- `muteNonAncestors` 且 `head` 在窗口内：从 `head` 沿父链能到达的行的集合之外的行 → 灰。

## 8. 导航语义

- `firstParent(row)`：`parents[0]` 的行号；不存在 → -1。
- `otherParent(row)`：`parents[1]` 的行号；只有一父时返回 `parents[0]`；无父 → -1。
- `firstChild(row)`：
  - 多个子：优先取「与本行同一条段的子」；否则取**行号最大**的子；
  - 一个子：返回它；没有 → -1。
- `otherChild(row)`：
  - 多个子：优先取「与本行同段子之外、行号最大」的子；若本行不属于任何段，取行号**第二大**的子；
  - 一个子：返回它；没有 → -1。
- 所有查询越界时返回 -1，不得抛错。

## 9. 能否摘除（canDrop）

`canDrop(row)` 为真当且仅当：
1. 该行有父提交；且
2. 沿「子提交」链向上（子 → 孙 → …）能走到尽头，且途中**每个**提交都 **不是**合并提交、
   并且**只有一个子**；且
3. 该链尽头的提交就是 `head`。

任一条件不满足 → false。根提交（无父）→ false。合并提交本身 → false。

## 10. 特殊提交

- `hash === 'UNCOMMITTED'`：伪提交，代表工作区改动；它的父通常是 `head`。
- `stash`：`git log --all` 里 stash 提交本身；正常着色，圆点走 R14 的双圈。
- `stashInternal`：stash 的 index / untracked 父提交；灰色虚线、`rowSlots = -1`、不参与槽分配
  （否则后续真实分支会复用到同色，视觉上像同一条泳道断掉）。

## 11. 默认值

```
palette = ['#0085d9','#d9008f','#00d90a','#d98500','#a300d9','#ff0000',
           '#00d9cc','#e138e8','#85d900','#dc5b23','#6f24d6','#ffcc00']
grid    = { x:16, y:24, insetX:16, insetY:12, expand:250 }
```

## 12. 验收

- 实现必须让 `test/graph.contract.test.js` **全部通过**，且**不得修改该文件**。
- 该测试覆盖：线性、菱形分叉、槽复用稳定性、仅第一父、灰化、展开拉伸、直角/圆角、
  未提交伪提交、stash 与 stash 内部提交、窗口外父提交、导航索引、canDrop、空输入。
- 另需保证现有全量测试（`npm test`）通过：消费方 `src/view.js` 需同步改用新 API（见 §13）。

## 13. 消费方改造清单

`src/view.js` 目前这样用引擎，需机械替换：

| 现在 | 改为 |
|---|---|
| `renderGraph(commits, { commitHead, expandedCommitIndex, onlyFollowFirstParent, muteMergeCommits, muteCommitsNotAncestorsOfHead, config:{style,maxWidth,grid} })` | `buildLayout(commits, { head, expandedRow, firstParentOnly, muteMerges, muteNonAncestors, style, maxWidth, grid })` |
| `model.circles` | `model.points` |
| `model.widths` | `model.rowWidths` |
| `model.colours` | `model.rowSlots` |
| `new Graph(); g.loadCommits(...)` 后调 `g.getFirstParentIndex(i)` 等 | 直接用 `model.nav.firstParent(i)` 等 |
| `g.dropCommitPossible(i)` | `model.nav.canDrop(i)` |

`src/styles.js` / `src/diff.js` / `lib/index.js` **不需要改**。

---

## 14. 时序规则补遗（v2，优先于前文的简化描述）

上一版规格把「一条段用固定列」写得含糊，导致实现把整段锁定在一列。基准行为要求在
**行级别**推进，因此明确如下三条：

### R18 逐行取列（不是整段锁列）
一条路径从起始行向下推进时，**每一行都单独取该行当前的 `nextFree`** 作为这一行要占用的列，
按 R1 占位并推进。因此同一条段在不同行**可以落在不同列**（视觉上是轻微的左右微调），
不得把整段固定在同一列。

例外只有一个：当路径到达**父提交所在行**且该父已经在别的段上时，最后一步必须落到
**该父自己的列**（即汇入已有泳道），而不是取该行 `nextFree`。

### R19 槽的分配与释放时序
- 段的颜色槽在**段开始的那一行**分配（R3 的最小可复用槽），段内不得改色；
- 段的「结束行」是它终止的那一行（父提交行或列表末尾）；
- 只有段结束后，它占用的槽才允许被后续（结束行更大的）段复用。

### R20 处理顺序与父子段的关系
1. 行号**从小到大**依次处理；
2. 某行若尚未被任何段覆盖：以该行 `nextFree` 作为起始列，开一段沿**第一父**向下铺；
3. 该行的其余父（第二、第三…）各自再铺一段；若某个父已经在某段上，则从该段继续/汇入，
   不新开段；
4. 铺段过程中遇到「已归属本段」的提交行时，把该行记为段内行（列取 R18），继续向它的第一父推进。

### R21 输出坐标
`points[i].x` / `points[i].y` 输出**像素值**（R8 换算后），`y` 按 R13 叠加展开偏移；
`rowWidths` / `rowSlots` / `muted` 的数组长度必须等于提交数。

> 补充说明：R18 是「为什么复杂图会逐行错位」的关键。只锁定一列的实现能通过简单样例，
> 但会在多分支交叉时压窄图形，属于不合规。

---

## 15. 已知限制

### 性能（O(n²) 风险）
当前实现逐段逐行铺占位，并在每行线性查找「本行到该目标的连接点」。在极端数据上
（大量提交共同指向末行）复杂度趋近 O(n²)。实测引擎耗时中位数：
500 / 1000 / 2000 行约 **13 / 34 / 185 ms**。

首屏默认 300 条的耗时在可接受范围；若要支持上千提交的首屏渲染，需要把长段占位改成
区间处理，并为「连接点」建立按目标的索引，同时保持最终坐标语义不变。
