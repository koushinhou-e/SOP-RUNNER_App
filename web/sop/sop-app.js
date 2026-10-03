/* Synced from v1 sop-runner/src/app.js by tools/sync_from_v1.py — do not edit by hand. */
/* ===================== SOP Runner 主程序 ===================== */
(function () {
  'use strict';
  var PREFIX = 'sopRunner:v1:';
  var S = null;           // 当前会话状态
  var app = document.getElementById('sop-app');
  var hdr = document.getElementById('sop-hdr');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1600); }
  function nowIso() { return new Date().toISOString(); }
  function nowLocalShort() { return Fmt.local(nowIso()).slice(0, 16); }

  /* ---------- 哈希（FNV-1a 双种子 → 16 位十六进制；无需 crypto.subtle） ---------- */
  function hashBytes(u8) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < u8.length; i++) { h1 ^= u8[i]; h1 = Math.imul(h1, 16777619); h2 ^= u8[i]; h2 = Math.imul(h2, 0x5bd1e995); h2 ^= h2 >>> 15; }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')) + '-' + u8.length.toString(36);
  }

  /* ---------- 存储 ---------- */
  function save() { if (!S) return; S.updatedAt = nowIso(); SopStore.save(S); }
  function load(key) { return SopStore.load(key); }
  function listSessions() {
    var out = [];
    SopStore.list().forEach(function (s) { if (s && s.steps) out.push(s); });
    return out.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  }

  /* ---------- 会话 ---------- */
  function uid() { S.seq = (S.seq || 0) + 1; return 'x' + S.seq.toString(36); }
  function mkStep(o) {
    var st = { id: uid(), section: o.section || '', title: o.title || '', context: o.context || '', content: o.content || '', expected: o.expected || '', inputs: [] };
    (o.inputs || []).forEach(function (inp) { st.inputs.push({ id: uid(), label: inp.label, type: inp.type || 'text', unit: inp.unit || '', optional: !!inp.optional }); });
    return st;
  }
  function newSession(docName, hash, parsed) {
    S = { key: PREFIX + docName + ':' + hash, docName: docName, docTitle: parsed.title || docName.replace(/\.docx$/i, ''), hash: hash, createdAt: nowIso(), updatedAt: nowIso(), phase: 'edit', seq: 0, steps: [], results: {}, executor: localStorage.getItem('sopRunner:executor') || '', startedAt: null, finishedAt: null, view: 0, exportLang: 'ja' };
    S.steps = parsed.steps.map(mkStep);
    save();
  }
  function openSession(s) { S = s; S.view = S.phase === 'done' ? 'done' : curIndex(); }
  function curIndex() { for (var i = 0; i < S.steps.length; i++) { var r = S.results[S.steps[i].id]; if (!r || !r.confirmedAt) return i; } return S.steps.length; }
  function res(st) { return S.results[st.id] || (S.results[st.id] = { values: {}, note: '', anomaly: false, confirmedAt: null }); }
  function isFilled(inp, v) { return inp.type === 'check' ? v === true : (v != null && String(v).trim() !== ''); }
  function missing(st) { var r = res(st); return st.inputs.filter(function (inp) { return !inp.optional && !isFilled(inp, r.values[inp.id]); }); }

  /* ---------- 导入 ---------- */
  function importDocx(file) {
    if (!/\.docx$/i.test(file.name)) { toast('请选择 .docx 文件（不支持旧版 .doc，请先在 Word 中另存为 .docx）'); return; }
    file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), hash = hashBytes(u8), key = PREFIX + file.name + ':' + hash;
      var old = load(key);
      if (old && confirm('发现此文档的已保存进度（' + countDone(old) + '/' + old.steps.length + ' 步已确认）。\n确定 = 继续上次进度；取消 = 重新解析并覆盖。')) { openSession(old); save(); render(); toast('已恢复进度'); return; }
      return SopParser.parseDocx(buf).then(function (parsed) {
        if (!parsed.steps.length) { toast('没有识别到任何步骤'); return; }
        newSession(file.name, hash, parsed); render();
        toast('解析完成：' + S.steps.length + ' 个步骤');
      });
    }).catch(function (e) { console.error(e); alert('解析失败：' + e.message); });
  }
  function countDone(s) { return s.steps.filter(function (st) { return s.results[st.id] && s.results[st.id].confirmedAt; }).length; }

  /* ---------- 下载 ---------- */
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function baseName() { return S.docName.replace(/\.docx$/i, ''); }
  function stamp() { var d = new Date(); return d.getFullYear() + Fmt.pad(d.getMonth() + 1) + Fmt.pad(d.getDate()) + '-' + Fmt.pad(d.getHours()) + Fmt.pad(d.getMinutes()); }
  function exportDocx() {
    if (!S.executor.trim()) { toast('请先填写执行者姓名'); var el = document.querySelector('[data-bind=executor]'); if (el) el.focus(); return; }
    exportRecordDocx(S, 'simple-table', S.exportLang || 'ja').then(function (blob) { download(blob, baseName() + '_実施記録_' + stamp() + '.docx'); toast('已导出 Word 执行记录'); });
  }
  function exportJson() {
    var blob = new Blob([JSON.stringify({ format: 'sop-runner-run', version: 1, exportedAt: nowIso(), state: S }, null, 2)], { type: 'application/json' });
    download(blob, baseName() + '_run_' + stamp() + '.json');
  }
  function importJson(file) {
    file.text().then(function (txt) {
      var o = JSON.parse(txt), st = o && o.format === 'sop-runner-run' ? o.state : null;
      if (!st || !Array.isArray(st.steps) || !st.docName) throw new Error('不是 SOP Runner 的 JSON 备份');
      st.key = PREFIX + st.docName + ':' + st.hash;
      if (load(st.key) && !confirm('本机已有此文档的进度，用备份覆盖？')) return;
      openSession(st); save(); render(); toast('已从 JSON 恢复');
    }).catch(function (e) { alert('导入失败：' + e.message); });
  }

  /* ---------- 复制 ---------- */
  function copyText(t) {
    function fb() { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb); else fb();
    toast('已复制：' + (t.length > 40 ? t.slice(0, 40) + '…' : t));
  }

  /* ---------- 渲染：通用 ---------- */
  var reBlank = new RegExp(SopParser.BLANK_SRC, 'g');
  function renderInline(line) {
    return line.split(/(`[^`]*`)/).map(function (seg) {
      var m = seg.match(/^`([^`]*)`$/);
      if (m) return '<span class="icode" lang="en">' + esc(m[1]) + '<button data-copy="' + esc(m[1]) + '" title="复制">⧉</button></span>';
      return esc(seg).replace(reBlank, function (b) { return '<span class="blank">' + b + '</span>'; });
    }).join('');
  }
  function renderContent(text) {
    return String(text || '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) {
      var m = l.trim().match(/^`([^`]*)`$/);
      if (m) { var c = SopParser.stripPrompt(m[1]); return '<div class="cmd"><code>' + esc(m[1]) + '</code><button data-copy="' + esc(c) + '" title="复制（已去掉提示符 $ / #）">复制</button></div>'; }
      return '<div class="ln">' + renderInline(l) + '</div>';
    }).join('');
  }

  function renderHeader() {
    var h = '<h1>📋 SOP Runner</h1><span class="badge off" title="本工具不发起任何网络请求">离线</span>';
    if (S) {
      h += '<span class="doc" lang="ja">' + esc(S.docTitle) + '</span><span class="sp"></span>';
      if (S.phase !== 'edit') h += '<button data-act="exportJson">导出 JSON</button><button data-act="reset">重置进度</button>';
      h += '<button data-act="home">返回首页</button>';
    } else h += '<span class="sp"></span><span class="muted" style="color:#cbd5e1">Word 手顺书 → 逐步执行 + 证跡记录</span>';
    hdr.innerHTML = h;
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    var ss = listSessions();
    var h = '<div class="drop" id="drop"><h2>拖入 Word 手顺书（.docx）</h2><p class="muted">或者</p><button class="primary" data-act="pick">选择 .docx 文件</button>' +
      '<input type="file" id="fileDocx" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="hidden">' +
      '<p class="muted" style="margin-top:14px">文件只在本机浏览器内解析，不上传、不联网。进度自动保存在本机浏览器（localStorage）。</p></div>';
    h += '<div class="card" style="margin-top:14px"><div class="row" style="justify-content:space-between"><b>已保存的进度</b><span><button data-act="pickJson">导入 JSON 备份</button><input type="file" id="fileJson" accept=".json,application/json" class="hidden"></span></div>';
    if (!ss.length) h += '<p class="muted">暂无。</p>';
    else h += '<table class="list" id="sessions"><tr><th>文档</th><th>状态</th><th>进度</th><th>最后更新</th><th></th></tr>' + ss.map(function (s) {
      var d = countDone(s), ph = { edit: '编辑中', run: '执行中', done: '已完成' }[s.phase] || s.phase;
      return '<tr><td lang="ja">' + esc(s.docTitle) + '<div class="muted">' + esc(s.docName) + '</div></td><td><span class="badge ' + (s.phase === 'done' ? 'ok' : '') + '">' + ph + '</span></td><td>' + d + ' / ' + s.steps.length + '</td><td>' + esc(Fmt.local(s.updatedAt)) + '</td><td style="white-space:nowrap"><button class="primary small" data-act="resume" data-key="' + esc(s.key) + '">继续</button> <button class="small danger" data-act="delSession" data-key="' + esc(s.key) + '">删除</button></td></tr>';
    }).join('') + '</table>';
    h += '</div>';
    h += '<div class="card muted"><b>识别规则简述：</b>标题 → 章节；编号/项目符号列表的每一项 → 一个步骤；含空单元格或"確認結果"列的表格 → 每行一个步骤；"期待結果/確認内容/expected" → 期待结果；等宽字体或以 $ / # 开头的行 → 命令（带复制按钮）；＿＿＿ / （　） / 【　】 / □ / "確認結果：" / "記入" / 空单元格 → 输入框。导入后可在编辑模式中修正。</div>';
    app.innerHTML = h;
    if (window.SopHooks && SopHooks.afterHome) SopHooks.afterHome(app);
    var drop = document.getElementById('drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) importDocx(f); });
    document.getElementById('fileDocx').addEventListener('change', function (e) { if (e.target.files[0]) importDocx(e.target.files[0]); e.target.value = ''; });
    document.getElementById('fileJson').addEventListener('change', function (e) { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
  }

  /* ---------- 编辑模式 ---------- */
  var TYPES = { text: '文本', time: '时间', result: '结果(OK/NG)', check: '勾选' };
  function renderEdit() {
    var nIn = S.steps.reduce(function (a, s) { return a + s.inputs.length; }, 0);
    var h = '<div class="card"><div class="row" style="justify-content:space-between"><div><b>编辑模式</b> <span class="muted">共 <b id="stepCount">' + S.steps.length + '</b> 个步骤、<b id="inputCount">' + nIn + '</b> 个输入项。修正拆分错误后点击「开始执行」。</span></div>' +
      '<div class="row"><label>执行者 <input type="text" data-bind="executor" value="' + esc(S.executor) + '" placeholder="姓名（必填）" style="width:160px"></label><button class="primary" data-act="start" id="btnStart">开始执行 ▶</button></div></div>' +
      '<p class="muted" style="margin:6px 0 0">提示：操作内容中整行用 `反引号` 包住表示命令（带复制按钮）；行内 `xxx` 为行内代码。修改文本后可点「重新检测输入」。</p></div>';
    h += '<div class="ins"><button class="insbtn" data-act="insert" data-at="0">＋ 在开头插入步骤</button></div>';
    S.steps.forEach(function (st, i) {
      h += '<div class="ed" data-sid="' + st.id + '"><div class="hd"><span class="num">#' + (i + 1) + '</span>' +
        '<input type="text" data-ed="title" data-sid="' + st.id + '" value="' + esc(st.title) + '" lang="ja" style="flex:1;min-width:200px">' +
        '<button class="small" data-act="up" data-sid="' + st.id + '" ' + (i === 0 ? 'disabled' : '') + ' title="上移">↑</button>' +
        '<button class="small" data-act="down" data-sid="' + st.id + '" ' + (i === S.steps.length - 1 ? 'disabled' : '') + ' title="下移">↓</button>' +
        '<button class="small" data-act="merge" data-sid="' + st.id + '" ' + (i === S.steps.length - 1 ? 'disabled' : '') + ' title="与下一步合并">合并↓</button>' +
        '<button class="small" data-act="split" data-sid="' + st.id + '" title="在「操作内容」光标位置拆分为两步">在光标处拆分</button>' +
        '<button class="small" data-act="redetect" data-sid="' + st.id + '">重新检测输入</button>' +
        '<button class="small danger" data-act="delStep" data-sid="' + st.id + '">删除</button></div>' +
        '<div class="bd"><div class="full"><div class="lbl">章节</div><input type="text" data-ed="section" data-sid="' + st.id + '" value="' + esc(st.section) + '" lang="ja"></div>' +
        '<div><div class="lbl">操作内容</div><textarea class="mono" rows="' + Math.min(10, Math.max(3, st.content.split('\n').length + 1)) + '" data-ed="content" data-sid="' + st.id + '" lang="ja">' + esc(st.content) + '</textarea></div>' +
        '<div><div class="lbl">期待结果</div><textarea rows="3" data-ed="expected" data-sid="' + st.id + '" lang="ja">' + esc(st.expected) + '</textarea>' +
        (st.context ? '<div class="lbl">章节说明（只读显示）</div><textarea rows="2" data-ed="context" data-sid="' + st.id + '" lang="ja">' + esc(st.context) + '</textarea>' : '') + '</div>' +
        '<div class="full"><div class="lbl">输入项（' + st.inputs.length + '）</div><table><tr><th style="width:45%">标签</th><th>类型</th><th>单位</th><th>可选</th><th></th></tr>' +
        st.inputs.map(function (inp) {
          return '<tr class="inprow"><td><input type="text" data-inped="label" data-sid="' + st.id + '" data-iid="' + inp.id + '" value="' + esc(inp.label) + '" lang="ja"></td><td><select data-inped="type" data-sid="' + st.id + '" data-iid="' + inp.id + '">' +
            Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (inp.type === k ? ' selected' : '') + '>' + TYPES[k] + '</option>'; }).join('') + '</select></td>' +
            '<td><input type="text" style="width:70px" data-inped="unit" data-sid="' + st.id + '" data-iid="' + inp.id + '" value="' + esc(inp.unit) + '"></td>' +
            '<td><input type="checkbox" data-inped="optional" data-sid="' + st.id + '" data-iid="' + inp.id + '"' + (inp.optional ? ' checked' : '') + '></td>' +
            '<td><button class="small danger" data-act="delInput" data-sid="' + st.id + '" data-iid="' + inp.id + '">✕</button></td></tr>';
        }).join('') + '</table><button class="small" data-act="addInput" data-sid="' + st.id + '" style="margin-top:6px">＋ 添加输入项</button></div></div></div>';
      h += '<div class="ins"><button class="insbtn" data-act="insert" data-at="' + (i + 1) + '">＋ 插入步骤</button></div>';
    });
    app.innerHTML = h;
  }
  function stepById(id) { for (var i = 0; i < S.steps.length; i++) if (S.steps[i].id === id) return i; return -1; }
  function redetect(st) {
    var old = {}; st.inputs.forEach(function (x) { old[x.label] = x; });
    st.inputs = SopParser.detectInputs(st).map(function (x) { var o = old[x.label]; return o ? o : { id: uid(), label: x.label, type: x.type, unit: x.unit, optional: false }; });
  }
  function firstLine(t) { return (t || '').split('\n').filter(function (l) { return l.trim(); })[0] || ''; }

  /* ---------- 执行模式 ---------- */
  function renderRun() {
    var cur = curIndex(), n = S.steps.length;
    if (S.view == null || S.view > cur || S.view >= n) S.view = Math.min(cur, n - 1);
    var done = countDone(S);
    var side = '<div class="side" id="side"><div style="padding:10px 12px;border-bottom:1px solid #eef1f5"><b>进度 <span id="prog">' + done + ' / ' + n + '</span></b><div class="progress"><div style="width:' + (n ? done / n * 100 : 0) + '%"></div></div></div>' +
      S.steps.map(function (st, i) {
        var r = S.results[st.id], ok = r && r.confirmedAt, an = r && r.anomaly;
        var cls = 'it' + (i > cur ? ' locked' : '') + (i === cur ? ' cur' : '') + (i === S.view ? ' view' : '');
        return '<div class="' + cls + '" data-act="view" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><span class="t" lang="ja">' + esc(st.title) + '</span>' + (ok ? (an ? '<span class="badge warn">异常</span>' : '<span class="badge ok">✓</span>') : (i > cur ? '🔒' : '')) + '</div>';
      }).join('') + '</div>';
    var st = S.steps[S.view], r = res(st), confirmed = !!r.confirmedAt, ro = confirmed ? ' disabled' : '';
    var m = '<div class="card" id="stepCard" data-sid="' + st.id + '">';
    if (confirmed) m += '<div class="done-banner">✓ 已于 ' + esc(Fmt.local(r.confirmedAt)) + ' 确认' + (r.anomaly ? ' <span class="anom">（标记为异常）</span>' : '') + '</div>';
    m += '<div class="sec" lang="ja">' + esc(st.section) + '</div><div class="stitle"><span class="muted">步骤 ' + (S.view + 1) + ' / ' + n + '</span>　<span lang="ja">' + esc(st.title) + '</span></div>';
    if (st.context) m += '<div class="ctx" lang="ja">' + esc(st.context) + '</div>';
    m += '<div class="lbl">操作内容</div><div class="content" lang="ja">' + (renderContent(st.content) || '<span class="muted">（无）</span>') + '</div>';
    if (st.expected) m += '<div class="lbl">期待结果</div><div class="expected" lang="ja">' + renderContent(st.expected) + '</div>';
    if (st.inputs.length) {
      m += '<div class="lbl">记录（' + st.inputs.length + ' 项）</div><div class="inputs">';
      st.inputs.forEach(function (inp) {
        var v = r.values[inp.id];
        var lab = '<label for="in_' + inp.id + '" lang="ja">' + esc(inp.label) + (inp.optional ? ' <span class="muted">(可选)</span>' : ' <span class="req">*</span>') + '</label>';
        if (inp.type === 'check') {
          m += '<div class="f">' + lab + '<div><input type="checkbox" id="in_' + inp.id + '" data-inp="' + inp.id + '"' + (v === true ? ' checked' : '') + ro + '> 已完成</div><span></span></div>';
        } else {
          var extra = '';
          if (!confirmed && inp.type === 'time') extra = '<button class="small" data-act="now" data-iid="' + inp.id + '">现在</button>';
          if (!confirmed && inp.type === 'result') extra = '<span><button class="small" data-act="setv" data-iid="' + inp.id + '" data-v="OK">OK</button> <button class="small" data-act="setv" data-iid="' + inp.id + '" data-v="NG">NG</button></span>';
          m += '<div class="f">' + lab + '<div class="row" style="flex-wrap:nowrap"><input type="text" lang="ja" id="in_' + inp.id + '" data-inp="' + inp.id + '" value="' + esc(v == null ? '' : v) + '"' + ro + (isFilled(inp, v) ? ' class="filled"' : '') + '>' + (inp.unit ? '<span lang="ja">' + esc(inp.unit) + '</span>' : '') + '</div>' + extra + '</div>';
        }
      });
      m += '</div>';
    }
    m += '<div class="lbl">备注（可选）</div><textarea rows="2" data-note="1" lang="ja"' + ro + '>' + esc(r.note) + '</textarea>';
    m += '<div class="row" style="margin-top:8px"><label class="anom"><input type="checkbox" data-anom="1"' + (r.anomaly ? ' checked' : '') + ro + '> 标记为异常</label></div>';
    m += '<div class="actions">';
    if (!confirmed) {
      var miss = missing(st);
      m += '<button class="primary" id="btnConfirm" data-act="confirm"' + (miss.length ? ' disabled' : '') + '>确认 ✓</button><span class="muted" id="missHint">' + (miss.length ? '还需填写 ' + miss.length + ' 项：' + esc(miss.map(function (x) { return x.label; }).join('、')) : '可以确认') + '</span>';
    } else {
      if (S.view === cur - 1) m += '<button data-act="undo">撤销确认</button>';
      if (S.view < cur) m += '<button class="primary" data-act="view" data-i="' + cur + '">' + (cur < n ? '前往当前步骤 →' : '查看完成页 →') + '</button>';
    }
    m += '</div></div>';
    m += '<div class="row muted"><span>执行者：</span><input type="text" data-bind="executor" value="' + esc(S.executor) + '" style="width:180px"><span>开始：' + esc(Fmt.local(S.startedAt)) + '</span></div>';
    app.innerHTML = '<div class="grid">' + side + '<div>' + m + '</div></div>';
  }
  function refreshGate() {
    var btn = document.getElementById('btnConfirm'); if (!btn) return;
    var st = S.steps[S.view], miss = missing(st);
    btn.disabled = miss.length > 0;
    document.getElementById('missHint').textContent = miss.length ? '还需填写 ' + miss.length + ' 项：' + miss.map(function (x) { return x.label; }).join('、') : '可以确认';
    st.inputs.forEach(function (inp) { var el = document.getElementById('in_' + inp.id); if (el && el.type === 'text') el.classList.toggle('filled', isFilled(inp, res(st).values[inp.id])); });
  }

  /* ---------- 完成页 ---------- */
  function renderDone() {
    var R = RecordModel.build(S);
    var h = '<div class="card"><h2 style="margin-top:0">🎉 全部 ' + R.total + ' 个步骤已确认</h2><table class="sumtbl">' +
      '<tr><td>文档</td><td lang="ja">' + esc(R.docTitle) + '</td></tr><tr><td>开始</td><td>' + esc(R.startedAt) + '</td></tr><tr><td>结束</td><td>' + esc(R.finishedAt) + ' <span class="muted">(' + R.tz + ')</span></td></tr>' +
      '<tr><td>异常</td><td>' + (R.anomalies ? '<span class="anom">' + R.anomalies + ' 个</span>' : '0') + '</td></tr></table>' +
      '<div class="row" style="margin-top:12px"><label>执行者 <input type="text" data-bind="executor" value="' + esc(S.executor) + '" style="width:180px"></label>' +
      '<label>导出语言 <select data-bind="exportLang"><option value="ja"' + (S.exportLang !== 'zh' ? ' selected' : '') + '>日本語</option><option value="zh"' + (S.exportLang === 'zh' ? ' selected' : '') + '>中文</option></select></label>' +
      '<button class="primary" data-act="exportDocx" id="btnExportDocx">导出 Word 执行记录</button><button data-act="exportJson">导出 JSON 备份</button><button data-act="view" data-i="0">回看步骤</button></div></div>';
    h += '<div class="card"><table class="list"><tr><th>#</th><th>步骤</th><th>记录值</th><th>确认时间</th><th>备注</th><th>异常</th></tr>' + R.rows.map(function (r) {
      return '<tr' + (r.anomaly ? ' style="background:#fef2f2"' : '') + '><td>' + r.no + '</td><td lang="ja">' + esc(r.title) + '</td><td lang="ja">' + r.values.map(function (v) { return esc(v.label) + '：<b>' + esc(v.value) + '</b>' + esc(v.unit ? ' ' + v.unit : ''); }).join('<br>') + '</td><td>' + esc(r.confirmedAt) + '</td><td lang="ja">' + esc(r.note) + '</td><td>' + (r.anomaly ? '<span class="anom">⚠</span>' : '') + '</td></tr>';
    }).join('') + '</table></div>';
    app.innerHTML = h;
  }

  function render() {
    renderHeader();
    if (!S) renderHome();
    else if (S.phase === 'edit') renderEdit();
    else if (S.phase === 'done' && S.view === 'done') renderDone();
    else if (S.phase === 'done' && S.view == null) { S.view = 'done'; renderDone(); }
    else renderRun();
    window.scrollTo && window.scrollTo(0, 0);
  }

  /* ---------- 事件 ---------- */
  hdr.addEventListener('click', onClick);
  app.addEventListener('click', onClick);
  function onClick(e) {
    var cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.getAttribute('data-copy')); return; }
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    var act = b.getAttribute('data-act'), sid = b.getAttribute('data-sid'), iid = b.getAttribute('data-iid');
    var i = sid ? stepById(sid) : -1, st = i >= 0 ? S.steps[i] : null;
    switch (act) {
      case 'pick': document.getElementById('fileDocx').click(); break;
      case 'pickJson': document.getElementById('fileJson').click(); break;
      case 'resume': openSession(load(b.getAttribute('data-key'))); render(); break;
      case 'delSession': if (confirm('删除这个进度？此操作不可恢复。')) { SopStore.remove(b.getAttribute('data-key')); render(); } break;
      case 'home': S = null; render(); break;
      case 'exportJson': exportJson(); break;
      case 'exportDocx': exportDocx(); break;
      case 'reset':
        if (confirm('重置进度？所有已填写的值、备注、确认时间将被清除（编辑过的步骤保留）。')) { S.results = {}; S.startedAt = null; S.finishedAt = null; S.phase = 'edit'; S.view = 0; save(); render(); toast('进度已重置'); }
        break;
      // ---- 编辑 ----
      case 'start':
        if (!S.executor.trim()) { toast('请先填写执行者姓名'); document.querySelector('[data-bind=executor]').focus(); return; }
        if (!S.steps.length) { toast('没有步骤'); return; }
        S.phase = 'run'; S.startedAt = S.startedAt || nowIso(); S.view = curIndex(); save(); render(); break;
      case 'up': if (i > 0) { S.steps.splice(i - 1, 0, S.steps.splice(i, 1)[0]); save(); render(); } break;
      case 'down': if (i < S.steps.length - 1) { S.steps.splice(i + 1, 0, S.steps.splice(i, 1)[0]); save(); render(); } break;
      case 'merge':
        var nx = S.steps[i + 1]; if (!nx) break;
        st.content = [st.content, nx.content].filter(Boolean).join('\n');
        st.expected = [st.expected, nx.expected].filter(Boolean).join('\n');
        st.inputs = st.inputs.concat(nx.inputs); S.steps.splice(i + 1, 1); save(); render(); toast('已合并'); break;
      case 'split':
        var ta = document.querySelector('textarea[data-ed=content][data-sid="' + sid + '"]'), pos = ta ? ta.selectionStart : 0;
        var a = st.content.slice(0, pos).replace(/\s+$/, ''), c = st.content.slice(pos).replace(/^\s+/, '');
        if (!a || !c) { toast('请先在「操作内容」中把光标放到要拆分的位置'); break; }
        var ns = mkStep({ section: st.section, title: firstLine(c).replace(/`/g, '').slice(0, 80), content: c, expected: st.expected });
        st.content = a; st.expected = ''; /* 期待结果通常属于后半段的操作，拆分时移到新步骤 */ redetect(st); redetect(ns); S.steps.splice(i + 1, 0, ns); save(); render(); toast('已拆分为两步'); break;
      case 'redetect': redetect(st); save(); render(); toast('检测到 ' + st.inputs.length + ' 个输入项'); break;
      case 'delStep': if (confirm('删除步骤「' + st.title + '」？')) { S.steps.splice(i, 1); delete S.results[st.id]; save(); render(); } break;
      case 'insert': var at = +b.getAttribute('data-at'), prev = S.steps[at - 1]; S.steps.splice(at, 0, mkStep({ section: prev ? prev.section : '', title: '新步骤' })); save(); render(); break;
      case 'addInput': st.inputs.push({ id: uid(), label: '记录', type: 'text', unit: '', optional: false }); save(); render(); break;
      case 'delInput': st.inputs = st.inputs.filter(function (x) { return x.id !== iid; }); save(); render(); break;
      // ---- 执行 ----
      case 'view':
        var vi = +b.getAttribute('data-i'), cur = curIndex();
        if (vi > cur) { toast('请先确认前面的步骤'); break; }
        S.view = (vi >= S.steps.length) ? 'done' : vi; save(); render(); break;
      case 'now': case 'setv':
        var cst = S.steps[S.view], val = act === 'now' ? nowLocalShort() : b.getAttribute('data-v');
        res(cst).values[iid] = val; document.getElementById('in_' + iid).value = val; save(); refreshGate(); break;
      case 'confirm':
        var cs = S.steps[S.view]; if (missing(cs).length) return;
        res(cs).confirmedAt = nowIso();
        var ci = curIndex();
        if (ci >= S.steps.length) { S.phase = 'done'; S.finishedAt = nowIso(); S.view = 'done'; } else S.view = ci;
        save(); render(); toast('已确认'); break;
      case 'undo':
        var us = S.steps[S.view]; res(us).confirmedAt = null; S.finishedAt = null; if (S.phase === 'done') S.phase = 'run'; save(); render(); break;
    }
  }
  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute('data-bind')) { var k = t.getAttribute('data-bind'); S[k] = t.value; if (k === 'executor') localStorage.setItem('sopRunner:executor', t.value); save(); return; }
    if (!S) return;
    if (t.hasAttribute('data-ed')) { var st = S.steps[stepById(t.getAttribute('data-sid'))]; st[t.getAttribute('data-ed')] = t.value; save(); return; }
    if (t.hasAttribute('data-inped')) {
      var s2 = S.steps[stepById(t.getAttribute('data-sid'))], inp = s2.inputs.filter(function (x) { return x.id === t.getAttribute('data-iid'); })[0], f = t.getAttribute('data-inped');
      inp[f] = t.type === 'checkbox' ? t.checked : t.value; save(); return;
    }
    if (S.phase === 'edit' || typeof S.view !== 'number') return;
    var cs = S.steps[S.view], r = res(cs);
    if (r.confirmedAt) return;
    if (t.hasAttribute('data-inp')) { r.values[t.getAttribute('data-inp')] = t.type === 'checkbox' ? t.checked : t.value; save(); refreshGate(); }
    else if (t.hasAttribute('data-note')) { r.note = t.value; save(); }
    else if (t.hasAttribute('data-anom')) { r.anomaly = t.checked; save(); }
  }
  app.addEventListener('input', onInput);
  app.addEventListener('change', function (e) { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onInput(e); });
  // 防止把文件拖到页面其他位置时浏览器直接打开该文件
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); if (app.offsetParent !== null && !S && e.dataTransfer && e.dataTransfer.files[0] && !e.target.closest('#drop')) importDocx(e.dataTransfer.files[0]); });

  window.SopApp = { state: function () { return S; }, importFile: importDocx, render: render, home: function () { S = null; render(); } }; // 便于调试/测试
  SopStore.init().then(render);
})();
