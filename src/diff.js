export function parseDiffText(text) {
      const files = [];
      let cur = null;
      for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
        if (line.startsWith("diff --git")) {
          if (cur) files.push(cur);
          const m = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
          cur = { oldName: m ? m[1] : line.slice("diff --git ".length), newName: m ? m[2] : "", meta: [], hunks: [] };
          continue;
        }
        if (!cur) continue; // 跳过提交说明
        if (line.startsWith("@@")) {
          const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
          const h = m
            ? { ok: true, oldStart: Number(m[1]), oldCount: Number(m[2] ?? 1), newStart: Number(m[3]), newCount: Number(m[4] ?? 1), old: Number(m[1]), new: Number(m[3]), lines: [] }
            : { ok: false, oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, old: 0, new: 0, lines: [] };
          cur.hunks.push(h);
          h.lines.push({ t: "hunk", oldLn: null, newLn: null, content: m ? (m[5] || "").replace(/^\s/, "") : line });
          continue;
        }
        if (cur.hunks.length === 0) {
          if (line !== "") cur.meta.push(line);
          if(line.startsWith("--- ")) cur.oldName = line.slice(4).replace(/^a\//, "");
          if(line.startsWith("+++ ")) cur.newName = line.slice(4).replace(/^b\//, "");
          continue;
        }
        if (line === "" || line.startsWith("\\ No newline")) continue; // 忽略文件末尾标记
        const h = cur.hunks[cur.hunks.length - 1];
        if (line.startsWith("+")) {
          h.lines.push({ t: "add", oldLn: null, newLn: h.new, content: line });
          h.new += 1;
        } else if (line.startsWith("-")) {
          h.lines.push({ t: "del", oldLn: h.old, newLn: null, content: line });
          h.old += 1;
        } else {
          h.lines.push({ t: "ctx", oldLn: h.old, newLn: h.new, content: line.slice(1) });
          h.old += 1;
          h.new += 1;
        }
      }
      if (cur) files.push(cur);
      return files;
    }

const DIFF_ROW_H = 19;
const DIFF_OVERSCAN = 24;

export function DiffView({ text, L = (zh) => zh }) {
  const files = react.useMemo(() => parseDiffText(text || ""), [text]);
  const units = react.useMemo(() => {
    const out = [];
    let maxW = 0;
    const note = (s) => {
      let w = 0;
      for (const ch of s) {
        w += /[\u4e00-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1;
      }
      if (w > maxW) maxW = w;
    };
    for (const f of files) {
      const binary = f.meta.some((l) => l.startsWith("Binary files"));
      const renamed = f.oldName !== f.newName && f.oldName !== "/dev/null" && f.newName !== "/dev/null";
      out.push({ kind: "file", f, binary, renamed });
      note(f.newName || f.oldName);
      if (!binary && f.hunks.length > 0) {
        for (const h of f.hunks) {
          out.push({ kind: "hunk", h });
          note(h.ok && h.lines[0].content ? h.lines[0].content : "");
          for (const l of h.lines.slice(1)) {
            out.push({ kind: "line", l });
            note(l.content);
          }
        }
      } else if (!binary) {
        out.push({ kind: "meta" });
      }
    }
    return { units: out, maxW };
  }, [files]);
  const { units: rows, maxW } = units;
  const hasRows = rows.length > 0;
  const diffWidth = 68 + maxW * 7.2 + 16;
  const boxRef = react.useRef(null);
  const [scrollTop, setScrollTop] = react.useState(0);
  const [viewportH, setViewportH] = react.useState(0);

  // 换文件 / 重新打开 diff 时回到顶部，避免沿用上一个文件的滚动位置。
  react.useEffect(() => {
    setScrollTop(0);
    if (boxRef.current) boxRef.current.scrollTop = 0;
  }, [text]);

  // 空 diff 不渲染滚动容器；从空切到非空时容器重新挂载，
  // 依赖 hasRows 让 effect 重跑并重新建立 ResizeObserver / 测量视口高度。
  react.useLayoutEffect(() => {
    if (!hasRows) return undefined;
    const el = boxRef.current;
    if (!el) return undefined;
    const update = () => setViewportH(el.clientHeight);
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [hasRows]);

  const fmtCount = (n) => (n === 1 ? "" : "," + n);
  const totalH = rows.length * DIFF_ROW_H;
  const start = Math.max(0, Math.floor(scrollTop / DIFF_ROW_H) - DIFF_OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / DIFF_ROW_H) + DIFF_OVERSCAN);
  const visible = rows.slice(start, end);
  const rowClass = (u) => {
    if (u.kind === "file") return "dshGitDiffRow dshGitDiffVFile";
    if (u.kind === "hunk") return "dshGitDiffRow dshGitDiffRowHunk";
    if (u.kind === "meta") return "dshGitDiffRow dshGitDiffMeta";
    if (u.l.t === "add") return "dshGitDiffRow dshGitDiffRowAdd";
    if (u.l.t === "del") return "dshGitDiffRow dshGitDiffRowDel";
    return "dshGitDiffRow";
  };
  const rowContent = (u) => {
    if (u.kind === "file") {
      const f = u.f;
      return [
        jsx("span", { className: "dshGitDiffFileDot", children: "\u25CF" }),
        jsx("span", { className: "dshGitDiffFileName", title: f.newName || f.oldName, children: (f.newName && f.newName !== "/dev/null" ? f.newName : f.oldName) }),
        u.renamed ? jsx("span", { className: "dshGitDiffFileBadge", children: L("重命名", "Renamed") }) : null,
        f.oldName === "/dev/null" ? jsx("span", { className: "dshGitDiffFileBadge dshGitDiffFileBadgeNew", children: L("新增", "Added") }) : null,
        f.newName === "/dev/null" ? jsx("span", { className: "dshGitDiffFileBadge dshGitDiffFileBadgeDel", children: L("删除", "Deleted") }) : null,
        u.binary ? jsx("span", { className: "dshGitDiffFileBadge", children: L("二进制", "Binary") }) : null,
      ];
    }
    if (u.kind === "hunk") {
      const h = u.h;
      const section = h.ok && h.lines[0].content ? " " + h.lines[0].content : "";
      return jsx("span", { className: "dshGitContent", children: h.ok ? "@@ -" + h.oldStart + fmtCount(h.oldCount) + " +" + h.newStart + fmtCount(h.newCount) + " @@" + section : h.lines[0].content });
    }
    if (u.kind === "meta") {
      return jsx("span", { className: "dshGitContent", children: L("（无内容变更）", "(no content changes)") });
    }
    const l = u.l;
    return [
      jsx("span", { className: "dshGitGutter", children: l.oldLn ?? "" }),
      jsx("span", { className: "dshGitGutter", children: l.newLn ?? "" }),
      jsx("span", { className: "dshGitContent", children: l.content === "" ? " " : l.content }),
    ];
  };
  if (!hasRows) return jsx("div", { className: "dshGitEmpty", children: L("无差异", "No differences") });
  return jsx("div", {
    ref: boxRef,
    className: "dshGitDiff dshGitDiffVirtual",
    onScroll: (e) => setScrollTop(e.currentTarget.scrollTop),
    children: jsx("div", {
      style: { height: totalH, position: "relative", width: Math.max(diffWidth, 100), minWidth: "100%" },
      children: visible.map((u, i) => {
        const top = (start + i) * DIFF_ROW_H;
        return jsx("div", {
          key: "v" + (start + i),
          className: rowClass(u),
          style: { position: "absolute", top, left: 0, right: 0, height: DIFF_ROW_H },
          children: rowContent(u),
        });
      }),
    }),
  });
}
