const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
const react = require("react");
const react_dom = require("react-dom");
const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
const BranchIcon = primitives.IconBranchOutline16 || primitives.IconBranchOutlineRegular || primitives.IconBranchOutlineMedium || (() => null);
function gitCall(op, payload, L = (zh) => zh) {
  return (async () => {
    const response = await fetch('/vsc-git-graph', {
      method:'POST', headers:{
        'content-type':'application/json'
      },
      body:JSON.stringify({
        op,...payload
      })
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error?.message || L('Git 请求失败', 'Git request failed'));
    return result.value;
  })
  ();
}
/** 首次启动的界面语言：宿主语言是中文 → zh，其他（含未知）→ en。 */
function detectLang(locale) {
  try {
    const active = locale?.getLocale?.().active;
    if (active === 'zh' || active === 'en') return active;
  } catch (e) {
    // 宿主没有 locale 服务时退回浏览器语言
  }
  try {
    const tag = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    return /^zh(?:-|$)/i.test(tag) ? 'zh' : 'en';
  } catch (e) {
    return 'en';
  }
}

/** 用户手动选过的语言；没写过（初次启动）返回 null。 */
function readSavedLang() {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem('dshGitGraph.lang') : null;
    return value === 'zh' || value === 'en' ? value : null;
  } catch (e) {
    return null;
  }
}

function rememberLang(value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('dshGitGraph.lang', value);
  } catch (e) {
    // 隐私模式等写不进去时只保留本次会话的选择
  }
}

export function FormDialog({
  form, close, L = (zh) => zh
})
{
  const [values, setValues] = react.useState(() => Object.fromEntries(form.fields.map(f => [f.name, f.value ?? (f.type === 'checkbox' ? false : '')])));
  const [error, setError] = react.useState('');
  const [busy, setBusy] = react.useState(false);
  const submit = async e => {
    e.preventDefault();
    if(busy)return;
    setBusy(true);
    try{
      await form.onSubmit(values);
      close();
    }
    catch(e){
      setError(e.message);
    }
    finally{
      setBusy(false);
    }
  };
  return jsx('div',{
    className:'ggMask',onClick:close,children:jsxs('form',{
      className:'ggModal',role:'dialog','aria-modal':true,onClick:e=>e.stopPropagation(),onSubmit:submit,children:[jsx('h3',{
        children:form.title
      }),
      jsx('p',{
        children:form.message
      }),
      ...form.fields.map((f,i)=>jsx('label',{
        children:[f.label || f.name, f.type==='radio' ? (f.options || []).map(o=>jsx('label',{
          children:[jsx('input',{
            type:'radio',name:f.name,value:o.value ?? o,checked:values[f.name]===(o.value ?? o),onChange:()=>setValues({
              ...values,[f.name]:o.value ?? o
            })
          }),
          o.label ?? o]
        },
        o.value ?? o)) : f.type==='select' ? jsx('select',{
          value:values[f.name],onChange:e=>setValues({
            ...values,[f.name]:e.target.value
          }),
          children:(f.options || []).map(o=>jsx('option',{
            value:o.value ?? o,children:o.label ?? o
          },
          o.value ?? o))
        })
        : jsx('input',{
          type:f.type || 'text',autoFocus:i===0,value:f.type==='checkbox'?undefined:values[f.name],checked:f.type==='checkbox'?!!values[f.name]:undefined,onChange:e=>setValues({
            ...values,[f.name]:f.type==='checkbox'?e.target.checked:e.target.value
          })
        })]
      },
      f.name)),error&&jsx('pre',{
        className:'ggError',children:error
      }),
      jsxs('footer',{
        children:[jsx('button',{
          type:'button',onClick:close,children:L('取消','Cancel')
        }),
        jsx('button',{
          type:'submit',disabled:busy,children:busy?L('执行中…','Working…'):form.submitLabel
        })]
      })]
    })
  });
}
export function ContextMenu({
  menu, close
})
{
  const ref=react.useRef(null);
  const [pos,setPos]=react.useState({
    left:menu.x,top:menu.y
  });
  react.useLayoutEffect(()=>{
    const r=ref.current.getBoundingClientRect();
    setPos({
      left:Math.max(0,Math.min(menu.x,innerWidth-r.width)),top:Math.max(0,Math.min(menu.y,innerHeight-r.height))
    });
  },
  [menu]);
  react.useEffect(()=>{
    const f=e=>{
      if(!ref.current?.contains(e.target))close();
    };
    window.addEventListener('pointerdown',f);
    return()=>window.removeEventListener('pointerdown',f);
  },
  []);
  return jsx('div',{
    ref,className:'ggMenu',role:'menu',style:pos,children:menu.items.map((item,i)=>item===null?jsx('hr',{
    },
    i):jsx('button',{
      role:'menuitem',disabled:item.disabled,onClick:()=>{
        close();
        item.action();
      },
      children:(item.checked?'✓ ':'')+item.label
    },
    i))
  });
}
export function CommitDetails({
  details,measure,openFile,tree,setTree,L = (zh) => zh
})
{
  const ref=react.useRef(null);
  react.useLayoutEffect(()=>{
    const el=ref.current;
    const update=()=>measure(el.getBoundingClientRect().height);
    update();
    const ro=new ResizeObserver(update);
    ro.observe(el);
    return()=>ro.disconnect();
  },
  [details,tree]);
  const c=details.commit;
  const files=details.files || [];
  const loadingFiles=details.files===null;
  const fileButton=f=>jsx('button',{
    onClick:()=>openFile(f),title:f.oldPath?f.oldPath+' → '+f.path:f.path,children:[jsx('span',{
      className:'ggStatus'+f.status,children:f.status
    }),
    ' '+(tree?f.path.split('/').pop():f.path)+' ',jsx('span',{
      className:'ggStatusA',children:'+'+f.additions
    }),
    ' / ',jsx('span',{
      className:'ggStatusD',children:'-'+f.deletions
    }),
    f.binary?L(' 二进制',' Binary'):'']
  },
  f.path);
  return jsxs('div',{
    ref,className:'ggDetails',children:[jsxs('section',{
      children:[jsx('strong',{
        children:details.direction || c.hash
      }),
      jsx('div',{
        children:L('作者：','Author: ')+c.author+' <'+c.email+'>'
      }),
      jsx('div',{
        children:L('提交者：','Committer: ')+(c.committer || c.author)
      }),
      jsx('div',{
        children:L('日期：','Date: ')+fmtDate(c.date)
      }),
      jsx('div',{
        children:L('父提交：','Parents: ')+c.parents.join(', ')
      }),
      jsx('pre',{
        children:c.hash === 'UNCOMMITTED' ? L('未提交的改动','Uncommitted changes') : c.message
      })]
    }),
    jsxs('section',{
      className:'ggFiles',children:[jsx('button',{
        onClick:()=>setTree(!tree),children:tree?L('切换列表','Show as list'):L('切换文件树','Show as tree')
      }),
      ...(loadingFiles
        ? [jsx('div',{className:'ggDetailsLoading',children:L('正在读取变更文件…','Reading changed files…')},'loading')]
        : tree
          ? [jsx(FileTree,{files,openFile})]
          : files.map(fileButton))]
    })]
  });
}
const GG_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** 与 VS Code Git Graph 一致的日期格式：`10 Nov 2026 21:14`（本地时区）。 */
function fmtDate(sec){
  const d=new Date((Number(sec) || 0)*1000);
  if(!Number.isFinite(d.getTime()))return '';
  const p=n=>String(n).padStart(2,'0');
  return p(d.getDate())+' '+GG_MONTHS[d.getMonth()]+' '+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
}

/** 空图谱占位：切换仓库时先清空，避免旧提交行还能被点击触发动作。 */
const EMPTY_GRAPH = {
  commits: [],
  remotes: [],
  tags: [],
  head: null,
  headBranch: null,
  moreAvailable: false,
};

/** 路径末段作为仓库显示名（兼容 Windows 反斜杠）。 */
function repoDisplayName(value) {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || String(value || '');
}

/** 手动输入或会话目录回退时的仓库条目。 */
function makeRepo(value) {
  return {
    path: value,
    name: repoDisplayName(value),
    branch: '',
    head: '',
    relPath: '.',
    prunable: '',
  };
}

/**
 * 下拉文案：`name（branch）`；根仓库的 relPath 显示为「根」。
 * worktree 的名称常常就是它自己的分支名（`dsh-xxxx`），此时括号里的分支是重复信息，省掉。
 */
export function repoLabel(repo, L = (zh) => zh) {
  const name = repo.name || repoDisplayName(repo.path);
  const title = repo.branch && repo.branch !== name
    ? name + L('（', ' (') + repo.branch + L('）', ')')
    : name;
  return repo.relPath && repo.relPath !== '.' ? title + ' · ' + repo.relPath : title + ' · ' + L('根', 'root');
}

/** 确保当前路径在仓库下拉里；顺带更新当前仓库的分支名。 */
function ensureRepo(list, repoPath, branch) {
  if (!repoPath) return list;
  const index = list.findIndex((repo) => repo.path === repoPath);
  if (index < 0) {
    return [...list, { ...makeRepo(repoPath), branch: branch || '' }];
  }
  if (!branch || list[index].branch === branch) return list;
  const next = list.slice();
  next[index] = { ...next[index], branch };
  return next;
}

/** 把 listRepos 的发现结果并入已有下拉（保留手动输入的路径）。 */
export function mergeRepositories(discovered, existing, activePath) {
  const merged = new Map();
  for (const repo of discovered) {
    if (!repo || !repo.path) continue;
    merged.set(repo.path, { ...makeRepo(repo.path), ...repo });
  }
  for (const repo of existing) {
    if (!merged.has(repo.path)) merged.set(repo.path, repo);
  }
  if (activePath && !merged.has(activePath)) merged.set(activePath, makeRepo(activePath));
  return [...merged.values()];
}

/**
 * 仓库名永远单行：放不下就省略，顶栏高度只由这一行决定。
 * 写成内联样式，是为了不依赖注入的样式表——旧样式表、宿主覆盖或热更新
 * 留下的旧 CSS 都可能让文字换行，把整个顶栏撑高。
 */
const REPO_LABEL_STYLE = {
  display: 'block',
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const REPO_SELECT_STYLE = {
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/**
 * 工具栏左侧的仓库路径控件。路径是「当前在看哪个仓库」的状态，不是可编辑的文本：
 * 单仓只读展示，多仓用下拉切换；不提供手动输入路径的入口。
 */
export function RepoBar({ path, repositories, onPick, L = (zh) => zh }) {
  if (repositories.length > 1) {
    const options = path && !repositories.some((repo) => repo.path === path)
      ? [...repositories, makeRepo(path)]
      : repositories;
    return jsx('select', {
      'aria-label': L('仓库', 'Repository'),
      className: 'ggRepoSelect',
      style: REPO_SELECT_STYLE,
      value: path,
      title: path,
      onChange: (e) => onPick(e.target.value),
      children: options.map((repo) => jsx('option', {
        value: repo.path,
        children: repoLabel(repo, L),
      }, repo.path)),
    });
  }
  const repo = repositories.find((item) => item.path === path) || makeRepo(path);
  return jsx('span', {
    className: 'ggRepoLabel',
    style: REPO_LABEL_STYLE,
    title: path,
    children: path ? repoLabel(repo, L) : L('未选择仓库', 'No repository'),
  });
}

/** tooltip 里的分支 / 标签胶囊。调用方是展开运算，任何分支都必须返回数组。 */
function tooltipPills(values, L = (zh) => zh) {
  if (!values.length) {
    return [jsx('span', { className: 'ggTooltipEmpty', children: L('无', 'None') }, 'empty')];
  }
  return values.map((value) => jsx('span', {
    className: 'ggTooltipRef',
    children: value,
  }, 'ref:' + value));
}

export function RefIcon({
  type
})
{
  return jsx('svg',{
    viewBox:'0 0 16 16','aria-hidden':true,children:jsx('path',{
      d:type==='tag'?'M1 2h7l7 7-6 6-8-8zm3 2v2h2V4z':type==='stash'?'M2 4h12v10H2zm2-3h8v2H4z':type==='remote'?'M3 5h10v7H3zM5 2h6v2H5z':'M3 1h2v8h6V5h2v6H5v4H3z'
    })
  });
}

export function GitGraphView(props) {
  const sessionCwd = props.useSessions((s) => {
    const cur = props.sessionId || s.current;
    return s.byId?.[cur]?.cwd || '';
  });
  const [path, setPath] = react.useState(sessionCwd);
  const [repositories, setRepositories] = react.useState(() => (
    sessionCwd ? [makeRepo(sessionCwd)] : []
  ));
  const [data, setData] = react.useState(EMPTY_GRAPH);
  const [allBranches, setAllBranches] = react.useState([]);
  const [error, setError] = react.useState('');
  const [busy, setBusy] = react.useState(false);
  const [fetching, setFetching] = react.useState(false);
  const loading = react.useRef(false);
  const generation = react.useRef(0);
  const repoRequest = react.useRef(0);
  const branchRequest = react.useRef(0);
  const [order, setOrder] = react.useState('date');
  const [branches, setBranches] = react.useState(null);
  const [remote, setRemote] = react.useState(true);
  const [prefs, setPrefs] = react.useState({
    style: 'rounded',
    align: false,
    first: false,
    mute: true,
    prune: false,
    pruneTags: false,
  });
  // 界面语言：初次启动跟随宿主语言（中文 → 中文，其他 → 英文），手动选过后记在本地。
  const savedLangRef = react.useRef();
  if (savedLangRef.current === undefined) savedLangRef.current = readSavedLang();
  const [lang, setLang] = react.useState(() => savedLangRef.current || detectLang(props.locale));
  const langChosen = react.useRef(savedLangRef.current !== null);
  const L = (zh, en) => (lang === 'en' ? en : zh);
  // 未提交改动是宿主生成的伪提交，message 固定是中文；按界面语言覆盖显示，提交本身的 message 不动。
  const displayMessage = (c) => (c.hash === UNCOMMITTED
    ? L('未提交的改动', 'Uncommitted changes')
    : c.message);
  const stashKind = (kind) => (kind === 'index'
    ? L('索引', 'index')
    : kind === 'untracked'
      ? L('未跟踪', 'untracked')
      : L('内部', 'internal'));
  const chooseLang = (value) => {
    langChosen.current = true;
    setLang(value);
    rememberLang(value);
  };
  react.useEffect(() => {
    const locale = props.locale;
    // 宿主的语言偏好是异步读出来的：用户没手动选过之前，跟着宿主快照走。
    if (!locale?.subscribe || langChosen.current) return undefined;
    return locale.subscribe(() => {
      if (!langChosen.current) setLang(detectLang(locale));
    });
  }, []);
  const [selected, setSelected] = react.useState(null);
  const [details, setDetails] = react.useState(null);
  const [expandY, setExpandY] = react.useState(250);
  const [tree, setTree] = react.useState(true);
  const [drawer, setDrawer] = react.useState(null);
  const [drawerHeight, setDrawerHeight] = react.useState(300);
  const [menu, setMenu] = react.useState(null);
  const [form, setForm] = react.useState(null);
  const [dropdown, setDropdown] = react.useState(false);
  const [branchQuery, setBranchQuery] = react.useState('');
  const [find, setFind] = react.useState(false);
  const [query, setQuery] = react.useState('');
  const [match, setMatch] = react.useState(0);
  const [columns, setColumns] = react.useState({
    Date: true,
    Author: true,
    Commit: true,
  });
  const [hover, setHover] = react.useState(null);
  const [tooltipPos, setTooltipPos] = react.useState(null);
  const hoverTimer = react.useRef(null);
  const root = react.useRef(null);
  const tooltipRef = react.useRef(null);
  const detailRequest = react.useRef(0);
  const fileRequest = react.useRef(0);
  // 详情缓存（hash → 已取到的详情）：再次点开同一提交是瞬时的；刷新/切仓时清空。
  const detailsCache = react.useRef(new Map());
  // 切换仓库时旧详情属于旧仓库，即使新旧渲染之间状态尚未清空也不能重拉。
  const skipDetailRefresh = react.useRef(false);
  // 最新路径的同步镜像：刷新 / 查询类异步回调启动前要确认自己仍属于当前仓库。
  const currentPath = react.useRef(path);
  const lastPath = react.useRef(path);
  currentPath.current = path;

  const call = (op, payload = {}) => {
    const clean = { ...payload };
    for (const key of ['pushRemote', 'remote', 'message']) {
      if (clean[key] === '') delete clean[key];
    }
    if (clean.parent !== undefined) clean.parent = Number(clean.parent);
    return gitCall(op, { path, ...clean }, L);
  };

  /** 独立拉取完整分支列表（不依赖当前已加载提交的 ref）。 */
  const loadBranches = async () => {
    if (!path || path !== currentPath.current) return;
    const id = ++branchRequest.current;
    try {
      const value = await call('branches');
      if (id !== branchRequest.current || path !== currentPath.current) return;
      if (Array.isArray(value?.branches)) setAllBranches(value.branches);
    } catch (e) {
      if (id === branchRequest.current) setAllBranches([]);
    }
  };

  /** 拉取单个提交（或两次提交对比）的详情，所有响应都带失效守卫。 */
  const showDetails = async (commit, compare = false, previous = null) => {
    const id = ++detailRequest.current;
    fileRequest.current++;
    setDrawer(null);
    setExpandY(250);
    // 关键：先用行数据（来自 graph，已含作者/日期/父提交/完整信息）把详情渲染出来，
    // 文件列表随后补。否则要等宿主 commitDetails 返回（本机实测 p50 ≈ 250ms）才有一点反应，
    // 用户感知就是「点一下卡一下」。
    const cached = compare ? null : detailsCache.current.get(commit.hash);
    if (cached) {
      setDetails(cached);
      return;
    }
    setDetails({ commit, files: null, direction: null, compare: null, pending: true });
    try {
      const value = compare && previous
        ? await call('compare', { a: previous, b: commit.hash })
        : await call('commitDetails', { hash: commit.hash });
      if (id !== detailRequest.current) return;
      const next = {
        ...value,
        commit: value.commit || commit,
        direction: compare && previous
          ? previous.slice(0, 8) + ' → ' + commit.hash.slice(0, 8)
          : null,
        // 记住比较的两个端点：抽屉里点文件时要按 a↔b 取差异，而不是相对父提交
        compare: compare && previous ? { a: previous, b: commit.hash } : null,
        pending: false,
      };
      setDetails(next);
      if (!compare) detailsCache.current.set(commit.hash, next);
    } catch (e) {
      if (id === detailRequest.current) {
        setError(e.message);
        setDetails(null);
      }
    }
  };

  const refresh = async (more = false, options = {}) => {
    // 旧仓库闭包里迟到的 refresh 不能把数据写进新仓库。
    if (!path || path !== currentPath.current || (more && loading.current)) return;
    const id = ++generation.current;
    const detailToken = ++detailRequest.current;
    fileRequest.current++;
    loading.current = true;
    setBusy(true);
    setError('');
    // selected 存在但 details 还在路上时也要重拉，否则刷新会把这次请求一并作废。
    const keepDetails = !skipDetailRefresh.current && selected
      ? { hash: selected, compare: details?.compare || null }
      : null;
    skipDetailRefresh.current = false;
    const branchFilter = options.branches === undefined ? branches : options.branches;
    if (!more) loadBranches();
    try {
      const value = await call('graph', {
        maxCommits: more ? 300 : Math.max(300, data.commits.filter((c) => c.hash !== UNCOMMITTED).length),
        skip: more ? data.commits.filter((c) => c.hash !== UNCOMMITTED).length : 0,
        order,
        branches: branchFilter,
        showRemote: remote,
        firstParentOnly: prefs.first,
      });
      if (id !== generation.current) return;
      setRepositories((existing) => ensureRepo(existing, path, value.headBranch));
      setData((previous) => (
        more
          ? {
              ...value,
              commits: [
                ...previous.commits,
                ...value.commits.filter((c) => !previous.commits.some((x) => x.hash === c.hash)),
              ],
            }
          : value
      ));
      // 刷新让旧详情 / 文件 diff 请求失效后，仍展开的详情要重新拉取当前提交。
      if (keepDetails && detailToken === detailRequest.current) {
        const commit = (value.commits || []).find((c) => c.hash === keepDetails.hash)
          || { hash: keepDetails.hash };
        if (keepDetails.compare) await showDetails(commit, true, keepDetails.compare.a);
        else await showDetails(commit);
      }
    } catch (e) {
      if (id === generation.current) setError(e.message);
    } finally {
      if (id === generation.current) {
        setBusy(false);
        loading.current = false;
      }
    }
  };

  react.useEffect(() => {
    ensureStyles();
  }, []);

  // 刷新或切仓后提交内容可能已变（amend/rebase/pull），详情缓存必须失效
  react.useEffect(() => {
    detailsCache.current.clear();
  }, [data, path]);

  // 自动发现：会话目录本身及其子目录里的仓库，并入仓库下拉。
  react.useEffect(() => {
    const id = ++repoRequest.current;
    if (!sessionCwd) return;
    (async () => {
      try {
        const value = await gitCall('listRepos', { path: sessionCwd }, L);
        if (id !== repoRequest.current) return;
        setRepositories((existing) => mergeRepositories(
          Array.isArray(value?.repos) ? value.repos : [],
          existing,
          currentPath.current,
        ));
      } catch (e) {
        if (id !== repoRequest.current) return;
        // 发现失败（例如目录不存在）不打断界面：保留手动输入路径的回退。
        setRepositories((existing) => mergeRepositories([], existing, currentPath.current));
      }
    })();
  }, [sessionCwd]);

  react.useEffect(() => {
    setPath(sessionCwd);
    if (sessionCwd) setRepositories((existing) => ensureRepo(existing, sessionCwd));
  }, [sessionCwd]);

  react.useEffect(() => {
    const switched = lastPath.current !== path;
    lastPath.current = path;
    generation.current++;
    detailRequest.current++;
    fileRequest.current++;
    loading.current = false;
    setBusy(false);
    if (switched) {
      // 切换仓库：旧数据、详情、抽屉、菜单、表单全部作废。
      setData(EMPTY_GRAPH);
      setSelected(null);
      setDetails(null);
      setDrawer(null);
      setMenu(null);
      setForm(null);
      setHover(null);
      setDropdown(false);
      setError('');
      // 旧仓库的分支筛选对新仓库没有意义：重置为「显示全部」并让本次刷新直接用它。
      skipDetailRefresh.current = true;
      if (branches !== null) {
        setBranches(null);
        refresh(false, { branches: null });
        return;
      }
    } else {
      skipDetailRefresh.current = false;
    }
    refresh();
  }, [path, order, branches, remote, prefs.first]);

  const showForm = (title, message, fields, submitLabel, onSubmit) => setForm({
    title,
    message,
    fields,
    submitLabel,
    onSubmit,
  });
  const field = (name, label, value = '', type = 'text', options) => ({
    name,
    label,
    value,
    type,
    options,
  });
  const check = (name, label, value = false) => field(name, label, value, 'checkbox');
  const choice = (name, label, options, value = options[0]) => field(name, label, value, 'select', options);
  const act = (title, op, base = {}, fields = []) => showForm(
    title,
    L('请确认操作参数。', 'Confirm the operation.'),
    fields,
    L('确定', 'OK'),
    async (values) => {
      await call(op, { ...base, ...values });
      await refresh();
    },
  );
  const safe = async (action) => {
    try {
      await action();
    } catch (e) {
      setError(e.message);
    }
  };
  const copy = (text) => safe(() => navigator.clipboard.writeText(text));

  // 抓取是只读操作，和 VS Code 的 Git Graph 一样点一下就执行，不再弹参数确认框。
  // 是否清理失效引用 / 标签放进偏好，默认关闭，需要的人开一次即可。
  const fetchNow = async (remoteName) => {
    if (fetching) return;
    setFetching(true);
    setError('');
    try {
      await call('fetch', {
        ...(remoteName ? { remote: remoteName } : {}),
        prune: prefs.prune,
        pruneTags: prefs.pruneTags,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  };

  const openDetails = async (c, compare = false) => {
    if (selected === c.hash && !compare) {
      closeDetails();
      return;
    }
    const previous = selected;
    setSelected(c.hash);
    await showDetails(c, compare, previous);
  };
  const closeDetails = () => {
    detailRequest.current++;
    fileRequest.current++;
    setSelected(null);
    setDetails(null);
    setDrawer(null);
  };

  const index = data.commits.findIndex((c) => c.hash === selected);
  const model = react.useMemo(() => {
    // 视图保留实测高度的命名，只在引擎边界转换为规格字段。
    const config = { grid: { expandY } };
    return buildLayout(data.commits, {
      head: data.head,
      expandedRow: details ? index : -1,
      firstParentOnly: prefs.first,
      muteMerges: prefs.mute,
      muteNonAncestors: prefs.mute,
      style: prefs.style,
      maxWidth: 240,
      grid: { expand: config.grid.expandY },
    });
  },
  // 图谱重算很贵：只有数据、展开索引、展开态、偏好或展开高度变化时才重算
  // （查找输入不触发；details 也要进依赖，否则展开高度恰为初始值时可能不重算）
  [data, index, details, prefs, expandY]);
  const headAncestors = new Set();
  const byHash = new Map(data.commits.map((c) => [c.hash, c]));
  const pending = [data.head];
  while (pending.length) {
    const hash = pending.pop();
    if (headAncestors.has(hash)) continue;
    headAncestors.add(hash);
    pending.push(...(byHash.get(hash)?.parents || []));
  }
  const matches = data.commits
    .map((c, i) => (
      query
      && [displayMessage(c), c.hash, c.author, ...c.heads, ...c.tags.map((t) => t.name)]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase())
        ? i
        : -1
    ))
    .filter((i) => i >= 0);
  const scrollTo = (i) => root.current?.querySelector('[data-id="' + i + '"]')?.scrollIntoView({
    block: 'center',
  });
  react.useEffect(() => {
    setMatch(0);
  }, [query]);
  react.useEffect(() => {
    if (find && matches.length) scrollTo(matches[match % matches.length]);
  }, [query, match, find]);
  react.useEffect(() => {
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (menu) setMenu(null);
        else if (form) setForm(null);
        else if (dropdown) setDropdown(false);
        else if (find) {
          setFind(false);
          setQuery('');
        } else if (drawer) setDrawer(null);
        else closeDetails();
        return;
      }
      if (ctrl && ['f', 'r', 'h'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'f') setFind(true);
        if (e.key.toLowerCase() === 'r') refresh();
        if (e.key.toLowerCase() === 'h') scrollTo(data.commits.findIndex((c) => c.hash === data.head));
        return;
      }
      if (form || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (selected && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        let next = index + (e.key === 'ArrowUp' ? -1 : 1);
        if (ctrl) {
          next = e.key === 'ArrowDown'
            ? (e.shiftKey ? model.nav.otherParent(index) : model.nav.firstParent(index))
            : (e.shiftKey ? model.nav.otherChild(index) : model.nav.firstChild(index));
        }
        if (data.commits[next]) {
          openDetails(data.commits[next]);
          scrollTo(next);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  react.useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // tooltip 用实际渲染尺寸测量，再夹取到视口内；放不下时翻到圆点左侧。
  react.useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!hover || !el) {
      if (tooltipPos) setTooltipPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const margin = 4;
    const gap = 35;
    let left = hover.x + gap;
    let side = 'right';
    if (left + rect.width > window.innerWidth - margin) {
      left = hover.x - gap - rect.width;
      side = 'left';
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
    let top = hover.y - 12;
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
    setTooltipPos({ left, top, side });
  }, [hover]);

  const openMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };
  const item = (label, action, extra = {}) => ({ label, action, ...extra });
  const mergeFields = [
    check('noFf', L('创建合并提交', 'Create merge commit')),
    check('squash', L('压缩合并', 'Squash')),
    check('noCommit', L('不自动提交', 'No auto-commit')),
  ];
  // 多远端参数在提交前转换为契约数组。
  const pushBranch = (branch) => showForm(
    L('推送分支', 'Push Branch'),
    branch,
    [
      ...data.remotes.map((r, i) => check('remote:' + r, r, i === 0)),
      choice('mode', L('模式', 'Mode'), ['normal', 'force-with-lease', 'force']),
    ],
    L('推送', 'Push'),
    async (v) => {
      const remotes = data.remotes.filter((r) => v['remote:' + r]);
      if (!remotes.length) throw new Error(L('请选择至少一个远端', 'Select at least one remote'));
      await call('pushBranch', {
        branch,
        remotes,
        setUpstream: v.setUpstream,
        mode: v.mode,
      });
      await refresh();
    },
  );
  const createBranch = (c) => act(L('创建分支', 'Create Branch'), 'createBranch', {
    hash: c.hash,
  }, [
    field('name', L('分支名称', 'Branch name')),
    check('checkout', L('创建后切换', 'Checkout after create')),
    check('force', L('强制', 'Force')),
  ]);
  const checkout = (name, remoteBranch) => act(L('切换分支', 'Checkout Branch'), 'checkoutBranch', remoteBranch
    ? { remoteBranch }
    : { name }, remoteBranch
    ? [field('name', L('本地分支名称', 'Local branch name'), name.split('/').slice(1).join('/'))]
    : []);
  const branchMenu = (name, c, isRemote = false) => (isRemote
    ? [
        item(L('切换并建立跟踪', 'Checkout and track'), () => checkout(name, name)),
        item(L('删除远端分支', 'Delete Remote Branch'), () => act(L('删除远端分支', 'Delete Remote Branch'), 'pushBranch', {
          branch: ':refs/heads/' + name.slice(name.indexOf('/') + 1),
          remotes: [name.split('/')[0]],
          mode: 'normal',
        })),
        null,
        item(L('抓取该远端', 'Fetch remote'), () => fetchNow(name.split('/')[0])),
        item(L('合并到当前分支', 'Merge into current branch'), () => act(L('合并', 'Merge'), 'merge', { name }, mergeFields)),
        item(L('拉取', 'Pull'), () => act(L('拉取', 'Pull'), 'pullBranch', {
          // 远程分支必须拆成 remote + remoteRef，否则宿主会把 "origin/main" 当成仓库名
          remote: name.split('/')[0],
          remoteRef: name.slice(name.indexOf('/') + 1),
        }, [
          check('rebase', L('变基', 'Rebase')),
          check('ffOnly', L('仅快进', 'Fast-forward only')),
          check('squash', L('压缩', 'Squash')),
          check('noCommit', L('不提交', "Don't commit")),
        ])),
        null,
        item(L('复制名字', 'Copy name'), () => copy(name)),
      ]
    : [
        item(L('切换', 'Checkout'), () => checkout(name), { disabled: name === data.headBranch }),
        item(L('重命名', 'Rename'), () => act(L('重命名', 'Rename'), 'renameBranch', {
          oldName: name,
        }, [
          field('name', L('新名称', 'New name'), name),
        ])),
        item(L('删除', 'Delete'), () => showForm(
          L('删除分支', 'Delete Branch'),
          name,
          [
            check('force', L('强制删除', 'Force delete')),
            ...data.remotes.map((r) => check('remote:' + r, L('同时删除 ', 'Also delete ') + r)),
          ],
          L('删除', 'Delete'),
          async (v) => {
            await call('deleteBranch', {
              name,
              force: v.force,
              remotes: data.remotes.filter((r) => v['remote:' + r]),
            });
            await refresh();
          },
        )),
        null,
        item(L('合并到当前分支', 'Merge into current branch'), () => act(L('合并', 'Merge'), 'merge', { name }, mergeFields)),
        item(L('变基', 'Rebase'), () => act(L('变基', 'Rebase'), 'rebase', {
          on: name,
        }, [
          check('ignoreDate', L('忽略日期', 'Ignore date')),
        ])),
        item(L('推送', 'Push'), () => pushBranch(name)),
        null,
        item(L('在分支筛选中选中／取消', 'Toggle in branch filter'), () => setBranches(
          branches?.includes(name)
            ? branches.filter((b) => b !== name)
            : [...(branches || []), name],
        ), {
          checked: !!branches?.includes(name),
        }),
        item(L('复制名字', 'Copy name'), () => copy(name)),
      ]);
  const commitMenu = (c) => (c.hash === UNCOMMITTED
    ? [
        item(L('暂存改动', 'Stash changes'), () => act(L('暂存改动', 'Stash changes'), 'stashPush', {}, [
          check('includeUntracked', L('包含未跟踪文件', 'Include untracked files'), true),
          field('message', L('说明', 'Message')),
        ])),
        item(L('重置', 'Reset'), () => act(L('重置', 'Reset'), 'resetToCommit', {
          hash: data.head,
        }, [
          choice('mode', L('模式', 'Mode'), ['mixed', 'hard']),
        ])),
        item(L('清理未跟踪', 'Clean untracked'), () => act(L('清理', 'Clean'), 'clean', {}, [
          check('includeUntracked', L('包含忽略文件', 'Include ignored files')),
          check('force', L('强制', 'Force')),
        ])),
        null,
        item(L('查看变更文件', 'View changed files'), () => openDetails(c)),
      ]
    : [
        item(L('打标签', 'Create tag'), () => act(L('打标签', 'Create tag'), 'tagAdd', {
          hash: c.hash,
        }, [
          field('name', L('标签名', 'Tag name')),
          check('annotated', L('附注标签', 'Annotated tag')),
          field('message', L('说明', 'Message')),
          check('force', L('强制', 'Force')),
          choice('pushRemote', L('同时推送远端', 'Also push to remote'), ['', ...data.remotes]),
        ])),
        item(L('创建分支', 'Create Branch'), () => createBranch(c)),
        item(L('检出（游离）', 'Checkout (detached)'), () => act(L('检出提交', 'Checkout commit'), 'checkoutCommit', {
          hash: c.hash,
        })),
        null,
        item(L('摘取', 'Cherry-pick'), () => act(L('摘取', 'Cherry-pick'), 'cherryPick', {
          hash: c.hash,
        }, [
          ...(c.parents.length > 1
            ? [choice('parent', L('主线父提交', 'Mainline parent'), c.parents.map((_, i) => String(i + 1)))]
            : []),
          check('recordOrigin', L('记录来源', 'Record origin')),
          check('noCommit', L('不提交', "Don't commit")),
        ])),
        item(L('撤销', 'Revert'), () => act(L('撤销', 'Revert'), 'revert', {
          hash: c.hash,
        }, c.parents.length > 1
          ? [choice('parent', L('主线父提交', 'Mainline parent'), c.parents.map((_, i) => String(i + 1)))]
          : [])),
        item(L('丢弃提交…', 'Drop commit…'), () => act(L('丢弃提交', 'Drop commit'), 'dropCommit', {
          hash: c.hash,
        }), {
          disabled: !model.nav.canDrop(data.commits.indexOf(c)),
        }),
        null,
        item(L('合并', 'Merge'), () => act(L('合并', 'Merge'), 'merge', { name: c.hash }, mergeFields)),
        item(L('变基', 'Rebase'), () => act(L('变基', 'Rebase'), 'rebase', {
          on: c.hash,
        }, [
          check('ignoreDate', L('忽略日期', 'Ignore date')),
        ])),
        item(L('重置到此提交', 'Reset to this commit'), () => act(L('重置', 'Reset'), 'resetToCommit', {
          hash: c.hash,
        }, [
          choice('mode', L('模式', 'Mode'), ['soft', 'mixed', 'hard']),
        ])),
        null,
        item(L('复制哈希', 'Copy hash'), () => copy(c.hash)),
        item(L('复制标题', 'Copy title'), () => copy(c.message.split('\n')[0])),
      ]);
  const refMenu = (type, name, c) => {
    if (type === 'head' || type === 'remote') return branchMenu(name, c, type === 'remote');
    if (type === 'tag') {
      return [
        item(L('查看详情', 'View details'), () => openDetails(c)),
        item(L('删除标签', 'Delete tag'), () => act(L('删除标签', 'Delete tag'), 'tagDelete', {
          name,
        }, [
          choice('remote', L('同时删除远端', 'Also delete remote'), ['', ...data.remotes]),
        ])),
        item(L('推送标签', 'Push tag'), () => pushBranch('refs/tags/' + name)),
        null,
        item(L('复制名字', 'Copy name'), () => copy(name)),
      ];
    }
    return [
      item(L('应用', 'Apply'), () => act(L('应用暂存', 'Apply stash'), 'stashApply', {
        ref: name,
      }, [
        check('reinstateIndex', L('恢复暂存区', 'Reinstate index')),
      ])),
      item(L('弹出', 'Pop'), () => act(L('弹出暂存', 'Pop stash'), 'stashPop', {
        ref: name,
      }, [
        check('reinstateIndex', L('恢复暂存区', 'Reinstate index')),
      ])),
      item(L('删除', 'Delete'), () => act(L('删除暂存', 'Drop stash'), 'stashDrop', {
        ref: name,
      })),
      null,
      item(L('创建分支', 'Create Branch'), () => showForm(
        L('从暂存创建分支', 'Create branch from stash'),
        name,
        [field('name', L('分支名称', 'Branch name'))],
        L('创建', 'Create'),
        async (values) => {
          const hash = c.stash.baseHash || c.parents[0];
          if (!hash) throw new Error(L('无法确定暂存的基提交', 'Cannot determine the stash base commit'));
          await call('createBranch', {
            name: values.name,
            hash,
            checkout: true,
            force: false,
          });
          await call('stashPop', { ref: name, reinstateIndex: true });
          await refresh();
        },
      )),
      item(L('复制名字', 'Copy name'), () => copy(name)),
      item(L('复制哈希', 'Copy hash'), () => copy(c.hash)),
    ];
  };
  const badge = (type, name, c, colour, merged = []) => jsxs('span', {
    className: 'gitRef ' + type + (name === data.headBranch ? ' active' : ''),
    style: { '--ref-colour': colour },
    onClick: (e) => e.stopPropagation(),
    onDoubleClick: (e) => {
      e.stopPropagation();
      if (type === 'head' || type === 'remote') {
        checkout(name, type === 'remote' ? name : undefined);
      }
    },
    title: name,
    onContextMenu: (e) => openMenu(e, refMenu(type, name, c)),
    children: [
      jsx(RefIcon, { type }),
      jsx('span', { className: 'ggRefName', children: name }),
      ...merged.map((r) => jsx('span', {
        className: 'gitRefHeadRemote',
        onContextMenu: (e) => openMenu(e, refMenu('remote', r.name, c)),
        onDoubleClick: (e) => {
          e.stopPropagation();
          checkout(r.name, r.name);
        },
        children: r.name,
      }, r.name)),
    ],
  }, type + name);
  const badges = (c, colour) => {
    const merged = new Set();
    const out = [];
    if (c.stashInternal) {
      const info = c.stashInternal;
      out.push(jsxs('span', {
        className: 'gitRef stashIntern',
        style: { '--ref-colour': '#808080' },
        title: L('stash 内部提交', 'Stash internal commit'),
        children: [
          jsx(RefIcon, { type: 'stash' }),
          jsx('span', {
            className: 'ggRefName',
            children: info.selector + ' · ' + stashKind(info.kind),
          }),
        ],
      }, 'stashInternal'));
    }
    out.push(...c.heads.map((name) => {
      const rs = c.remotes.filter((r) => r.name.slice(r.remote.length + 1) === name);
      rs.forEach((r) => merged.add(r.name));
      return badge('head', name, c, colour, rs);
    }));
    c.remotes.filter((r) => !merged.has(r.name)).forEach((r) => out.push(badge('remote', r.name, c, colour)));
    c.tags.forEach((t) => out.push(badge('tag', t.name, c, colour)));
    if (c.stash) out.push(badge('stash', c.stash.selector, c, colour));
    return out;
  };
  const openFile = async (f) => {
    const id = ++fileRequest.current;
    const compared = details && details.compare;
    try {
      let value = await call('fileDiff', compared
        ? { a: details.compare.a, b: details.compare.b, file: f.path }
        : { hash: selected, file: f.path });
      let staged = false;
      // 未提交改动行：先看工作区；工作区为空说明改动已暂存，再看暂存区（否则会误报「无差异」）
      if (!compared && selected === UNCOMMITTED && !value.text) {
        value = await call('fileDiff', { hash: selected, file: f.path, staged: true });
        staged = true;
      }
      if (id !== fileRequest.current) return;
      let mode;
      if (compared) {
        mode = L('比较 ', 'Compare ') + details.compare.a.slice(0, 8) + ' → ' + details.compare.b.slice(0, 8);
      } else if (selected === UNCOMMITTED) {
        mode = staged ? L('HEAD → 暂存区', 'HEAD → index') : L('HEAD → 工作区', 'HEAD → working tree');
      } else {
        mode = f.status === 'A' ? L('新增文件', 'New file') : L('父提交 → ', 'Parent → ') + selected.slice(0, 8);
      }
      setDrawer({ ...value, file: f.path, direction: mode });
    } catch (e) {
      setError(e.message);
    }
  };
  const highlight = (text) => {
    if (!query) return text;
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    return at < 0
      ? text
      : [
          text.slice(0, at),
          jsx('mark', { children: text.slice(at, at + query.length) }),
          text.slice(at + query.length),
        ];
  };
  const settings = () => [
    item(L('圆角', 'Rounded'), () => setPrefs({ ...prefs, style: 'rounded' }), {
      checked: prefs.style === 'rounded',
    }),
    item(L('直角', 'Angular'), () => setPrefs({ ...prefs, style: 'angular' }), {
      checked: prefs.style === 'angular',
    }),
    null,
    ...[
      ['align', L('标签对齐图谱', 'Align labels to graph')],
      ['first', L('只跟随第一父', 'First parent only')],
      ['mute', L('变灰非当前分支提交', 'Dim commits not on current branch')],
    ].map(([key, label]) => item(label, () => setPrefs({
      ...prefs,
      [key]: !prefs[key],
    }), {
      checked: prefs[key],
    })),
    null,
    ...[
      ['prune', L('抓取时清理失效引用', 'Prune stale refs on fetch')],
      ['pruneTags', L('抓取时清理标签', 'Prune tags on fetch')],
    ].map(([key, label]) => item(label, () => setPrefs({
      ...prefs,
      [key]: !prefs[key],
    }), {
      checked: prefs[key],
    })),
    null,
    ...['date', 'author-date', 'topo'].map((value) => item(value, () => setOrder(value), {
      checked: order === value,
    })),
    null,
    item('中文', () => chooseLang('zh'), { checked: lang === 'zh' }),
    item('English', () => chooseLang('en'), { checked: lang === 'en' }),
  ];

  const toggleBranch = (name) => {
    if (branches === null) {
      setBranches(allBranches.map((branch) => branch.name).filter((item) => item !== name));
    } else if (branches.includes(name)) {
      setBranches(branches.filter((item) => item !== name));
    } else {
      setBranches([...branches, name]);
    }
  };
  const branchQueryText = branchQuery.toLowerCase();
  const filteredBranches = allBranches
    .filter((branch) => branch.name.toLowerCase().includes(branchQueryText));
  const branchGroups = [
    { label: L('本地分支', 'Local branches'), items: filteredBranches.filter((branch) => !branch.remote) },
    { label: L('远程分支', 'Remote branches'), items: filteredBranches.filter((branch) => branch.remote) },
  ];
  const branchLabel = branches === null
    ? 'Show All'
    : branches.length === 1
      ? branches[0]
      : branches.length
        ? L(branches.length + ' 个分支', branches.length + (branches.length === 1 ? ' branch' : ' branches'))
        : L('未选择分支', 'No branches selected');
  const branchDropdown = dropdown && jsxs('div', {
    className: 'ggDropdown',
    children: [
      jsx('input', {
        placeholder: L('搜索分支', 'Search branches'),
        value: branchQuery,
        onChange: (e) => setBranchQuery(e.target.value),
      }),
      jsxs('label', {
        children: [
          jsx('input', {
            type: 'checkbox',
            checked: branches === null,
            onChange: () => setBranches(branches === null ? [] : null),
          }),
          L('显示全部', 'Show all'),
        ],
      }),
      ...branchGroups.map((group) => (
        group.items.length
          ? jsxs('div', {
              className: 'ggDropdownGroup',
              children: [
                jsx('div', { className: 'ggDropdownTitle', children: group.label }),
                ...group.items.map((branch) => jsxs('label', {
                  className: 'ggDropdownItem',
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: branches === null || branches.includes(branch.name),
                      onChange: () => toggleBranch(branch.name),
                    }),
                    jsx('span', { className: 'ggBranchName', children: branch.name }),
                    branch.current
                      ? jsx('span', { className: 'ggBranchCurrent', children: L('当前', 'current') })
                      : null,
                  ],
                }, branch.name)),
              ],
            })
          : null
      )),
      filteredBranches.length === 0 && jsx('div', {
        className: 'ggDropdownEmpty',
        children: L('没有匹配的分支', 'No matching branches'),
      }),
    ],
  });

  const rows = [];
  data.commits.forEach((c, i) => {
    const colour = model.points[i]?.colour;
    rows.push(jsxs('tr', {
      className: 'commit'
        + (c.hash === data.head ? ' current' : '')
        + (c.stashInternal ? ' ggStashInternal' : '')
        + (!c.stashInternal && model.muted[i] ? ' mute' : '')
        + (selected === c.hash ? ' commitDetailsOpen' : '')
        + (hover?.index === i ? ' graphVertexActive' : '')
        + (find && matches[match % matches.length] === i ? ' findCurrentCommit' : ''),
      'data-id': i,
      'data-color': colour,
      onClick: (e) => openDetails(c, e.ctrlKey || e.metaKey),
      onContextMenu: (e) => openMenu(e, c.stash ? refMenu('stash', c.stash.selector, c) : commitMenu(c)),
      children: [
        jsx('td', {}),
        jsx('td', {
          children: jsxs('div', {
            className: 'ggDescription',
            style: { marginLeft: prefs.align ? Math.max(0, model.rowWidths[i] - 32) : 0 },
            children: [
              c.hash === data.head && jsx('span', {
                className: 'ggHead',
                style: { color: colour },
              }),
              ...badges(c, colour),
              jsx('span', {
                className: 'ggTitle',
                children: highlight(displayMessage(c).split('\n')[0]),
              }),
            ],
          }),
        }),
        columns.Date && jsx('td', {
          className: 'ggDate',
          children: fmtDate(c.date),
        }),
        columns.Author && jsx('td', { children: highlight(c.author) }),
        columns.Commit && jsx('td', { children: highlight(c.hash.slice(0, 8)) }),
      ],
    }, c.hash));
    if (c.hash === selected && details) {
      rows.push(jsxs('tr', {
        className: 'cdvRow',
        children: [
          // 图谱列占位：详情必须从线的右侧开始，压在图谱上会把哈希挡住
          jsx('td', {}),
          jsx('td', {
            colSpan: 1 + Object.values(columns).filter(Boolean).length,
            children: jsx(CommitDetails, {
              details,
              measure: setExpandY,
              openFile,
              tree,
              setTree,
              L,
            }),
          }),
        ],
      }, 'details'));
    }
  });

  const hoverCommit = hover ? data.commits[hover.index] : null;
  const hoverStash = hoverCommit ? (hoverCommit.stash || hoverCommit.stashInternal) : null;

  return jsxs('div', {
    className: 'dshGraph',
    'data-git-view': true,
    ref: root,
    children: [
      jsxs('div', {
        className: 'ggToolbar',
        children: [
          jsx('div', {
            className: 'ggBarLeft',
            children: jsx(RepoBar, {
              path,
              repositories,
              onPick: setPath,
              L,
            }),
          }),
          jsxs('div', {
            className: 'ggBarCenter',
            children: [
              jsx('span', { className: 'ggBarLabel', children: 'Branches:' }),
              jsxs('span', {
                className: 'ggBranchAnchor',
                children: [
                  jsx('button', {
                    className: 'ggBranchSelect',
                    disabled: busy,
                    onClick: () => setDropdown(!dropdown),
                    children: branchLabel + ' ▾',
                  }),
                  branchDropdown,
                ],
              }),
              jsxs('label', {
                children: [
                  jsx('input', {
                    type: 'checkbox',
                    checked: remote,
                    onChange: (e) => setRemote(e.target.checked),
                  }),
                  L('显示远程分支', 'Show remote branches'),
                ],
              }),
            ],
          }),
          jsxs('div', {
            className: 'ggBarRight',
            children: [
              jsx('button', {
                title: L('查找 Ctrl+F', 'Find (Ctrl+F)'),
                onClick: () => setFind(!find),
                children: jsx(ToolIcon, { name: 'find' }),
              }),
              jsx('button', {
                title: L('偏好', 'Preferences'),
                onClick: (e) => openMenu(e, settings()),
                children: jsx(ToolIcon, { name: 'settings' }),
              }),
              jsx('button', {
                title: L('刷新 Ctrl+R', 'Refresh (Ctrl+R)'),
                disabled: busy,
                onClick: () => refresh(),
                children: jsx(ToolIcon, { name: 'refresh' }),
              }),
              jsx('button', {
                title: fetching ? L('抓取中…', 'Fetching…') : L('抓取', 'Fetch'),
                disabled: fetching,
                onClick: () => fetchNow(),
                children: jsx(ToolIcon, { name: 'fetch' }),
              }),
            ],
          }),
        ],
      }),
      error && jsxs('div', {
        className: 'ggError',
        role: 'alert',
        children: [
          error,
          jsx('button', { onClick: () => setError(''), children: L('关闭', 'Close') }),
        ],
      }),
      find && jsxs('div', {
        className: 'ggToolbar',
        children: [
          jsx('input', {
            autoFocus: true,
            placeholder: L('查找提交', 'Find commit'),
            value: query,
            onChange: (e) => setQuery(e.target.value),
          }),
          jsx('span', {
            children: L('第 ' + (matches.length ? match % matches.length + 1 : 0) + ' / 共 ' + matches.length + ' 个', (matches.length ? match % matches.length + 1 : 0) + ' / ' + matches.length),
          }),
          jsx('button', { onClick: () => setMatch(match + 1), children: L('下一个', 'Next') }),
          jsx('button', {
            onClick: () => {
              setFind(false);
              setQuery('');
            },
            children: L('关闭', 'Close'),
          }),
        ],
      }),
      jsx('div', {
        className: 'ggScroll',
        onScroll: (e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 25 && data.moreAvailable) refresh(true);
        },
        children: jsxs('div', {
          className: 'ggTableWrap',
          children: [
            jsxs('table', {
              className: 'ggTable',
              children: [
                jsxs('colgroup', {
                  children: [
                    jsx('col', { style: { width: prefs.align ? 32 : model.width + 8 } }),
                    jsx('col', {}),
                    columns.Date && jsx('col', { style: { width: 170 } }),
                    columns.Author && jsx('col', { style: { width: 120 } }),
                    columns.Commit && jsx('col', { style: { width: 85 } }),
                  ],
                }),
                jsx('thead', {
                  onContextMenu: (e) => openMenu(e, [
                    ...Object.keys(columns).map((key) => item(key, () => setColumns({
                      ...columns,
                      [key]: !columns[key],
                    }), {
                      checked: columns[key],
                    })),
                    null,
                    ...['date', 'author-date', 'topo'].map((value) => item(value, () => setOrder(value), {
                      checked: order === value,
                    })),
                  ]),
                  children: jsx('tr', {
                    children: ['Graph', 'Description', ...Object.keys(columns).filter((k) => columns[k])]
                      .map((t) => jsx('th', { children: t }, t)),
                  }),
                }),
                jsx('tbody', { children: rows }),
              ],
            }),
            jsxs('svg', {
              className: 'ggSVG',
              width: model.width,
              height: model.height,
              children: [
                ...model.paths.flatMap((p, i) => [
                  jsx('path', { className: 'shadow', d: p.d }, 's' + i),
                  jsx('path', {
                    className: 'line',
                    d: p.d,
                    stroke: p.colour,
                    strokeDasharray: p.dashed ? '4 4' : undefined,
                  }, 'p' + i),
                ]),
                ...model.points.map((v, i) => jsxs('g', {
                  children: [
                    jsx('circle', {
                      cx: v.x,
                      cy: v.y,
                      r: hover?.index === i ? 5 : (v.stash ? 4.5 : 4),
                      fill: v.current ? 'var(--dsw-alias-bg-base)' : v.colour,
                      stroke: v.colour,
                      strokeWidth: 2,
                      onClick: () => openDetails(data.commits[i]),
                      onMouseEnter: (e) => {
                        clearTimeout(hoverTimer.current);
                        const x = e.clientX;
                        const y = e.clientY;
                        hoverTimer.current = setTimeout(() => setHover({
                          index: i,
                          x,
                          y,
                          colour: v.colour,
                        }), 100);
                      },
                      onMouseLeave: () => {
                        clearTimeout(hoverTimer.current);
                        setHover(null);
                      },
                    }),
                    v.stash && jsx('circle', {
                      cx: v.x,
                      cy: v.y,
                      r: 2,
                      fill: 'var(--dsw-alias-bg-base)',
                      style: { pointerEvents: 'none' },
                    }),
                  ],
                }, i)),
              ],
            }),
            data.moreAvailable && jsx('button', {
              disabled: busy,
              onClick: () => refresh(true),
              children: busy ? L('加载中…', 'Loading…') : L('加载更多提交', 'Load more commits'),
            }),
          ],
        }),
      }),
      hoverCommit && jsxs('div', {
        ref: tooltipRef,
        className: 'ggTooltip' + (tooltipPos?.side === 'left' ? ' ggTooltipLeft' : ''),
        style: {
          left: tooltipPos ? tooltipPos.left : hover.x + 35,
          top: tooltipPos ? tooltipPos.top : hover.y - 12,
          // 等实际尺寸量完再显示，避免用固定估算值闪现到错误位置。
          visibility: tooltipPos ? 'visible' : 'hidden',
          '--ref-colour': hover.colour,
        },
        children: [
          jsxs('div', {
            className: 'ggTooltipRow',
            children: [
              jsx('span', { className: 'ggTooltipKey', children: L('提交', 'Commit') }),
              jsx('span', { children: hoverCommit.hash.slice(0, 8) }),
            ],
          }),
          jsx('div', {
            children: L('该提交' + (headAncestors.has(hoverCommit.hash) ? '' : '未') + '包含在 HEAD 中', 'This commit is ' + (headAncestors.has(hoverCommit.hash) ? '' : 'not ') + 'contained in HEAD'),
          }),
          jsxs('div', {
            className: 'ggTooltipRow',
            children: [
              jsx('span', { className: 'ggTooltipKey', children: L('分支：', 'Branches: ') }),
              ...tooltipPills([
                ...hoverCommit.heads,
                ...hoverCommit.remotes.map((r) => r.name),
              ], L),
            ],
          }),
          jsxs('div', {
            className: 'ggTooltipRow',
            children: [
              jsx('span', { className: 'ggTooltipKey', children: L('标签：', 'Tags: ') }),
              ...tooltipPills(hoverCommit.tags.map((t) => t.name), L),
            ],
          }),
          hoverStash && jsxs('div', {
            className: 'ggTooltipRow',
            children: [
              jsx('span', { className: 'ggTooltipKey', children: L('stash：', 'Stash: ') }),
              ...tooltipPills([hoverStash.selector], L),
              hoverStash.kind
                ? jsx('span', { className: 'ggTooltipKey', children: ' · ' + stashKind(hoverStash.kind) })
                : null,
            ],
          }),
        ],
      }),
      drawer && jsxs('div', {
        className: 'ggDrawer',
        style: { height: drawerHeight },
        children: [
          jsx('div', {
            className: 'ggResize',
            onPointerDown: (e) => {
              const start = e.clientY;
              const height = drawerHeight;
              const move = (ev) => setDrawerHeight(
                Math.max(200, Math.min(window.innerHeight * 0.7, height + start - ev.clientY)),
              );
              const end = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', end);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', end);
            },
          }),
          jsxs('header', {
            children: [
              drawer.file + ' · ' + drawer.direction,
              jsx('button', { onClick: () => setDrawer(null), children: L('关闭', 'Close') }),
            ],
          }),
          drawer.truncated && jsx('div', {
            className: 'ggError',
            children: L('差异内容已截断（2MB）', 'Diff truncated (2 MB)'),
          }),
          jsx(DiffView, { text: drawer.text, L }),
        ],
      }),
      menu && jsx(ContextMenu, { menu, close: () => setMenu(null) }),
      form && jsx(FormDialog, { form, close: () => setForm(null), L }, form.title),
    ],
  });
}
export function ToolIcon({
  name
})
{
  const paths={
    find:'M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1m4 9 5 5',refresh:'M13 5A6 6 0 1 0 14 10M13 1v4H9',fetch:'M8 1v10m-4-4 4 4 4-4M2 12v3h12v-3',settings:'M8 1v3m0 8v3M1 8h3m8 0h3M3 3l2 2m6 6 2 2M3 13l2-2m6-6 2-2M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
  };
  return jsx('svg',{
    width:16,height:16,viewBox:'0 0 16 16','aria-hidden':true,style:{
      verticalAlign:'middle'
    },
    children:jsx('path',{
      d:paths[name],fill:'none',stroke:'currentColor',strokeWidth:1.5
    })
  });
}
export function FileTree({
  files,openFile,prefix=''
})
{
  const [collapsed,setCollapsed]=react.useState({
  });
  const folders=new Map(),leaves=[];
  for(const file of files){
    const rest=file.path.slice(prefix.length);
    const slash=rest.indexOf('/');
    if(slash<0)leaves.push(file);
    else{
      const name=rest.slice(0,slash);
      if(!folders.has(name))folders.set(name,[]);
      folders.get(name).push(file);
    }
  }
  return jsxs('div',{
    children:[...Array.from(folders).sort(([a],[b])=>a.localeCompare(b)).map(([name,group])=>jsxs('div',{
      children:[jsx('button',{
        'aria-expanded':!collapsed[name],onClick:()=>setCollapsed({
          ...collapsed,[name]:!collapsed[name]
        }),
        children:(collapsed[name]?'＋ ':'− ')+name
      }),
      !collapsed[name]&&jsx('div',{
        style:{
          paddingLeft:16
        },
        children:jsx(FileTree,{
          files:group,openFile,prefix:prefix+name+'/'
        })
      })]
    },
    name)),...leaves.map(file=>jsx('button',{
      onClick:()=>openFile(file),title:file.oldPath?file.oldPath+' → '+file.path:file.path,children:[jsx('span',{
        className:'ggStatus'+file.status,children:file.status
      }),
      ' '+file.path.slice(prefix.length)+' ',jsx('span',{
        className:'ggStatusA',children:'+'+file.additions
      }),
      ' / ',jsx('span',{
        className:'ggStatusD',children:'-'+file.deletions
      }),
      file.binary?L(' 二进制',' Binary'):'']
    },
    file.path))]
  });
}
