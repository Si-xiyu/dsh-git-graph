export const UNCOMMITTED = 'UNCOMMITTED';
export const GREY = '#808080';
export const PALETTE = ['#0085d9','#d9008f','#00d90a','#d98500','#a300d9','#ff0000','#00d9cc','#e138e8','#85d900','#dc5b23','#6f24d6','#ffcc00'];
export const ROW_STYLE = { Rounded: 'rounded', Angular: 'angular' };
export const UNCOMMITTED_MARK = { AtChanges: 'at-changes', AtHead: 'at-head' };

/**
 * 计算一份绘制模型。
 *
 * 列与段的分配分两步，顺序很关键：
 * 1. 先沿第一父把「主链」铺到底（每行各自取该行下一个空列），
 * 2. 再补每个合并提交的其余父提交；凡是父提交已落在某条段上的，就并入那条段的泳道，
 *    否则另开一段继续往下铺。
 * 反过来（先铺旁支）会让主链被迫绕行，图形看起来「鼓一块」。
 */
export function buildLayout(commits, options = {}) {
  const grid = { x:16, y:24, insetX:16, insetY:12, expand:250, ...options.grid };
  const palette = options.palette?.length ? options.palette : PALETTE;
  const expanded = options.expandedRow ?? -1;
  const count = commits.length;
  const indices = new Map(commits.map((c, i) => [c.hash, i]));
  // 黄金验收保留窗口内的旁支，仅省略窗口外的非第一父连接。
  const parents = commits.map(c => c.parents.filter((h, i) => !options.firstParentOnly || i === 0 || indices.has(h)));
  const committedAt = row => commits[row].hash !== UNCOMMITTED;

  // ── 每行的列状态 ──────────────────────────────────────────────
  const nextFree = Array(count).fill(0);   // 该行最右边已用列之后的第一个空列
  const laneOf = Array(count).fill(-1);    // 该行提交落在哪一列
  const ownerOf = Array(count).fill(null); // 该行提交由哪条段接管
  const slotOf = Array(count).fill(-1);    // 该行颜色槽（-1 = 内部灰）
  const cursor = Array(count).fill(0);     // 该行已处理到第几个父提交
  // links[row][lane] = { to, seg }：这一行这一列上，是否有通向 to 的、属于 seg 的连接点
  const links = Array.from({ length: count }, () => []);
  const slotEnd = [];
  const segments = [];

  const px = x => Math.round(grid.insetX + x * grid.x);
  const py = row => grid.insetY + row * grid.y;

  const allocate = start => {
    let slot = slotEnd.findIndex(end => end < start);
    if (slot < 0) slot = slotEnd.length;
    slotEnd[slot] = start;
    return slot;
  };
  // 只有「正好是该行下一个空列」时才登记连接点，与逐行推进的语义一致。
  const reserve = (row, lane, to, seg) => {
    if (lane === nextFree[row]) {
      links[row][lane] = { to, seg };
      nextFree[row] = lane + 1;
    }
  };
  const linkTo = (row, to, seg) => {
    const list = links[row];
    for (let lane = 0; lane < list.length; lane += 1) {
      if (list[lane] && list[lane].to === to && list[lane].seg === seg) return lane;
    }
    return -1;
  };
  const addEdge = (seg, a, x, b, nx, lock) => seg.edges.push({ a, b, x, nx, lock, committed: committedAt(a) });
  const claim = (row, seg, lane) => {
    if (ownerOf[row]) return;
    ownerOf[row] = seg;
    laneOf[row] = lane;
    slotOf[row] = commits[row].stashInternal ? -1 : seg.slot;
    seg.rows.push(row);
  };

  /** 铺一条段：`viaParent` 表示这是一条「通向某个旁支父提交」的连接。 */
  function lay(start, viaParent = false) {
    const hasNext = cursor[start] < parents[start].length;
    const target = hasNext ? indices.get(parents[start][cursor[start]]) : undefined;
    const startSeg = ownerOf[start];

    // A. 合并连接：起点已在段上、且目标父提交在**下方**且已在某段上 → 并入目标所在泳道。
    //    必须要求 target > start：自引用/反向边交给普通分支的防护处理，否则会向下画出多余路径。
    if (hasNext && target !== undefined && target > start && startSeg && parents[start].length > 1 && ownerOf[target]) {
      const seg = ownerOf[target];
      let lastRow = start;
      let lastLane = laneOf[start];
      for (let row = start + 1; row < count; row += 1) {
        const hit = linkTo(row, target, seg);
        const lane = hit >= 0 ? hit : nextFree[row];
        const lock = hit < 0 && row !== target ? lastLane < lane : true;
        addEdge(seg, lastRow, lastLane, row, lane, lock);
        reserve(row, lane, target, seg);
        lastRow = row;
        lastLane = lane;
        if (hit >= 0) break;
      }
      cursor[start] += 1;
      return;
    }

    // B. 普通：新开一段，沿父链往下铺，遇父提交未占用就纳入本段继续走。
    const internal = viaParent ? !!commits[target]?.stashInternal : !!commits[start]?.stashInternal;
    const seg = { slot: internal ? -1 : allocate(start), internal, edges: [], rows: [] };
    segments.push(seg);

    let row = start;
    let lane = startSeg ? laneOf[start] : nextFree[row];
    let vertexRow = start;   // 正在为哪个提交连父提交（游标要推进的是它）
    claim(row, seg, lane);
    reserve(row, lane, start, seg);

    for (;;) {
      if (cursor[vertexRow] >= parents[vertexRow].length) break;
      const goal = indices.get(parents[vertexRow][cursor[vertexRow]]);
      if (goal === undefined) {
        // 父提交不在窗口内（浅克隆 / 分页边界）：线必须画到列表末尾，不能凭空截断。
        for (let next = row + 1; next < count; next += 1) {
          const nextLane = nextFree[next];
          addEdge(seg, row, lane, next, nextLane, lane < nextLane);
          reserve(next, nextLane, undefined, seg);
          row = next;
          lane = nextLane;
        }
        cursor[vertexRow] += 1;
        break;
      }
      if (goal <= row) {
        // 反向边（异常数据）：吞掉，保证推进
        cursor[vertexRow] += 1;
        continue;
      }
      let reached = false;
      for (let next = row + 1; next <= goal; next += 1) {
        const atGoal = next === goal;
        const owned = atGoal && ownerOf[next] && ownerOf[next] !== seg;
        const nextLane = owned ? laneOf[next] : nextFree[next];
        addEdge(seg, row, lane, next, nextLane, lane < nextLane);
        reserve(next, nextLane, goal, seg);
        row = next;
        lane = nextLane;
        if (atGoal) { reached = true; break; }
      }
      if (!reached) { cursor[vertexRow] += 1; break; }
      cursor[vertexRow] += 1;
      vertexRow = row;
      if (ownerOf[row] && ownerOf[row] !== seg) break; // 汇入已有段即止
      // 内部段（stash 的 index/untracked）到达普通提交即止：普通提交必须拿正常颜色槽，
      // 不能被并入灰色内部段（否则那一行会变成 -1 槽、圆点也没有颜色）。
      if (seg.internal && !commits[row].stashInternal) break;
      claim(row, seg, lane);
    }
    if (seg.slot >= 0) slotEnd[seg.slot] = row;
  }

  // 先铺每一行的第一父链（只在该行尚未被任何段接管时），再补其余父提交。
  // 顺序反了会让主链给旁支让路，图形会「鼓」出去。
  for (let row = 0; row < count; row += 1) {
    if (!ownerOf[row]) lay(row, false);
    while (cursor[row] < parents[row].length) {
      const before = cursor[row];
      lay(row, true);   // 窗口外的父提交也要铺一条「画到底」的段，因此不做提前跳过
      if (cursor[row] === before) cursor[row] += 1;  // 兜底：保证推进
    }
  }

  // ── 绘制 ──────────────────────────────────────────────────────
  const paths = [];
  function draw(segment) {
    const pieces = [];
    function add(x1, y1, x2, y2, committed, lock) {
      const previous = pieces[pieces.length - 1];
      if (previous && x1 === x2 && previous.x1 === x1 && previous.x2 === x2 && previous.y2 === y1 && previous.committed === committed) previous.y2 = y2;
      else pieces.push({ x1, y1, x2, y2, committed, lock });
    }
    for (const edge of segment.edges) {
      const { a, b, x, nx, committed, lock } = edge;
      const y1 = py(a), y2 = py(b);
      if (expanded >= a && expanded < b && x !== nx) {
        if (lock) {
          add(px(x), y1, px(nx), y2, committed, lock);
          add(px(nx), y2, px(nx), y2 + grid.expand, committed, lock);
        } else {
          add(px(x), y1, px(x), y1 + grid.expand, committed, lock);
          add(px(x), y1 + grid.expand, px(nx), y2 + grid.expand, committed, lock);
        }
      } else {
        add(px(x), y1 + (expanded >= 0 && a > expanded ? grid.expand : 0), px(nx), y2 + (expanded >= 0 && b > expanded ? grid.expand : 0), committed, lock);
      }
    }
    let path = null, lastX, lastY;
    const coord = (x, y) => x + ',' + y.toFixed(1);
    for (const p of pieces) {
      if (!path || path.committed !== p.committed) {
        path = { d:'', colour:!p.committed || segment.internal ? GREY : palette[segment.slot % palette.length], committed:p.committed, dashed:segment.internal || (!p.committed && options.uncommittedMark === UNCOMMITTED_MARK.AtHead) };
        paths.push(path);
        lastX = lastY = undefined;
      }
      if (lastX !== p.x1 || lastY !== p.y1) path.d += 'M' + coord(p.x1, p.y1);
      if (p.x1 === p.x2) path.d += 'L' + coord(p.x2, p.y2);
      else if (options.style === ROW_STYLE.Angular) {
        path.d += 'L' + (p.lock ? coord(p.x2, p.y2 - .38 * grid.y) : coord(p.x1, p.y1 + .38 * grid.y));
        path.d += 'L' + coord(p.x2, p.y2);
      } else path.d += 'C' + coord(p.x1, p.y1 + .8 * grid.y) + ' ' + coord(p.x2, p.y2 - .8 * grid.y) + ' ' + coord(p.x2, p.y2);
      lastX = p.x2;
      lastY = p.y2;
    }
  }
  segments.forEach(draw);

  const rowSlots = ownerOf.map((seg, row) => (commits[row].stashInternal ? -1 : (seg ? seg.slot : 0)));
  const current = options.uncommittedMark !== UNCOMMITTED_MARK.AtHead && commits[0]?.hash === UNCOMMITTED ? 0 : (indices.get(options.head) ?? -1);
  const points = commits.map((commit, row) => ({
    row,
    x: px(Math.max(0, laneOf[row])),
    y: py(row) + (expanded >= 0 && row > expanded ? grid.expand : 0),
    colour: commit.hash === UNCOMMITTED || commit.stashInternal ? GREY : palette[rowSlots[row] % palette.length],
    current: row === current,
    stash: !!commit.stash,
    stashInternal: !!commit.stashInternal,
    committed: commit.hash !== UNCOMMITTED,
  }));

  const ancestor = new Set();
  const pending = [indices.get(options.head)];
  while (pending.length) {
    const row = pending.pop();
    if (row === undefined || ancestor.has(row)) continue;
    ancestor.add(row);
    pending.push(...parents[row].map(h => indices.get(h)));
  }
  const muted = commits.map((commit, row) => !!((options.muteMerges && commit.parents.length > 1 && !commit.stash) || (options.muteNonAncestors && indices.has(options.head) && !ancestor.has(row))));

  const children = commits.map(() => []);
  parents.forEach((list, child) => list.forEach(hash => { const row = indices.get(hash); if (row !== undefined) children[row].push(child); }));
  const parentAt = (row, other) => parents[row]?.length ? (indices.get(parents[row][other && parents[row].length > 1 ? 1 : 0]) ?? -1) : -1;
  const childAt = (row, other) => {
    const list = children[row];
    if (!list?.length) return -1;
    const same = list.filter(child => ownerOf[child] === ownerOf[row]).at(-1);
    const preferred = same ?? list.at(-1);
    return other ? (list.filter(child => child !== preferred).at(-1) ?? preferred) : preferred;
  };
  const nav = {
    firstParent:row => parentAt(row, false), otherParent:row => parentAt(row, true),
    firstChild:row => childAt(row, false), otherChild:row => childAt(row, true),
    canDrop(row) {
      if (!commits[row] || !parents[row].length) return false;
      const seen = new Set();
      let cursorRow = row;
      while (!seen.has(cursorRow)) {
        seen.add(cursorRow);
        if (commits[cursorRow].parents.length > 1) return false;
        if (!children[cursorRow].length) return commits[cursorRow].hash === options.head;
        if (children[cursorRow].length !== 1) return false;
        cursorRow = children[cursorRow][0];
      }
      return false;
    },
  };
  const maxColumn = nextFree.reduce((max, x) => Math.max(max, x), 0);
  const contentWidth = 2 * grid.insetX + (maxColumn - 1) * grid.x;
  return {
    paths,
    points,
    rowWidths: nextFree.map(x => grid.insetX + x * grid.x - 2),
    rowSlots,
    muted,
    contentWidth,
    width: options.maxWidth > 0 ? Math.min(contentWidth, options.maxWidth) : contentWidth,
    height: count ? count * grid.y + grid.insetY - grid.y / 2 + (expanded >= 0 ? grid.expand : 0) : 0,
    nav,
  };
}
