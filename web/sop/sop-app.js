/* Synced from v1 sop-runner/src/app.js by tools/sync_from_v1.py (UI 文言は日本語化済み) — 手で編集しないこと。 */
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
  function missing(st) { var r = res(st); var m = st.inputs.filter(function (inp) { return !inp.optional && !isFilled(inp, r.values[inp.id]); }); return window.SopHooks && SopHooks.missingExtra ? m.concat(SopHooks.missingExtra(st, r)) : m; }

  /* ---------- 导入 ---------- */
  function importDocx(file) {
    if (!/\.docx$/i.test(file.name)) { toast('.docx ファイルを選択してください（旧形式の .doc は非対応です。Word で .docx として保存し直してください）'); return; }
    if (window.SopHooks && SopHooks.onImport) SopHooks.onImport(file);
    file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), hash = hashBytes(u8), key = PREFIX + file.name + ':' + hash;
      var old = load(key);
      if (old && confirm('この文書の保存済みの進捗があります（' + countDone(old) + '/' + old.steps.length + ' 手順確認済み）。\nOK = 前回の続きから再開／キャンセル = 再解析して上書き')) { openSession(old); save(); render(); toast('進捗を復元しました'); return; }
      return SopParser.parseDocx(buf).then(function (parsed) {
        if (!parsed.steps.length) { toast('手順を検出できませんでした'); return; }
        newSession(file.name, hash, parsed); if (window.SopHooks && SopHooks.afterParse) SopHooks.afterParse(S); render();
        toast('解析完了：' + S.steps.length + ' 手順');
      });
    }).catch(function (e) { console.error(e); alert('解析に失敗しました：' + e.message); });
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
    if (!S.executor.trim()) { toast('先に実施者名を入力してください'); var el = document.querySelector('[data-bind=executor]'); if (el) el.focus(); return; }
    (window.SopEvidence ? SopEvidence.exportDocx(S) : exportRecordDocx(S, 'simple-table', 'ja')).then(function (blob) { download(blob, baseName() + '_実施記録_' + stamp() + '.docx'); toast('Word の実施記録を出力しました'); });
  }
  function exportJson() {
    var blob = new Blob([JSON.stringify({ format: 'sop-runner-run', version: 1, exportedAt: nowIso(), state: S }, null, 2)], { type: 'application/json' });
    download(blob, baseName() + '_run_' + stamp() + '.json');
  }
  function importJson(file) {
    file.text().then(function (txt) {
      var o = JSON.parse(txt), st = o && o.format === 'sop-runner-run' ? o.state : null;
      if (!st || !Array.isArray(st.steps) || !st.docName) throw new Error('SOP Runner の JSON バックアップではありません');
      st.key = PREFIX + st.docName + ':' + st.hash;
      if (load(st.key) && !confirm('この文書の進捗が既にあります。バックアップで上書きしますか？')) return;
      openSession(st); save(); render(); toast('JSON から復元しました');
    }).catch(function (e) { alert('読み込みに失敗しました：' + e.message); });
  }

  /* ---------- 复制 ---------- */
  function copyText(t) {
    function fb() { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb); else fb();
    toast('コピーしました：' + (t.length > 40 ? t.slice(0, 40) + '…' : t));
  }

  /* ---------- 渲染：通用 ---------- */
  var reBlank = new RegExp(SopParser.BLANK_SRC, 'g');
  function renderInline(line) {
    return line.split(/(`[^`]*`)/).map(function (seg) {
      var m = seg.match(/^`([^`]*)`$/);
      if (m) return '<span class="icode" lang="en">' + esc(m[1]) + '<button data-copy="' + esc(m[1]) + '" title="コピー">⧉</button></span>';
      return esc(seg).replace(reBlank, function (b) { return '<span class="blank">' + b + '</span>'; });
    }).join('');
  }
  function renderContent(text) {
    return String(text || '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) {
      var m = l.trim().match(/^`([^`]*)`$/);
      if (m) { var c = SopParser.stripPrompt(m[1]); return '<div class="cmd"><code>' + esc(m[1]) + '</code><button data-copy="' + esc(c) + '" title="コピー（プロンプト $ / # は除去済み）">コピー</button></div>'; }
      return '<div class="ln">' + renderInline(l) + '</div>';
    }).join('');
  }

  function renderHeader() {
    var h = '<h1>📋 SOP Runner</h1><span class="badge off" title="このツールはネットワーク通信を一切行いません">オフライン</span>';
    if (S) {
      h += '<span class="doc" lang="ja">' + esc(S.docTitle) + '</span><span class="sp"></span>';
      if (S.phase !== 'edit') h += '<button data-act="exportJson">JSON 出力</button><button data-act="reset">進捗リセット</button>';
      h += '<button data-act="home">ホームへ戻る</button>';
    } else h += '<span class="sp"></span><span class="muted" style="color:#cbd5e1">Word 手順書 → 1 手順ずつ実行＋証跡記録</span>';
    hdr.innerHTML = h;
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    var ss = listSessions();
    var h = '<div class="drop" id="drop"><h2>Word 手順書（.docx）をここにドロップ</h2><p class="muted">または</p><button class="primary" data-act="pick">.docx ファイルを選択</button>' +
      '<input type="file" id="fileDocx" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="hidden">' +
      '<p class="muted" style="margin-top:14px">ファイルはこの PC のブラウザ内だけで解析され、外部へは送信されません。進捗はアプリの data フォルダ（JSON）に自動保存されます（ブラウザにも予備保存）。</p></div>';
    h += '<div class="card" style="margin-top:14px"><div class="row" style="justify-content:space-between"><b>保存済みの進捗</b><span><button data-act="pickJson">JSON バックアップを読み込む</button><input type="file" id="fileJson" accept=".json,application/json" class="hidden"></span></div>';
    if (!ss.length) h += '<p class="muted">まだありません。</p>';
    else h += '<table class="list" id="sessions"><tr><th>文書</th><th>状態</th><th>進捗</th><th>最終更新</th><th></th></tr>' + ss.map(function (s) {
      var d = countDone(s), ph = { edit: '編集中', run: '実行中', done: '完了' }[s.phase] || s.phase;
      return '<tr><td lang="ja">' + esc(s.docTitle) + '<div class="muted">' + esc(s.docName) + '</div></td><td><span class="badge ' + (s.phase === 'done' ? 'ok' : '') + '">' + ph + '</span></td><td>' + d + ' / ' + s.steps.length + '</td><td>' + esc(Fmt.local(s.updatedAt)) + '</td><td style="white-space:nowrap"><button class="primary small" data-act="resume" data-key="' + esc(s.key) + '">再開</button> <button class="small danger" data-act="delSession" data-key="' + esc(s.key) + '">削除</button></td></tr>';
    }).join('') + '</table>';
    h += '</div>';
    h += '<div class="card muted"><b>検出ルール（概要）：</b>見出し → 章・節／番号付き・箇条書きリストの各項目 → 1 手順／空セルや「確認結果」列を含む表 → 1 行 = 1 手順／「期待結果・確認内容・expected」 → 期待結果／等幅フォントまたは $ / # で始まる行 → コマンド（コピーボタン付き）／＿＿＿ / （　） / 【　】 / □ / 「確認結果：」 / 「記入」 / 空セル → 入力欄。読み込み後に編集モードで修正できます。</div>';
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
  var TYPES = { text: 'テキスト', time: '日時', result: '結果(OK/NG)', check: 'チェック' };
  function renderEdit() {
    var nIn = S.steps.reduce(function (a, s) { return a + s.inputs.length; }, 0);
    var h = '<div class="card"><div class="row" style="justify-content:space-between"><div><b>編集モード</b> <span class="muted">全 <b id="stepCount">' + S.steps.length + '</b> 手順・入力項目 <b id="inputCount">' + nIn + '</b> 件。分割の誤りを修正してから「実行開始」をクリックしてください。</span></div>' +
      '<div class="row"><label>実施者 <input type="text" data-bind="executor" value="' + esc(S.executor) + '" placeholder="氏名（必須）" style="width:160px"></label><button class="primary" data-act="start" id="btnStart">実行開始 ▶</button></div></div>' +
      '<p class="muted" style="margin:6px 0 0">ヒント：作業内容で行全体を `バッククォート` で囲むとコマンド（コピーボタン付き）、行内の `xxx` はインラインコードになります。テキスト修正後は「入力を再検出」をクリックしてください。</p></div>';
    if (window.SopHooks && SopHooks.editHeader) h += SopHooks.editHeader();
    h += '<div class="ins"><button class="insbtn" data-act="insert" data-at="0">＋ 先頭に手順を挿入</button></div>';
    S.steps.forEach(function (st, i) {
      h += '<div class="ed" data-sid="' + st.id + '"><div class="hd"><span class="num">#' + (i + 1) + '</span>' +
        '<input type="text" data-ed="title" data-sid="' + st.id + '" value="' + esc(st.title) + '" lang="ja" style="flex:1;min-width:200px">' +
        '<button class="small" data-act="up" data-sid="' + st.id + '" ' + (i === 0 ? 'disabled' : '') + ' title="上へ移動">↑</button>' +
        '<button class="small" data-act="down" data-sid="' + st.id + '" ' + (i === S.steps.length - 1 ? 'disabled' : '') + ' title="下へ移動">↓</button>' +
        '<button class="small" data-act="merge" data-sid="' + st.id + '" ' + (i === S.steps.length - 1 ? 'disabled' : '') + ' title="次の手順と結合">結合↓</button>' +
        '<button class="small" data-act="split" data-sid="' + st.id + '" title="「作業内容」のカーソル位置で 2 つに分割">カーソル位置で分割</button>' +
        '<button class="small" data-act="redetect" data-sid="' + st.id + '">入力を再検出</button>' +
        '<button class="small danger" data-act="delStep" data-sid="' + st.id + '">削除</button></div>' +
        '<div class="bd"><div class="full"><div class="lbl">章・節</div><input type="text" data-ed="section" data-sid="' + st.id + '" value="' + esc(st.section) + '" lang="ja"></div>' +
        '<div><div class="lbl">作業内容</div><textarea class="mono" rows="' + Math.min(10, Math.max(3, st.content.split('\n').length + 1)) + '" data-ed="content" data-sid="' + st.id + '" lang="ja">' + esc(st.content) + '</textarea></div>' +
        '<div><div class="lbl">期待結果</div><textarea rows="3" data-ed="expected" data-sid="' + st.id + '" lang="ja">' + esc(st.expected) + '</textarea>' +
        (st.context ? '<div class="lbl">章・節の説明（参照のみ）</div><textarea rows="2" data-ed="context" data-sid="' + st.id + '" lang="ja">' + esc(st.context) + '</textarea>' : '') + '</div>' +
        '<div class="full"><div class="lbl">入力項目（' + st.inputs.length + '）</div><table><tr><th style="width:45%">ラベル</th><th>種類</th><th>単位</th><th>任意</th><th></th></tr>' +
        st.inputs.map(function (inp) {
          return '<tr class="inprow"><td><input type="text" data-inped="label" data-sid="' + st.id + '" data-iid="' + inp.id + '" value="' + esc(inp.label) + '" lang="ja"></td><td><select data-inped="type" data-sid="' + st.id + '" data-iid="' + inp.id + '">' +
            Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (inp.type === k ? ' selected' : '') + '>' + TYPES[k] + '</option>'; }).join('') + '</select></td>' +
            '<td><input type="text" style="width:70px" data-inped="unit" data-sid="' + st.id + '" data-iid="' + inp.id + '" value="' + esc(inp.unit) + '"></td>' +
            '<td><input type="checkbox" data-inped="optional" data-sid="' + st.id + '" data-iid="' + inp.id + '"' + (inp.optional ? ' checked' : '') + '></td>' +
            '<td><button class="small danger" data-act="delInput" data-sid="' + st.id + '" data-iid="' + inp.id + '">✕</button></td></tr>';
        }).join('') + '</table><button class="small" data-act="addInput" data-sid="' + st.id + '" style="margin-top:6px">＋ 入力項目を追加</button></div>' + (window.SopHooks && SopHooks.editExtra ? SopHooks.editExtra(st) : '') + '</div></div>';
      h += '<div class="ins"><button class="insbtn" data-act="insert" data-at="' + (i + 1) + '">＋ 手順を挿入</button></div>';
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
    var side = '<div class="side" id="side"><div style="padding:10px 12px;border-bottom:1px solid #eef1f5"><b>進捗 <span id="prog">' + done + ' / ' + n + '</span></b><div class="progress"><div style="width:' + (n ? done / n * 100 : 0) + '%"></div></div></div>' +
      S.steps.map(function (st, i) {
        var r = S.results[st.id], ok = r && r.confirmedAt, an = r && r.anomaly;
        var cls = 'it' + (i > cur ? ' locked' : '') + (i === cur ? ' cur' : '') + (i === S.view ? ' view' : '');
        return '<div class="' + cls + '" data-act="view" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><span class="t" lang="ja">' + esc(st.title) + '</span>' + (ok ? (an ? '<span class="badge warn">異常</span>' : '<span class="badge ok">✓</span>') : (i > cur ? '🔒' : '')) + '</div>';
      }).join('') + '</div>';
    var st = S.steps[S.view], r = res(st), confirmed = !!r.confirmedAt, ro = confirmed ? ' disabled' : '';
    var m = '<div class="card" id="stepCard" data-sid="' + st.id + '">';
    if (confirmed) m += '<div class="done-banner">✓ ' + esc(Fmt.local(r.confirmedAt)) + ' に確認済み' + (r.anomaly ? ' <span class="anom">（異常あり）</span>' : '') + '</div>';
    m += '<div class="sec" lang="ja">' + esc(st.section) + '</div><div class="stitle"><span class="muted">手順 ' + (S.view + 1) + ' / ' + n + '</span>　<span lang="ja">' + esc(st.title) + '</span></div>';
    if (st.context) m += '<div class="ctx" lang="ja">' + esc(st.context) + '</div>';
    m += '<div class="lbl">作業内容</div><div class="content" lang="ja">' + (renderContent(st.content) || '<span class="muted">（なし）</span>') + '</div>';
    if (st.expected) m += '<div class="lbl">期待結果</div><div class="expected" lang="ja">' + renderContent(st.expected) + '</div>';
    if (st.inputs.length) {
      m += '<div class="lbl">記録（' + st.inputs.length + ' 項目）</div><div class="inputs">';
      st.inputs.forEach(function (inp) {
        var v = r.values[inp.id];
        var lab = '<label for="in_' + inp.id + '" lang="ja">' + esc(inp.label) + (inp.optional ? ' <span class="muted">(任意)</span>' : ' <span class="req">*</span>') + '</label>';
        if (inp.type === 'check') {
          m += '<div class="f">' + lab + '<div><input type="checkbox" id="in_' + inp.id + '" data-inp="' + inp.id + '"' + (v === true ? ' checked' : '') + ro + '> 完了</div><span></span></div>';
        } else {
          var extra = '';
          if (!confirmed && inp.type === 'time') extra = '<button class="small" data-act="now" data-iid="' + inp.id + '">現在時刻</button>';
          if (!confirmed && inp.type === 'result') extra = '<span><button class="small" data-act="setv" data-iid="' + inp.id + '" data-v="OK">OK</button> <button class="small" data-act="setv" data-iid="' + inp.id + '" data-v="NG">NG</button></span>';
          m += '<div class="f">' + lab + '<div class="row" style="flex-wrap:nowrap"><input type="text" lang="ja" id="in_' + inp.id + '" data-inp="' + inp.id + '" value="' + esc(v == null ? '' : v) + '"' + ro + (isFilled(inp, v) ? ' class="filled"' : '') + '>' + (inp.unit ? '<span lang="ja">' + esc(inp.unit) + '</span>' : '') + '</div>' + extra + '</div>';
        }
      });
      m += '</div>';
    }
    if (window.SopHooks && SopHooks.runExtra) m += SopHooks.runExtra(st, r, confirmed);
    m += '<div class="lbl">備考（任意）</div><textarea rows="2" data-note="1" lang="ja"' + ro + '>' + esc(r.note) + '</textarea>';
    m += '<div class="row" style="margin-top:8px"><label class="anom"><input type="checkbox" data-anom="1"' + (r.anomaly ? ' checked' : '') + ro + '> 異常としてマーク</label></div>';
    m += '<div class="actions">';
    if (!confirmed) {
      var miss = missing(st);
      m += '<button class="primary" id="btnConfirm" data-act="confirm"' + (miss.length ? ' disabled' : '') + '>確認 ✓</button><span class="muted" id="missHint">' + (miss.length ? '未入力 ' + miss.length + ' 項目：' + esc(miss.map(function (x) { return x.label; }).join('、')) : '確認できます') + '</span>';
    } else {
      if (S.view === cur - 1) m += '<button data-act="undo">確認を取り消す</button>';
      if (S.view < cur) m += '<button class="primary" data-act="view" data-i="' + cur + '">' + (cur < n ? '現在の手順へ →' : '完了ページへ →') + '</button>';
    }
    m += '</div></div>';
    m += '<div class="row muted"><span>実施者：</span><input type="text" data-bind="executor" value="' + esc(S.executor) + '" style="width:180px"><span>開始：' + esc(Fmt.local(S.startedAt)) + '</span></div>';
    app.innerHTML = '<div class="grid">' + side + '<div>' + m + '</div></div>';
  }
  function refreshGate() {
    var btn = document.getElementById('btnConfirm'); if (!btn) return;
    var st = S.steps[S.view], miss = missing(st);
    btn.disabled = miss.length > 0;
    document.getElementById('missHint').textContent = miss.length ? '未入力 ' + miss.length + ' 項目：' + miss.map(function (x) { return x.label; }).join('、') : '確認できます';
    st.inputs.forEach(function (inp) { var el = document.getElementById('in_' + inp.id); if (el && el.type === 'text') el.classList.toggle('filled', isFilled(inp, res(st).values[inp.id])); });
  }

  /* ---------- 完成页 ---------- */
  function renderDone() {
    var R = RecordModel.build(S);
    var h = '<div class="card"><h2 style="margin-top:0">🎉 全 ' + R.total + ' 手順の確認が完了しました</h2><table class="sumtbl">' +
      '<tr><td>文書</td><td lang="ja">' + esc(R.docTitle) + '</td></tr><tr><td>開始</td><td>' + esc(R.startedAt) + '</td></tr><tr><td>終了</td><td>' + esc(R.finishedAt) + ' <span class="muted">(' + R.tz + ')</span></td></tr>' +
      '<tr><td>異常</td><td>' + (R.anomalies ? '<span class="anom">' + R.anomalies + ' 件</span>' : '0') + '</td></tr></table>' +
      '<div class="row" style="margin-top:12px"><label>実施者 <input type="text" data-bind="executor" value="' + esc(S.executor) + '" style="width:180px"></label>' +
      '<button class="primary" data-act="exportDocx" id="btnExportDocx">Word 実施記録を出力</button><button data-act="exportJson">JSON バックアップを出力</button><button data-act="view" data-i="0">手順を見返す</button></div></div>';
    h += '<div class="card"><table class="list"><tr><th>#</th><th>手順</th><th>記録値</th><th>確認日時</th><th>備考</th><th>異常</th></tr>' + R.rows.map(function (r) {
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
      case 'delSession': if (confirm('この進捗を削除しますか？元に戻せません。')) { SopStore.remove(b.getAttribute('data-key')); render(); } break;
      case 'home': S = null; render(); break;
      case 'exportJson': exportJson(); break;
      case 'exportDocx': exportDocx(); break;
      case 'reset':
        if (confirm('進捗をリセットしますか？入力値・備考・確認日時がすべて消去されます（編集した手順は残ります）。')) { S.results = {}; S.startedAt = null; S.finishedAt = null; S.phase = 'edit'; S.view = 0; save(); render(); toast('進捗をリセットしました'); }
        break;
      // ---- 编辑 ----
      case 'start':
        if (!S.executor.trim()) { toast('先に実施者名を入力してください'); document.querySelector('[data-bind=executor]').focus(); return; }
        if (!S.steps.length) { toast('手順がありません'); return; }
        S.phase = 'run'; S.startedAt = S.startedAt || nowIso(); S.view = curIndex(); save(); render(); break;
      case 'up': if (i > 0) { S.steps.splice(i - 1, 0, S.steps.splice(i, 1)[0]); save(); render(); } break;
      case 'down': if (i < S.steps.length - 1) { S.steps.splice(i + 1, 0, S.steps.splice(i, 1)[0]); save(); render(); } break;
      case 'merge':
        var nx = S.steps[i + 1]; if (!nx) break;
        st.content = [st.content, nx.content].filter(Boolean).join('\n');
        st.expected = [st.expected, nx.expected].filter(Boolean).join('\n');
        st.inputs = st.inputs.concat(nx.inputs); st.evidence = (st.evidence || []).concat(nx.evidence || []); S.steps.splice(i + 1, 1); save(); render(); toast('結合しました'); break;
      case 'split':
        var ta = document.querySelector('textarea[data-ed=content][data-sid="' + sid + '"]'), pos = ta ? ta.selectionStart : 0;
        var a = st.content.slice(0, pos).replace(/\s+$/, ''), c = st.content.slice(pos).replace(/^\s+/, '');
        if (!a || !c) { toast('先に「作業内容」で分割したい位置にカーソルを置いてください'); break; }
        var ns = mkStep({ section: st.section, title: firstLine(c).replace(/`/g, '').slice(0, 80), content: c, expected: st.expected });
        st.content = a; st.expected = ''; /* 期待结果通常属于后半段的操作，拆分时移到新步骤 */ redetect(st); redetect(ns); S.steps.splice(i + 1, 0, ns); save(); render(); toast('2 つの手順に分割しました'); break;
      case 'redetect': redetect(st); save(); render(); toast('入力項目を ' + st.inputs.length + ' 件検出しました'); break;
      case 'delStep': if (confirm('手順「' + st.title + '」を削除しますか？')) { S.steps.splice(i, 1); delete S.results[st.id]; save(); render(); } break;
      case 'insert': var at = +b.getAttribute('data-at'), prev = S.steps[at - 1]; S.steps.splice(at, 0, mkStep({ section: prev ? prev.section : '', title: '新しい手順' })); save(); render(); break;
      case 'addInput': st.inputs.push({ id: uid(), label: '記録', type: 'text', unit: '', optional: false }); save(); render(); break;
      case 'delInput': st.inputs = st.inputs.filter(function (x) { return x.id !== iid; }); save(); render(); break;
      // ---- 执行 ----
      case 'view':
        var vi = +b.getAttribute('data-i'), cur = curIndex();
        if (vi > cur) { toast('先に前の手順を確認してください'); break; }
        S.view = (vi >= S.steps.length) ? 'done' : vi; save(); render(); break;
      case 'now': case 'setv':
        var cst = S.steps[S.view], val = act === 'now' ? nowLocalShort() : b.getAttribute('data-v');
        res(cst).values[iid] = val; document.getElementById('in_' + iid).value = val; save(); refreshGate(); break;
      case 'confirm':
        var cs = S.steps[S.view]; if (missing(cs).length) return;
        res(cs).confirmedAt = nowIso();
        var ci = curIndex();
        if (ci >= S.steps.length) { S.phase = 'done'; S.finishedAt = nowIso(); S.view = 'done'; } else S.view = ci;
        save(); render(); toast('確認しました'); break;
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

  window.SopApp = { state: function () { return S; }, importFile: importDocx, render: render, save: save, refreshGate: refreshGate, home: function () { S = null; render(); } }; // 便于调试/测试
  SopStore.init().then(render);
})();
