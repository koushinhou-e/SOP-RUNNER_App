/* 手順修正（手順実行モジュールの v2 拡張）。
 * - 「手順修正」タブ：手順書（.docx）または手順テンプレートを開き、手順実行の取り込み後と同じ編集画面で修正して、新しい手順テンプレートとしてライブラリに保存
 * - 各手順に「画像を挿入」：期待される画面を参考画像として添付し、手順実行時に表示（証跡画像＝実行時に求める画像 とは別）
 * - 期待結果にパラメータシートのキーを {{キー}} で挿入：手順実行時は対象サーバの値で自動表示（resolveText）
 * - キーを設定した入力項目は、手順実行中にパラメータシートの値と自動で照合して表示
 * sop-app.js（v1 から同期）へのフックは tools/sync_from_v1.py のパッチで挿入している。 */
(function () {
  'use strict';
  var H = window.SopHooks = window.SopHooks || {};
  var PS = null;                    // パラメータシート（ライブラリ）
  var PLACE = /\{\{\s*([\w.-]+)\s*\}\}/g;
  function S() { return window.SopApp && SopApp.state(); }
  function author() { return window.SopApp && SopApp.mode() === 'author'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(m) { if (window.toast) toast(m); }
  function stepById(id) { var s = S(); for (var i = 0; s && i < s.steps.length; i++) if (s.steps[i].id === id) return s.steps[i]; return null; }
  function imgUrl(id) { return Api.dl('/api/sop/images/' + encodeURIComponent(id)); }
  function keep(fn) { var y = window.scrollY; fn(); window.scrollTo(0, y); }       // 再描画してもスクロール位置を保つ
  function loadPS() { return Api.get('/api/library?type=param_sheet').then(function (r) { PS = r.items; }).catch(function () { PS = PS || []; }); }

  /* ---------- パラメータシートの参照（手順に紐付く 1 サーバ分） ---------- */
  function bound(s) {
    var ref = (s && s.paramRef) || {}, p = (PS || []).filter(function (x) { return x.id === ref.id; })[0];
    if (!p || !ref.server) return null;
    var map = {};
    ((p.parsed || {}).params || []).forEach(function (x) { map[x.key] = { label: x.label, value: (x.values || {})[ref.server] || '' }; });
    return { sheet: p, server: ref.server, map: map };
  }
  function resolveText(text, plain) {
    var s = S();
    if (!text || String(text).indexOf('{{') < 0 || !s) return text;
    var b = bound(s);
    return String(text).replace(PLACE, function (m, k) {
      if (!b) return m;                                           // パラメータ未選択：{{キー}} のまま表示
      var e = b.map[k];
      if (!e) return plain ? m : '⟨' + k + '：パラメータシートにありません⟩';
      var v = String(e.value).replace(/`/g, "'");
      if (!v) return plain ? '' : '⟨' + k + '：値なし⟩';
      return plain ? v : '`' + v + '`';                          // 実行画面ではインライン表示（コピーボタン付き）
    });
  }
  function pickerHtml(s) {
    var ref = s.paramRef || {}, sheets = PS || [], cur = sheets.filter(function (p) { return p.id === ref.id; })[0], servers = cur ? (cur.parsed || {}).servers || [] : [];
    return '<div class="au-picker"><b>パラメータ参照</b> ' +
      '<label>パラメータシート <select data-au="ps"><option value="">（選択してください）</option>' + sheets.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === ref.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label> ' +
      '<label>サーバ <select data-au="srv"' + (cur ? '' : ' disabled') + '>' + servers.map(function (v) { return '<option' + (v === ref.server ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select></label>' +
      '<span class="muted">期待結果の <code>{{キー}}</code> を、選んだサーバの値に置き換えて表示します</span></div>';
  }
  function keyOptions(s) {
    var b = bound(s), out = [], seen = {};
    function add(p) { ((p.parsed || {}).params || []).forEach(function (x) { if (!seen[x.key]) { seen[x.key] = 1; out.push({ key: x.key, label: x.label, value: b && b.sheet.id === p.id ? (x.values || {})[b.server] || '' : '' }); } }); }
    if (b) add(b.sheet); else (PS || []).forEach(add);
    return out;
  }

  /* ---------- 画像のアップロード ---------- */
  function upload(file) {
    return fetch('/api/sop/images', { method: 'POST', headers: { 'X-Token': Api.token, 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (meta) {
        meta.name = file.name && file.name !== 'image.png' ? file.name : ('clipboard-' + new Date().toLocaleString('sv-SE').replace(/\D/g, '').slice(0, 14) + '.' + meta.ext);
        meta.caption = '';
        return meta;
      });
  }
  function addImages(st, files) {
    var list = [].filter.call(files || [], function (f) { return /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name || ''); });
    if (!list.length) { say('PNG または JPEG の画像を指定してください'); return Promise.resolve(); }
    return list.reduce(function (p, f) { return p.then(function () { return upload(f).then(function (m) { (st.refImages = st.refImages || []).push(m); }); }); }, Promise.resolve())
      .then(function () { redrawRef(st); say('参考画像を挿入しました'); })
      .catch(function (e) { say('画像を保存できませんでした：' + e.message); });
  }

  /* ---------- 編集画面（手順修正） ---------- */
  function refEditHtml(st) {
    var imgs = st.refImages || [];
    return '<div class="full au-ref" data-sid="' + st.id + '" tabindex="0"><div class="lbl">参考画像（期待される画面）（' + imgs.length + '）<span class="muted"> 手順実行時に、この手順の画面へ表示します</span></div>' +
      '<div class="au-thumbs">' + imgs.map(function (m, i) {
        return '<figure class="au-th"><img src="' + imgUrl(m.id) + '" alt="' + esc(m.name) + '" data-ev="zoom" data-img="' + m.id + '" title="クリックで拡大：' + esc(m.name) + '（' + m.w + '×' + m.h + '）">' +
          '<input type="text" class="au-cap" data-au="cap" data-sid="' + st.id + '" data-i="' + i + '" value="' + esc(m.caption || '') + '" placeholder="説明（任意）" lang="ja">' +
          '<button class="small danger" data-au="rmimg" data-sid="' + st.id + '" data-i="' + i + '" title="この画像を外す">✕</button></figure>';
      }).join('') + '</div>' +
      '<div class="au-drop"><button class="small primary" data-au="insimg" data-sid="' + st.id + '">🖼 画像を挿入</button> <span class="muted">ここへドロップ、またはここをクリックして Ctrl+V で貼り付け（PNG / JPEG）</span>' +
      '<input type="file" class="hidden" accept="image/png,image/jpeg" multiple data-aufile="' + st.id + '"></div></div>';
  }
  function redrawRef(st) {
    var el = document.querySelector('.au-ref[data-sid="' + st.id + '"]');
    if (!el) return;
    var tmp = document.createElement('div'); tmp.innerHTML = refEditHtml(st);
    el.parentNode.replaceChild(tmp.firstChild, el);
  }
  function prevHtml(st) {
    var s = S(), b = bound(s), t = st.expected || '';
    if (!/\{\{/.test(t)) return '<span class="muted">期待結果に {{キー}} が入っていません。</span>';
    if (!b) return '<span class="muted">パラメータシートとサーバを選ぶと、ここに展開後の期待結果を表示します。</span>';
    return '<b>プレビュー（' + esc(b.server) + '）：</b><span lang="ja">' + esc(resolveText(t, true)).replace(/\n/g, '<br>') + '</span>';
  }
  function paramRefHtml(st) {
    var s = S(), opts = keyOptions(s);
    return '<div class="full au-pref"><div class="lbl">期待結果にパラメータシートの値を挿入</div><div class="row">' +
      '<select data-au="key" data-sid="' + st.id + '" lang="ja"><option value="">（キーを選択）</option>' + opts.map(function (o) { return '<option value="' + esc(o.key) + '">' + esc(o.label) + '（' + esc(o.key) + '）' + (o.value ? '：' + esc(o.value) : '') + '</option>'; }).join('') + '</select>' +
      '<button class="small" data-au="insert" data-sid="' + st.id + '">期待結果に挿入</button><span class="muted">カーソル位置に <code>{{キー}}</code> が入ります。手順実行時は対象サーバの値に自動で置き換わります。</span></div>' +
      '<div class="au-prev" data-aupv="' + st.id + '">' + prevHtml(st) + '</div></div>';
  }
  function authorBar(s) {
    return '<div class="card au-bar"><div class="row spread"><div><b>手順テンプレートとして保存</b><div class="muted">修正した手順（入力項目・キー・証跡画像の要求・参考画像・期待結果のパラメータ参照）を、テンプレートライブラリの手順書として保存します。保存すると「手順実行」で開けます。</div></div></div>' +
      '<div class="row" style="margin-top:8px"><label class="nowrap">テンプレート名 <input type="text" id="auName" value="' + esc(s.tplName || s.docTitle || '') + '" lang="ja" style="width:300px"></label>' +
      '<button class="primary" data-au="save-new">新しいテンプレートとして保存</button>' + (s.tplId ? '<button data-au="save-over">「' + esc(s.tplName || '') + '」を上書き保存</button>' : '') +
      '<span class="muted" id="auStat"></span></div></div>';
  }
  var prevHeader = H.editHeader, prevExtra = H.editExtra, prevRun = H.runExtra, prevParse = H.afterParse;
  H.editHeader = function () {
    var s = S(), h = prevHeader ? prevHeader() : '';
    if (!PS) loadPS().then(function () { if (S() === s) keep(function () { SopApp.render(); }); });
    return (author() ? authorBar(s) : '') + '<div class="card" id="auPicker">' + pickerHtml(s) + '</div>' + h;
  };
  H.editExtra = function (st) { var h = prevExtra ? prevExtra(st) : ''; return author() ? h + refEditHtml(st) + paramRefHtml(st) : h; };
  H.resolveText = resolveText;

  /* ---------- 実行画面：参考画像、パラメータシートとの照合 ---------- */
  function refViewHtml(st) {
    var imgs = st.refImages || [];
    if (!imgs.length) return '';
    return '<div class="lbl">参考画像（期待される画面）</div><div class="au-view">' + imgs.map(function (m) {
      return '<figure class="au-vf"><img src="' + imgUrl(m.id) + '" alt="' + esc(m.name) + '" data-ev="zoom" data-img="' + m.id + '" title="クリックで拡大">' + (m.caption ? '<figcaption lang="ja">' + esc(m.caption) + '</figcaption>' : '') + '</figure>';
    }).join('') + '</div>';
  }
  function cmpRows(st, vals) {
    var b = bound(S());
    return (st.inputs || []).filter(function (i) { return String(i.key || '').trim(); }).map(function (inp) {
      var e = b && b.map[String(inp.key).trim()], v = vals[inp.id] == null ? '' : String(vals[inp.id]), j = e ? Rules.judge(e.value, v) : 'no_expected';
      return '<tr data-aucmp="' + inp.id + '"><td lang="ja">' + esc(inp.label) + '<div class="muted mono">' + esc(inp.key) + '</div></td><td class="mono" lang="ja">' + (e ? esc(e.value) : '<span class="muted">—</span>') + '</td>' +
        '<td class="mono" lang="ja" data-auval>' + esc(v) + '</td><td><span class="pill ' + j + '">' + esc(Rules.STATUS_LABEL[j]) + '</span></td></tr>';
    }).join('');
  }
  function cmpHtml(st, r) {
    var s = S(), rows = cmpRows(st, (r && r.values) || {}), b = bound(s);
    if (!rows && !/\{\{/.test(st.expected || '')) return '';
    return '<div class="lbl">パラメータシートとの対照</div><div class="au-cmpbox" data-ausid="' + st.id + '">' + pickerHtml(s) +
      (b ? '' : '<div class="rp-note">パラメータシートとサーバを選ぶと、期待結果の {{キー}} と入力値の照合が表示されます。</div>') +
      (rows ? '<table class="t au-cmp"><tr><th>項目 / キー</th><th>設定値（' + esc(b ? b.server : '未選択') + '）</th><th>入力値</th><th>照合</th></tr>' + rows + '</table>' : '') + '</div>';
  }
  H.runExtra = function (st, r, confirmed) { var h = prevRun ? prevRun(st, r, confirmed) : ''; return refViewHtml(st) + cmpHtml(st, r) + h; };
  H.afterParse = function (s) {
    if (prevParse) prevParse(s);
    applyJob(s);
  };
  function applyJob(s) {          // 作業から手順書を開いたときは、その作業のパラメータシート・サーバを既定にする
    var jid = window.BA && BA.G && BA.G.procJob;
    if (!jid || s.paramRef) return;
    Promise.all([Api.get('/api/jobs/' + encodeURIComponent(jid)), PS ? 0 : loadPS()]).then(function (r) {
      var j = r[0].job;
      if (S() === s && !s.paramRef && j.param_sheet_id && j.server) { s.paramRef = { id: j.param_sheet_id, server: j.server }; SopApp.save(); keep(function () { SopApp.render(); }); }
    }).catch(function () { });
  }

  /* ---------- イベント ---------- */
  function setup() {
    var app = document.getElementById('sop-app');
    app.addEventListener('click', function (e) {
      var b = e.target.closest('[data-au]'); if (!b) return;
      var act = b.getAttribute('data-au'), st = b.getAttribute('data-sid') ? stepById(b.getAttribute('data-sid')) : null, s = S();
      if (act === 'insimg') { e.preventDefault(); var f = app.querySelector('input[data-aufile="' + st.id + '"]'); if (f) f.click(); }
      else if (act === 'rmimg') { st.refImages.splice(+b.getAttribute('data-i'), 1); redrawRef(st); }
      else if (act === 'insert') {
        var sel = app.querySelector('select[data-au=key][data-sid="' + st.id + '"]'), ta = app.querySelector('textarea[data-ed=expected][data-sid="' + st.id + '"]');
        if (!sel || !sel.value || !ta) { say('挿入するキーを選択してください'); return; }
        var pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart, tok = '{{' + sel.value + '}}';
        ta.value = ta.value.slice(0, pos) + tok + ta.value.slice(ta.selectionEnd == null ? pos : ta.selectionEnd);
        ta.focus(); ta.setSelectionRange(pos + tok.length, pos + tok.length);
        ta.dispatchEvent(new Event('input', { bubbles: true }));         // sop-app 側で st.expected に反映
      }
      else if (act === 'save-new' || act === 'save-over') saveTemplate(act === 'save-over');
      else if (act === 'openlib') openForEdit(b.getAttribute('data-id'));
      else if (act === 'pickdocx') { var fd = document.getElementById('auDocx'); if (fd) fd.click(); }
    });
    app.addEventListener('change', function (e) {
      var t = e.target, au = t.getAttribute && t.getAttribute('data-au'), s = S();
      if (t.hasAttribute && t.hasAttribute('data-aufile')) { var st = stepById(t.getAttribute('data-aufile')); if (st) addImages(st, t.files).then(function () { t.value = ''; }); return; }
      if (t.id === 'auDocx') { if (t.files[0]) SopApp.importFile(t.files[0]); t.value = ''; return; }
      if (au === 'ps' || au === 'srv') {
        var ref = s.paramRef = s.paramRef || {};
        if (au === 'ps') { var p = (PS || []).filter(function (x) { return x.id === t.value; })[0]; s.paramRef = p ? { id: p.id, server: ((p.parsed || {}).servers || [])[0] || '' } : null; }
        else ref.server = t.value;
        SopApp.save(); keep(function () { SopApp.render(); });
      }
    });
    app.addEventListener('input', function (e) {
      var t = e.target, au = t.getAttribute && t.getAttribute('data-au');
      if (au === 'cap') { var st = stepById(t.getAttribute('data-sid')); if (st && st.refImages[+t.getAttribute('data-i')]) st.refImages[+t.getAttribute('data-i')].caption = t.value; return; }
      if (t.hasAttribute && t.hasAttribute('data-ed') && t.getAttribute('data-ed') === 'expected') {          // 展開後の期待結果のプレビューを更新
        var st2 = stepById(t.getAttribute('data-sid')), pv = app.querySelector('[data-aupv="' + t.getAttribute('data-sid') + '"]');
        if (st2 && pv) { st2.expected = t.value; pv.innerHTML = prevHtml(st2); }
        return;
      }
      if (t.hasAttribute && t.hasAttribute('data-inp')) {                                                     // 入力値とパラメータシートの照合を更新
        var s = S(), cur = s && typeof s.view === 'number' ? s.steps[s.view] : null, box = cur && app.querySelector('.au-cmpbox');
        if (!cur || !box) return;
        var vals = {}; cur.inputs.forEach(function (i) { var el = document.getElementById('in_' + i.id); if (el) vals[i.id] = el.type === 'checkbox' ? el.checked : el.value; });
        var tb = box.querySelector('table'); if (tb) { var tmp = document.createElement('tbody'); tmp.innerHTML = cmpRows(cur, vals); [].forEach.call(tmp.children, function (tr) { var old = tb.querySelector('tr[data-aucmp="' + tr.getAttribute('data-aucmp') + '"]'); if (old) old.innerHTML = tr.innerHTML; }); }
      }
    });
    function filesOf(dt) { return dt ? [].slice.call(dt.files || []) : []; }
    app.addEventListener('paste', function (e) {
      var box = e.target.closest && e.target.closest('.au-ref'); if (!box || !e.clipboardData) return;
      var files = filesOf(e.clipboardData).filter(function (f) { return /^image\/(png|jpeg)$/.test(f.type); });
      if (!files.length) return;
      e.preventDefault(); addImages(stepById(box.getAttribute('data-sid')), files);
    });
    app.addEventListener('dragover', function (e) { var d = e.target.closest && e.target.closest('.au-ref'); if (d) { e.preventDefault(); d.classList.add('over'); } });
    app.addEventListener('dragleave', function (e) { var d = e.target.closest && e.target.closest('.au-ref'); if (d) d.classList.remove('over'); });
    app.addEventListener('drop', function (e) {
      var d = e.target.closest && e.target.closest('.au-ref'); if (!d) return;
      e.preventDefault(); e.stopPropagation(); d.classList.remove('over'); addImages(stepById(d.getAttribute('data-sid')), filesOf(e.dataTransfer));
    });
  }

  /* ---------- テンプレートの保存・読み込み ---------- */
  function payload(s, name) {
    return { name: name, doc_title: name, seq: s.seq || 0, param_ref: s.paramRef || null, steps: s.steps.map(function (st) {
      return { id: st.id, section: st.section, title: st.title, context: st.context, content: st.content, expected: st.expected, inputs: st.inputs || [], evidence: st.evidence || [], refImages: st.refImages || [] };
    }) };
  }
  function saveTemplate(overwrite) {
    var s = S(), name = (document.getElementById('auName') || {}).value || '', stat = document.getElementById('auStat');
    if (!name.trim()) { say('テンプレート名を入力してください'); return; }
    if (overwrite && !confirm('テンプレート「' + s.tplName + '」を上書き保存しますか？')) return;
    var body = payload(s, name.trim());
    (overwrite ? Api.post('/api/library/' + encodeURIComponent(s.tplId) + '/steps', body) : Api.post('/api/library/procedure_template', body)).then(function (m) {
      s.tplId = m.id; s.tplName = m.name; s.docTitle = m.name;
      say('手順テンプレートを保存しました：' + m.name + '（テンプレートライブラリ → 手順書）');
      keep(function () { SopApp.render(); });
    }).catch(function (e) { alert('エラー：' + e.message); if (stat) stat.textContent = ''; });
  }
  function maxSeq(steps) {
    var n = 0;
    function see(id) { var m = /^x([0-9a-z]+)$/.exec(id || ''); if (m) n = Math.max(n, parseInt(m[1], 36)); }
    steps.forEach(function (st) { see(st.id); (st.inputs || []).forEach(function (i) { see(i.id); }); });
    return n;
  }
  function fromTemplate(m) {
    var steps = JSON.parse(JSON.stringify(m.steps || [])), now = new Date().toISOString(), hash = 'tpl-' + m.id.slice(-6) + '-' + String(m.updated || '').replace(/\D/g, ''), docName = m.name + '（テンプレート）.docx';
    return { key: 'sopRunner:v1:' + docName + ':' + hash, docName: docName, docTitle: m.name, hash: hash, createdAt: now, updatedAt: now, phase: 'edit', seq: Math.max(m.seq || 0, maxSeq(steps)),
      steps: steps, results: {}, executor: localStorage.getItem('sopRunner:executor') || '', startedAt: null, finishedAt: null, view: 0, exportLang: 'ja',
      tplId: m.id, tplName: m.name, paramRef: m.param_ref || null };
  }
  // 手順テンプレートを開く（mode = 'run'：手順実行 / 'author'：手順修正）。呼び出し側で先に該当タブへ切り替えておく
  function openTemplate(m, mode) {
    var s = fromTemplate(m);
    if (mode === 'run') {
      var old = SopStore.load(s.key);
      if (old) {
        var done = old.steps.filter(function (st) { return old.results[st.id] && old.results[st.id].confirmedAt; }).length;
        if (confirm('このテンプレートの保存済みの進捗があります（' + done + '/' + old.steps.length + ' 手順確認済み）。\nOK = 前回の続きから再開／キャンセル = 最初から')) { SopApp.open(old); say('進捗を復元しました'); return; }
      }
    }
    SopApp.open(s);
    applyJob(s);
    if (!PS) loadPS().then(function () { if (S() === s) keep(function () { SopApp.render(); }); });
  }
  function openForEdit(id) {
    Api.get('/api/library/' + encodeURIComponent(id)).then(function (m) {
      if (m.kind === 'steps') return openTemplate(m, 'author');
      return Api.blob('/api/library/' + encodeURIComponent(id) + '/file').then(function (b) {
        if (window.SopEvidence) SopEvidence.openFromLibrary(id);
        SopApp.importFile(new File([b], m.original_name || (m.name + '.docx'), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      });
    }).catch(function (e) { alert('エラー：' + (e && e.message || e)); });
  }

  /* ---------- 手順修正のホーム ---------- */
  H.authorHome = function (appEl) {
    appEl.innerHTML = '<div class="card"><b>手順修正</b><div class="muted">手順書（.docx）または保存済みの手順テンプレートを開き、手順実行の取り込み後と同じ画面で修正できます。各手順に参考画像を挿入し、期待結果へパラメータシートのキーを挿入して、新しい手順テンプレートとして保存します。</div></div>' +
      '<div class="drop" id="drop"><h2>Word 手順書（.docx）をここにドロップ</h2><p class="muted">または</p><button class="primary" data-au="pickdocx">.docx ファイルを選択</button>' +
      '<input type="file" id="auDocx" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="hidden"></div>' +
      '<div class="card" id="auLib"><b>ライブラリの手順書・手順テンプレートを開く</b> <span class="muted">読み込み中…</span></div>';
    var drop = document.getElementById('drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) SopApp.importFile(f); });
    Api.get('/api/library?type=procedure').then(function (r) {
      var box = document.getElementById('auLib'); if (!box) return;
      box.innerHTML = '<b>ライブラリの手順書・手順テンプレートを開く</b>' + (r.items.length ? '<table class="t" style="margin-top:6px">' + r.items.map(function (m) {
        return '<tr><td lang="ja">' + esc(m.name) + '</td><td class="muted nowrap">' + (m.kind === 'steps' ? '手順テンプレート（' + (m.steps || []).length + ' 手順）' : '.docx') + '</td><td class="right"><button class="small primary" data-au="openlib" data-id="' + esc(m.id) + '">修正する</button></td></tr>';
      }).join('') + '</table>' : '<p class="muted">ライブラリに手順書がまだありません。上の枠から .docx を読み込んでください。</p>');
    }).catch(function () { });
  };
  H.afterRender = function (appEl, s, mode) {
    appEl.classList.toggle('authoring', mode === 'author');
    if (mode !== 'author') return;
    var h1 = document.querySelector('#sop-hdr h1'); if (h1) h1.textContent = '📝 手順修正';
    var m = appEl.querySelector('.card .muted'); if (m && /実行開始/.test(m.innerHTML)) m.innerHTML = m.innerHTML.replace(/「実行開始」をクリックしてください/, '下の「手順テンプレートとして保存」で保存してください');
  };

  window.SopAuthor = { openTemplate: openTemplate, openForEdit: openForEdit, resolveText: resolveText, loadPS: loadPS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
