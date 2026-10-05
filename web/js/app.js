/* 構築作業アシスタント v2 — メイン画面（テンプレートライブラリ / 作業 / 手順実行）。素の JS、フレームワーク・外部リソースなし。 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1800); }
  window.toast = toast;
  function fail(e) { console.error(e); alert('エラー：' + (e && e.message || e)); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function copyText(t) {
    function fb() { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb); else fb();
    toast('コピーしました：' + (t.length > 50 ? t.slice(0, 50) + '…' : t));
  }
  function download(url) { var a = document.createElement('a'); a.href = Api.dl(url); a.download = ''; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500); }
  var TYPE_NAMES = { excel_template: '成果物テンプレート (.xlsx)', param_sheet: 'パラメータシート (.xlsx)', procedure: '手順書 (.docx)', command_set: 'コマンドテンプレート集' };
  var ITYPES = { text: 'テキスト', number: '数値', dropdown: 'リスト', date: '日付' };
  var REASONS = { placeholder: 'プレースホルダ', validation: '入力規則', highlight: '塗りつぶし', label: 'ラベル横の空欄', manual: '手動' };

  var G = { tab: 'library', lib: {}, libView: null, jobId: null, jobTab: 'inputs', jobs: [], presets: {} };

  /* ================= タブ ================= */
  function setTab(t) {
    G.tab = t;
    $$('#nav [data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    $$('.tab').forEach(function (s) { s.classList.toggle('hidden', s.id !== 'tab-' + t); });
    if (t === 'library') renderLibrary();
    if (t === 'jobs') renderJobs();
  }
  $('#nav').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) setTab(b.getAttribute('data-tab')); });
  $('#btnQuit').addEventListener('click', function () {
    if (!confirm('ローカルサーバを停止しますか？（データは data フォルダに保存済みです）')) return;
    var p = window.SopStore ? SopStore.flush() : Promise.resolve();
    p.then(function () { return Api.post('/api/shutdown'); }).then(function () { document.body.innerHTML = '<p style="padding:40px;font-size:18px">停止しました。このページを閉じてかまいません。</p>'; });
  });

  function loadLib() { return Api.get('/api/library').then(function (r) { G.lib = { excel_template: [], param_sheet: [], procedure: [], command_set: [] }; r.items.forEach(function (m) { (G.lib[m.type] = G.lib[m.type] || []).push(m); }); }); }
  function libName(id) { var all = [].concat(G.lib.excel_template || [], G.lib.param_sheet || [], G.lib.procedure || [], G.lib.command_set || []); var m = all.filter(function (x) { return x.id === id; })[0]; return m ? m.name : (id ? '（削除済み）' : '—'); }

  /* ================= テンプレートライブラリ ================= */
  function renderLibrary() {
    var el = $('#library');
    ED = null; CE = null;
    if (G.libView) return renderLibItem(el);
    loadLib().then(function () {
      var h = '<div class="card"><div class="row spread"><h3>テンプレートライブラリ</h3><div class="row"><button id="btnSamples">サンプルデータを読み込む（架空）</button></div></div>' +
        '<div class="uploads">' + upCard('excel_template', '成果物テンプレート', '.xlsx', 'お客様提出用の様式。記入すべきセルを自動検出') + upCard('param_sheet', 'パラメータシート', '.xlsx', '項目／期待値（複数サーバ列に対応）') +
        upCard('procedure', '手順書', '.docx', '「手順実行」で 1 手順ずつ実行') +
        '<div class="up" id="upCmd"><h4>コマンドテンプレート集</h4><p class="muted">{{param}} プレースホルダ付きの参照系確認コマンド</p><button data-act="newCmdSet">新規作成（サンプル付き）</button> <button data-act="pickCmdJson">JSON 読み込み</button><input type="file" accept=".json,application/json" class="hidden" id="cmdJson"></div></div></div>';
      ['excel_template', 'param_sheet', 'procedure', 'command_set'].forEach(function (t) {
        var list = G.lib[t] || [];
        h += '<div class="card"><h3>' + TYPE_NAMES[t] + ' <span class="muted">(' + list.length + ')</span></h3>';
        if (!list.length) h += '<p class="muted">まだありません</p>';
        else h += '<div class="tscroll"><table class="t lib-' + t + '"><tr><th>名前</th><th>ファイル</th><th>概要</th><th>更新日時</th><th></th></tr>' + list.map(function (m) {
          return '<tr data-id="' + m.id + '"><td lang="ja"><b>' + esc(m.name) + '</b></td><td class="muted" lang="ja">' + esc(m.original_name || '') + '</td><td>' + esc(summary(m)) + '</td><td class="nowrap muted">' + esc((m.updated || '').replace('T', ' ')) + '</td><td class="nowrap right">' +
            (t === 'procedure' ? '<button class="small primary" data-act="openSop" data-id="' + m.id + '">手順実行で開く</button> ' : '<button class="small primary" data-act="openItem" data-id="' + m.id + '">' + (t === 'param_sheet' ? '表示' : '編集') + '</button> ') +
            '<button class="small" data-act="rename" data-id="' + m.id + '">名前変更</button> <button class="small danger" data-act="delItem" data-id="' + m.id + '">削除</button></td></tr>';
        }).join('') + '</table></div>';
        h += '</div>';
      });
      el.innerHTML = h;
      $$('.up[data-type]', el).forEach(bindUpload);
      $('#cmdJson').addEventListener('change', function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        f.text().then(function (t) {
          var o = JSON.parse(t); if (!o || !Array.isArray(o.templates)) throw new Error('JSON は {"name": "...", "templates": [...]} 形式である必要があります');
          return Api.post('/api/library/command_set', { name: o.name || f.name.replace(/\.json$/i, ''), templates: o.templates });
        }).then(function (m) { toast('コマンドテンプレート集を読み込みました：' + m.name); renderLibrary(); }).catch(fail);
      });
    }).catch(fail);
  }
  function upCard(type, title, ext, desc) {
    return '<div class="up" data-type="' + type + '"><h4>' + title + ' <span class="muted">' + ext + '</span></h4><p class="muted">' + desc + '</p><button data-act="pick">ファイルを選択</button> <span class="muted">またはここにドロップ</span><input type="file" accept="' + ext + '" class="hidden"></div>';
  }
  function summary(m) {
    if (m.type === 'excel_template') { var it = m.items || []; return '検出項目 ' + it.length + '、パラメータ割当 ' + it.filter(function (x) { return (x.source || {}).kind === 'param'; }).length; }
    if (m.type === 'param_sheet') { var p = m.parsed || {}; return 'パラメータ ' + (p.params || []).length + ' × サーバ ' + (p.servers || []).join(', '); }
    if (m.type === 'command_set') return 'コマンド ' + (m.templates || []).length + ' 件';
    if (m.type === 'procedure') return Math.round((m.size || 0) / 1024) + ' KB';
    return '';
  }
  function bindUpload(box) {
    var type = box.getAttribute('data-type'), inp = $('input[type=file]', box);
    function go(f) {
      if (!f) return;
      toast('アップロード中：' + f.name);
      Api.upload(type, f).then(function (m) { toast('読み込みました：' + m.name); if (type === 'excel_template') { G.libView = { id: m.id }; } renderLibrary(); }).catch(fail);
    }
    $('[data-act=pick]', box).addEventListener('click', function () { inp.click(); });
    inp.addEventListener('change', function () { go(inp.files[0]); inp.value = ''; });
    box.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); box.classList.add('over'); });
    box.addEventListener('dragleave', function () { box.classList.remove('over'); });
    box.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); box.classList.remove('over'); go(e.dataTransfer.files[0]); });
  }
  $('#library').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'openItem') { G.libView = { id: id }; renderLibrary(); }
    else if (act === 'rename') {
      var cur = $('tr[data-id="' + id + '"] b').textContent, n = prompt('新しい名前', cur);
      if (n && n.trim()) Api.put('/api/library/' + id, { name: n.trim() }).then(function () { toast('名前を変更しました'); renderLibrary(); }).catch(fail);
    } else if (act === 'delItem') {
      if (confirm('ライブラリから削除しますか？（ファイルも削除され、元に戻せません）')) Api.del('/api/library/' + id).then(function () { toast('削除しました'); renderLibrary(); }).catch(fail);
    } else if (act === 'newCmdSet') {
      Api.post('/api/library/command_set', { name: 'コマンドテンプレート集 ' + new Date().toLocaleDateString(), templates: SAMPLE_CMDS }).then(function (m) { G.libView = { id: m.id }; renderLibrary(); }).catch(fail);
    } else if (act === 'pickCmdJson') { $('#cmdJson').click();
    } else if (act === 'openSop') {
      openProcedure(id);
    } else if (act === 'backLib') { G.libView = null; renderLibrary(); }
  });
  $('#library').addEventListener('click', function (e) { if (e.target.id === 'btnSamples') Api.post('/api/samples').then(function (r) { toast('サンプルを ' + r.items.length + ' 件読み込みました'); renderLibrary(); }).catch(fail); });

  var SAMPLE_CMDS = [
    { title: 'インスタンス基本情報', kind: 'aws', checks: 'instance_type', template: "aws ec2 describe-instances --region {{region}} --instance-ids {{instance_id}} --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name]' --output text --no-cli-pager" },
    { title: 'メモリ (GiB)', kind: 'linux', checks: 'memory_gib', template: "ssh -n -o BatchMode=yes -o ConnectTimeout=10 {{ssh_user}}@{{private_ip}} 'free -g'" }
  ];

  function openProcedure(id) {
    Api.get('/api/library/' + id).then(function (m) {
      return Api.blob('/api/library/' + id + '/file').then(function (b) {
        setTab('sop');
        if (window.SopEvidence) SopEvidence.openFromLibrary(id);
        SopApp.importFile(new File([b], m.original_name || (m.name + '.docx'), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      });
    }).catch(fail);
  }
  window.SopHooks = {
    afterHome: function (appEl) {
      var box = document.createElement('div'); box.className = 'card'; box.id = 'sop-lib';
      box.innerHTML = '<b>ライブラリの手順書を開く</b> <span class="muted">読み込み中…</span>';
      var drop = appEl.querySelector('#drop'); appEl.insertBefore(box, drop ? drop.nextSibling : null);
      Api.get('/api/library?type=procedure').then(function (r) {
        box.innerHTML = '<b>ライブラリの手順書を開く</b>' + (r.items.length ? '<table class="t" style="margin-top:6px">' + r.items.map(function (m) { return '<tr><td lang="ja">' + esc(m.name) + '</td><td class="right"><button class="small primary" data-open-proc="' + m.id + '">開く</button></td></tr>'; }).join('') + '</table>' : '<p class="muted">ライブラリに手順書がまだありません。</p>');
        $$('[data-open-proc]', box).forEach(function (b) { b.addEventListener('click', function () { openProcedure(b.getAttribute('data-open-proc')); }); });
      });
    }
  };

  /* ---------- ライブラリ項目（個別） ---------- */
  function renderLibItem(el) {
    Promise.all([Api.get('/api/library/' + G.libView.id), loadLib()]).then(function (r) {
      var m = r[0];
      if (m.type === 'excel_template') return renderTemplateEditor(el, m);
      if (m.type === 'param_sheet') return renderParamSheet(el, m);
      if (m.type === 'command_set') return renderCmdSetEditor(el, m);
      G.libView = null; renderLibrary();
    }).catch(function (e) { G.libView = null; fail(e); });
  }

  function renderParamSheet(el, m) {
    var p = m.parsed;
    el.innerHTML = '<div class="card"><div class="row spread"><h3 lang="ja">パラメータシート：' + esc(m.name) + '</h3><button data-act="backLib">← ライブラリへ戻る</button></div>' +
      '<p class="muted">シート「' + esc(p.sheet) + '」、見出し行 ' + p.header_row + ' 行目、サーバ列：' + esc(p.servers.join(', ')) + '</p>' +
      '<div class="tscroll"><table class="t" id="paramTable" lang="ja"><tr><th>区分</th><th>項目</th><th>キー</th>' + p.servers.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '</tr>' +
      p.params.map(function (x) { return '<tr><td>' + esc(x.category) + '</td><td>' + esc(x.label) + '</td><td class="mono">' + esc(x.key) + '</td>' + p.servers.map(function (s) { return '<td>' + esc(x.values[s]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div></div>';
  }

  /* ---------- 成果物テンプレート編集（検出項目＋ルール＋マッピング） ---------- */
  var ED = null;
  function renderTemplateEditor(el, m) {
    ED = { m: m, items: JSON.parse(JSON.stringify(m.items || [])), paramRef: m.param_ref || '', params: [], sheets: null, sheet: 0, sel: null, dirty: false };
    var p1 = ED.paramRef ? Api.get('/api/library/' + ED.paramRef).then(function (ps) { ED.params = ps.parsed.params; }).catch(function () { ED.paramRef = ''; }) : Promise.resolve();
    Promise.all([p1, Api.get('/api/library/' + m.id + '/preview').then(function (r) { ED.sheets = r.sheets; })]).then(function () { drawEditor(el); }).catch(fail);
  }
  function srcValue(it) { var s = it.source || { kind: 'input' }; return s.kind === 'param' ? 'param:' + s.key : s.kind; }
  function drawEditor(el) {
    var m = ED.m, presets = Rules.presets();
    var psOpts = '<option value="">（参照しない）</option>' + (G.lib.param_sheet || []).map(function (p) { return '<option value="' + p.id + '"' + (p.id === ED.paramRef ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    var h = '<div class="card"><div class="row spread"><h3 lang="ja">成果物テンプレート：' + esc(m.name) + ' <span class="muted">' + esc(m.original_name || '') + '</span></h3>' +
      '<div class="row"><button data-act="backLib">← 戻る</button><button class="primary" id="edSave">保存</button></div></div>' +
      '<div class="row"><label>参照パラメータシート <select id="edParam">' + psOpts + '</select></label><button id="edAuto">ラベルで自動マッピング</button><button id="edRedetect">再検出</button>' +
      '<span class="muted" id="edStat"></span></div>' +
      '<p class="muted">黄 = 作業入力、青 = パラメータシートの値、灰 = 記入しない（出力後に手で編集）。グリッドのセルをクリックすると該当項目へ移動、または検出項目を追加できます。</p>';
    if (ED.sheets && ED.sheets.length) {
      h += '<div class="row" style="margin:6px 0">' + ED.sheets.map(function (s, i) { return '<button class="small' + (i === ED.sheet ? ' primary' : '') + '" data-sheet="' + i + '">' + esc(s.name) + '</button>'; }).join('') + '</div>';
      h += '<div class="grid-prev" id="gridPrev">' + gridHtml(ED.sheets[ED.sheet]) + '</div>';
    }
    h += '</div><div class="card"><div class="row spread"><h3>検出項目 / マッピング <span class="muted" id="edCount"></span></h3><button id="edAdd">＋ 項目追加</button></div>' +
      '<div class="tscroll"><table class="t" id="itemTable"><tr><th>セル</th><th style="min-width:180px">ラベル</th><th>検出理由</th><th>型</th><th style="min-width:110px">選択肢(カンマ区切り)</th><th>必須</th><th>書式</th><th>正規表現</th><th>最小</th><th>最大</th><th style="min-width:170px">値の取得元（マッピング）</th><th>固定値</th><th></th></tr>' +
      ED.items.map(function (it, i) {
        var r = it.rules || {}, sv = srcValue(it);
        var srcOpts = '<option value="input"' + (sv === 'input' ? ' selected' : '') + '>作業入力</option><option value="none"' + (sv === 'none' ? ' selected' : '') + '>記入しない（手動）</option><option value="fixed"' + (sv === 'fixed' ? ' selected' : '') + '>固定値</option><option value="evidence"' + (sv === 'evidence' ? ' selected' : '') + '>証跡画像（キー指定）</option>';
        var keys = ED.params.map(function (p) { return p.key; });
        if (sv.indexOf('param:') === 0 && keys.indexOf(sv.slice(6)) < 0) srcOpts += '<option value="' + esc(sv) + '" selected>パラメータ: ' + esc(sv.slice(6)) + '</option>';
        srcOpts += ED.params.map(function (p) { return '<option value="param:' + esc(p.key) + '"' + (sv === 'param:' + p.key ? ' selected' : '') + '>パラメータ: ' + esc(p.label) + ' (' + esc(p.key) + ')</option>'; }).join('');
        return '<tr data-i="' + i + '"' + (ED.sel === it.id ? ' class="sel"' : '') + '><td class="mono nowrap">' + esc(it.sheet) + '!' + '<input type="text" data-f="cell" value="' + esc(it.cell) + '" style="width:58px"></td>' +
          '<td><input type="text" data-f="label" value="' + esc(it.label) + '" lang="ja"></td><td class="muted nowrap">' + esc(REASONS[it.reason] || it.reason || '') + '</td>' +
          '<td><select data-f="type">' + Object.keys(ITYPES).map(function (k) { return '<option value="' + k + '"' + (it.type === k ? ' selected' : '') + '>' + ITYPES[k] + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="text" data-f="options" value="' + esc((it.options || []).join(',')) + '" lang="ja"></td>' +
          '<td><input type="checkbox" data-f="required"' + (r.required ? ' checked' : '') + '></td>' +
          '<td><select data-f="preset"><option value="">—</option>' + Object.keys(presets).map(function (k) { return '<option value="' + k + '"' + (r.preset === k ? ' selected' : '') + '>' + esc(presets[k].label) + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="text" data-f="pattern" value="' + esc(r.pattern || '') + '" class="mono" style="width:90px"></td>' +
          '<td><input type="text" data-f="min" value="' + esc(r.min == null ? '' : r.min) + '" style="width:50px"></td><td><input type="text" data-f="max" value="' + esc(r.max == null ? '' : r.max) + '" style="width:50px"></td>' +
          '<td><select data-f="source">' + srcOpts + '</select></td><td><input type="text" data-f="fixed" value="' + esc(sv === 'evidence' ? (it.source.key || '') : ((it.source || {}).value || '')) + '" ' + (sv === 'fixed' || sv === 'evidence' ? '' : 'disabled') + ' placeholder="' + (sv === 'evidence' ? '証跡キー' : '') + '" style="width:90px"></td>' +
          '<td><button class="small danger" data-f="del">✕</button></td></tr>';
      }).join('') + '</table></div></div>';
    el.innerHTML = h;
    updateEdStat();
  }
  function gridHtml(sh) {
    var hit = {}; ED.items.forEach(function (it) { if (it.sheet === sh.name) hit[it.cell] = it; });
    var skip = {}, span = {};
    sh.merges.forEach(function (mg) { span[mg[0] + ',' + mg[1]] = [mg[2] - mg[0] + 1, mg[3] - mg[1] + 1]; for (var r = mg[0]; r <= mg[2]; r++) for (var c = mg[1]; c <= mg[3]; c++) if (r !== mg[0] || c !== mg[1]) skip[r + ',' + c] = 1; });
    var h = '<table lang="ja"><tr><th></th>' + sh.cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
    sh.rows.forEach(function (row, ri) {
      h += '<tr><th>' + (ri + 1) + '</th>';
      row.forEach(function (v, ci) {
        var k = (ri + 1) + ',' + (ci + 1); if (skip[k]) return;
        var addr = sh.cols[ci] + (ri + 1), it = hit[addr], sp = span[k];
        var cls = it ? 'hit ' + ((it.source || {}).kind || 'input') : '';
        if (it && ED.sel === it.id) cls += ' sel';
        h += '<td data-addr="' + addr + '" class="' + cls + '"' + (sp ? ' rowspan="' + sp[0] + '" colspan="' + sp[1] + '"' : '') + ' title="' + esc(addr + (it ? ' → ' + it.label : '')) + '">' + esc(v || (it ? '⟨' + it.label + '⟩' : '')) + '</td>';
      });
      h += '</tr>';
    });
    return h + '</table>';
  }
  function updateEdStat() {
    var n = ED.items.length, np = ED.items.filter(function (x) { return (x.source || {}).kind === 'param'; }).length, ni = ED.items.filter(function (x) { return (x.source || {}).kind === 'input'; }).length;
    var s = $('#edCount'); if (s) s.textContent = '全 ' + n + ' 項目：パラメータ ' + np + '、作業入力 ' + ni + '、その他 ' + (n - np - ni);
    var st = $('#edStat'); if (st) st.textContent = ED.dirty ? '● 未保存の変更があります' : '';
  }
  function edDirty() { ED.dirty = true; updateEdStat(); }
  function leftLabel(sh, addr) {
    var ci = sh.cols.indexOf(addr.replace(/\d+/g, '')), ri = parseInt(addr.replace(/\D+/g, ''), 10) - 1;
    for (var c = ci - 1; c >= 0; c--) { var v = (sh.rows[ri] || [])[c]; if (v && String(v).trim()) return String(v).trim(); }
    return addr;
  }
  $('#library').addEventListener('input', function (e) {
    var t = e.target, tr = t.closest('#itemTable tr[data-i]'); if (!tr || !ED) return;
    var it = ED.items[+tr.getAttribute('data-i')], f = t.getAttribute('data-f'); it.rules = it.rules || {};
    if (f === 'cell') { it.cell = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); it.id = it.sheet + '!' + it.cell; }
    else if (f === 'label') it.label = t.value;
    else if (f === 'options') it.options = t.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    else if (f === 'pattern') it.rules.pattern = t.value;
    else if (f === 'min' || f === 'max') it.rules[f] = t.value === '' ? null : (isNaN(+t.value) ? t.value : +t.value);
    else if (f === 'fixed') it.source = (it.source || {}).kind === 'evidence' ? { kind: 'evidence', key: t.value.trim() } : { kind: 'fixed', value: t.value };
    edDirty();
  });
  $('#library').addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'edParam') {
      ED.paramRef = t.value; ED.params = [];
      (ED.paramRef ? Api.get('/api/library/' + ED.paramRef).then(function (ps) { ED.params = ps.parsed.params; }) : Promise.resolve()).then(function () { edDirty(); drawEditor($('#library')); });
      return;
    }
    var tr = t.closest('#itemTable tr[data-i]'); if (!tr || !ED) return;
    var it = ED.items[+tr.getAttribute('data-i')], f = t.getAttribute('data-f'); it.rules = it.rules || {};
    if (f === 'type') it.type = t.value;
    else if (f === 'required') it.rules.required = t.checked;
    else if (f === 'preset') it.rules.preset = t.value || null;
    else if (f === 'source') {
      it._manual = true;
      it.source = t.value.indexOf('param:') === 0 ? { kind: 'param', key: t.value.slice(6) } : (t.value === 'fixed' ? { kind: 'fixed', value: '' } : { kind: t.value });
      var fx = $('input[data-f=fixed]', tr); fx.disabled = t.value !== 'fixed' && t.value !== 'evidence'; fx.placeholder = t.value === 'evidence' ? '証跡キー' : ''; if (t.value === 'evidence') it.source = { kind: 'evidence', key: fx.value.trim() };
      var g = $('#gridPrev'); if (g) g.innerHTML = gridHtml(ED.sheets[ED.sheet]);
    }
    edDirty();
  });
  $('#library').addEventListener('click', function (e) {
    if (!ED) return;
    var t = e.target;
    if (t.id === 'edSave') {
      Api.put('/api/library/' + ED.m.id, { items: ED.items, param_ref: ED.paramRef || null }).then(function (m) { ED.m = m; ED.dirty = false; updateEdStat(); toast('テンプレート設定を保存しました'); }).catch(fail);
    } else if (t.id === 'edAuto') {
      if (!ED.paramRef) { toast('先に参照パラメータシートを選択してください'); return; }
      Api.put('/api/library/' + ED.m.id, { items: ED.items, param_ref: ED.paramRef }).then(function () { return Api.post('/api/library/' + ED.m.id + '/automap', { param_sheet_id: ED.paramRef }); })
        .then(function (r) { toast('自動マッピング：' + r.mapped + ' 項目'); renderTemplateEditor($('#library'), r.item); }).catch(fail);
    } else if (t.id === 'edRedetect') {
      if (confirm('再検出すると現在の検出項目とマッピングが上書きされます。続行しますか？')) Api.post('/api/library/' + ED.m.id + '/redetect').then(function (m) { renderTemplateEditor($('#library'), m); toast('再検出しました：' + m.items.length + ' 項目'); }).catch(fail);
    } else if (t.id === 'edAdd') {
      var sh = ED.sheets ? ED.sheets[ED.sheet].name : 'Sheet1';
      ED.items.push({ id: sh + '!A1', sheet: sh, cell: 'A1', label: '新しい項目', type: 'text', options: [], rules: { required: true }, reason: 'manual', source: { kind: 'input' } });
      edDirty(); drawEditor($('#library'));
    } else if (t.getAttribute('data-f') === 'del' && t.closest('#itemTable')) {
      ED.items.splice(+t.closest('tr').getAttribute('data-i'), 1); edDirty(); drawEditor($('#library'));
    } else if (t.hasAttribute('data-sheet')) {
      ED.sheet = +t.getAttribute('data-sheet'); drawEditor($('#library'));
    } else if (t.closest('#gridPrev td[data-addr]')) {
      var td = t.closest('td[data-addr]'), addr = td.getAttribute('data-addr'), shn = ED.sheets[ED.sheet];
      var found = ED.items.filter(function (x) { return x.sheet === shn.name && x.cell === addr; })[0];
      if (!found) {
        if (!confirm(shn.name + '!' + addr + ' を検出項目に追加しますか？')) return;
        found = { id: shn.name + '!' + addr, sheet: shn.name, cell: addr, label: leftLabel(shn, addr), type: 'text', options: [], rules: { required: true }, reason: 'manual', source: { kind: 'input' } };
        ED.items.push(found); edDirty();
      }
      ED.sel = found.id; drawEditor($('#library'));
      var row = $('#itemTable tr.sel'); if (row) row.scrollIntoView({ block: 'center' });
    }
  });

  /* ---------- コマンドテンプレート集の編集 ---------- */
  var CE = null;
  function renderCmdSetEditor(el, m) {
    CE = { m: m, t: JSON.parse(JSON.stringify(m.templates || [])), ps: (G.lib.param_sheet || [])[0] ? G.lib.param_sheet[0].id : '', server: '' };
    drawCmdEditor(el);
  }
  function drawCmdEditor(el) {
    var ps = (G.lib.param_sheet || []).filter(function (p) { return p.id === CE.ps; })[0], servers = ps ? ps.parsed.servers : [];
    if (servers.indexOf(CE.server) < 0) CE.server = servers[0] || '';
    var h = '<div class="card"><div class="row spread"><h3 lang="ja">コマンドテンプレート集：' + esc(CE.m.name) + '</h3><div class="row"><button data-act="backLib">← 戻る</button><button id="ceExport">JSON 出力</button><button class="primary" id="ceSave">保存</button></div></div>' +
      '<p class="muted"><code>{{キー}}</code> でパラメータシートのキーを参照します（例：<code>{{instance_id}}</code>）。<b>参照系</b>の確認コマンドのみ登録してください：aws は <code>--output</code> と <code>--no-cli-pager</code>、ssh は <code>-o BatchMode=yes</code> が必要です。本ツールはテキストを生成するだけで、<b>コマンドを実行することはありません</b>。</p>' +
      '<div class="tscroll"><table class="t" id="ceTable"><tr><th style="width:160px">タイトル</th><th style="width:80px">種別</th><th style="width:140px">比較するキー(カンマ区切り)</th><th>コマンドテンプレート</th><th></th></tr>' +
      CE.t.map(function (t, i) {
        return '<tr data-i="' + i + '"><td><input type="text" data-f="title" value="' + esc(t.title) + '" lang="ja"></td><td><select data-f="kind">' + ['aws', 'linux', 'windows', 'other'].map(function (k) { return '<option' + (t.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="text" data-f="checks" value="' + esc(t.checks || '') + '" class="mono"></td><td><textarea class="mono tpl" data-f="template">' + esc(t.template) + '</textarea></td><td><button class="small danger" data-f="del">✕</button></td></tr>';
      }).join('') + '</table></div><button id="ceAdd" style="margin-top:8px">＋ コマンド追加</button></div>' +
      '<div class="card"><div class="row"><b>プレビュー</b><label>パラメータシート <select id="cePs">' + (G.lib.param_sheet || []).map(function (p) { return '<option value="' + p.id + '"' + (p.id === CE.ps ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>サーバ <select id="ceSrv">' + servers.map(function (s) { return '<option' + (s === CE.server ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label></div><div id="cePreview" style="margin-top:8px"></div></div>';
    el.innerHTML = h;
    cePreview();
  }
  var cePreview = debounce(function () {
    if (!CE) return;
    Api.post('/api/library/commands_preview', { templates: CE.t, param_sheet_id: CE.ps, server: CE.server }).then(function (r) { var p = $('#cePreview'); if (p) p.innerHTML = cmdList(r.commands); }).catch(function () { });
  }, 250);
  function cmdList(cmds) {
    if (!cmds.length) return '<p class="muted">コマンドがありません。</p>';
    return cmds.map(function (c, i) {
      return '<div class="cmdcard" data-cmd="' + i + '"><div class="row spread"><b lang="ja">[' + (i + 1) + '] ' + esc(c.title) + '</b><span class="muted">' + esc(c.kind) + (c.checks ? ' · 比較: ' + esc(c.checks) : '') + '</span></div>' +
        c.warnings.map(function (w) { return '<div class="warn">⚠ ' + esc(w) + '</div>'; }).join('') +
        (c.missing.length ? '<div class="miss">未解決のプレースホルダ：' + esc(c.missing.join(', ')) + '</div>' : '') +
        '<div class="cmd"><code>' + esc(c.sh) + '</code><button data-copy="' + esc(c.sh) + '">コピー</button></div></div>';
    }).join('');
  }
  $('#library').addEventListener('input', function (e) {
    var tr = e.target.closest('#ceTable tr[data-i]'); if (!tr || !CE) return;
    CE.t[+tr.getAttribute('data-i')][e.target.getAttribute('data-f')] = e.target.value; cePreview();
  });
  $('#library').addEventListener('change', function (e) {
    if (!CE) return;
    if (e.target.id === 'cePs') { CE.ps = e.target.value; drawCmdEditor($('#library')); }
    else if (e.target.id === 'ceSrv') { CE.server = e.target.value; cePreview(); }
  });
  $('#library').addEventListener('click', function (e) {
    if (!CE) return;
    var t = e.target;
    if (t.id === 'ceSave') Api.put('/api/library/' + CE.m.id, { templates: CE.t }).then(function () { toast('コマンドテンプレートを保存しました'); }).catch(fail);
    else if (t.id === 'ceExport') {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ name: CE.m.name, templates: CE.t }, null, 2)], { type: 'application/json' }));
      a.download = CE.m.name + '.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }
    else if (t.id === 'ceAdd') { CE.t.push({ title: '新しいコマンド', kind: 'linux', checks: '', template: "ssh -n -o BatchMode=yes -o ConnectTimeout=10 {{ssh_user}}@{{private_ip}} 'uptime'" }); drawCmdEditor($('#library')); }
    else if (t.getAttribute('data-f') === 'del' && t.closest('#ceTable')) { CE.t.splice(+t.closest('tr').getAttribute('data-i'), 1); drawCmdEditor($('#library')); }
  });

  // 共通のコピーボタン
  document.addEventListener('click', function (e) { var b = e.target.closest('#library [data-copy], #jobs [data-copy]'); if (b) copyText(b.getAttribute('data-copy')); });

  /* ================= 作業 ================= */
  var J = null; // 表示中の作業 {job, resolved, template, compare}
  function renderJobs() {
    Promise.all([loadLib(), Api.get('/api/jobs')]).then(function (r) {
      G.jobs = r[1].items;
      var el = $('#jobs');
      var list = '<div class="side joblist"><div style="padding:10px"><button class="primary" id="jobNew" style="width:100%">＋ 新規作業</button></div>' +
        (G.jobs.length ? G.jobs.map(function (j) { return '<div class="it' + (j.id === G.jobId ? ' on' : '') + '" data-job="' + j.id + '"><b lang="ja">' + esc(j.name) + '</b><div class="muted">' + esc(j.server || '') + ' · ' + esc((j.updated || '').replace('T', ' ')) + '</div></div>'; }).join('') : '<p class="muted" style="padding:0 10px">作業がありません</p>') + '</div>';
      el.innerHTML = '<div class="cols">' + list + '<div id="jobMain"></div></div>';
      if (G.jobId === 'new' || !G.jobs.length) drawJobForm(null);
      else if (G.jobId && G.jobs.some(function (j) { return j.id === G.jobId; })) openJob(G.jobId);
      else $('#jobMain').innerHTML = '<div class="card muted">作業を選択するか、新規作成してください。</div>';
    }).catch(fail);
  }
  function sel(id, list, cur, empty) {
    return '<select id="' + id + '">' + (empty ? '<option value="">' + empty + '</option>' : '') + list.map(function (m) { return '<option value="' + m.id + '"' + (m.id === cur ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select>';
  }
  function drawJobForm(job) {
    var j = job || { name: '', template_id: (G.lib.excel_template[0] || {}).id, param_sheet_id: (G.lib.param_sheet[0] || {}).id, command_set_id: (G.lib.command_set[0] || {}).id, server: '' };
    var h = '<div class="card"><h3>' + (job ? '作業の設定' : '新規作業') + '</h3><div class="formgrid">' +
      '<label>作業名<input type="text" id="jfName" value="' + esc(j.name) + '" placeholder="例：web01 構築確認" lang="ja"></label>' +
      '<label>成果物テンプレート' + sel('jfTpl', G.lib.excel_template, j.template_id, '（使用しない）') + '</label>' +
      '<label>パラメータシート' + sel('jfPs', G.lib.param_sheet, j.param_sheet_id, '（使用しない）') + '</label>' +
      '<label>サーバ（パラメータシートの列）<select id="jfSrv"></select></label>' +
      '<label>コマンドテンプレート集' + sel('jfCs', G.lib.command_set, j.command_set_id, '（使用しない）') + '</label>' +
      '<label>手順書（任意）' + sel('jfPr', G.lib.procedure, j.procedure_id, '（使用しない）') + '</label>' +
      '</div><div class="actions"><button class="primary" id="jfSave">' + (job ? '設定を保存' : '作業を作成') + '</button>' + (job ? '<button id="jfCancel">キャンセル</button>' : '') + '</div></div>';
    $('#jobMain').innerHTML = h;
    function fillSrv() {
      var ps = G.lib.param_sheet.filter(function (p) { return p.id === $('#jfPs').value; })[0], s = ps ? ps.parsed.servers : [];
      $('#jfSrv').innerHTML = s.map(function (x) { return '<option' + (x === j.server ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
    }
    fillSrv(); $('#jfPs').addEventListener('change', fillSrv);
    $('#jfSave').addEventListener('click', function () {
      var b = { name: $('#jfName').value.trim() || ('作業 ' + new Date().toLocaleString()), template_id: $('#jfTpl').value || null, param_sheet_id: $('#jfPs').value || null, server: $('#jfSrv').value || '', command_set_id: $('#jfCs').value || null, procedure_id: $('#jfPr').value || null };
      (job ? Api.put('/api/jobs/' + job.id, b).then(function () { return job; }) : Api.post('/api/jobs', b)).then(function (r) { G.jobId = r.id; toast(job ? '保存しました' : '作業を作成しました'); renderJobs(); }).catch(fail);
    });
    if (job) $('#jfCancel').addEventListener('click', function () { openJob(job.id); });
  }
  function openJob(id) {
    G.jobId = id;
    $$('.joblist .it').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-job') === id); });
    Api.get('/api/jobs/' + id).then(function (v) {
      J = { job: v.job, resolved: v.resolved, template: null };
      return v.job.template_id ? Api.get('/api/library/' + v.job.template_id).then(function (t) { J.template = t; }).catch(function () { }) : null;
    }).then(drawJob).catch(fail);
  }
  function drawJob() {
    var j = J.job;
    var h = '<div class="card"><div class="row spread"><div><h3 lang="ja" style="margin:0">' + esc(j.name) + '</h3><div class="muted" lang="ja">サーバ <b>' + esc(j.server || '—') + '</b> · テンプレート ' + esc(libName(j.template_id)) + ' · パラメータシート ' + esc(libName(j.param_sheet_id)) + ' · コマンド ' + esc(libName(j.command_set_id)) + '</div></div>' +
      '<div class="row">' + (j.procedure_id ? '<button id="jbProc">手順書を開く</button>' : '') + '<button id="jbEdit">設定</button><button class="danger" id="jbDel">削除</button></div></div>' +
      '<div class="subtabs" id="jobTabs">' + [['inputs', '① 入力チェック'], ['commands', '② コマンド生成'], ['compare', '③ パラメータ比較'], ['values', '④ 最終値チェック'], ['deliver', '⑤ 成果物出力']].map(function (t) { return '<button data-jt="' + t[0] + '"' + (G.jobTab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div></div><div id="jobBody"></div>';
    $('#jobMain').innerHTML = h;
    ({ inputs: drawInputs, commands: drawCommands, compare: drawCompare, values: drawValues, deliver: drawDeliver })[G.jobTab]();
  }
  $('#jobs').addEventListener('click', function (e) {
    var t = e.target, it = t.closest('[data-job]');
    if (it) return openJob(it.getAttribute('data-job'));
    if (t.id === 'jobNew') { G.jobId = 'new'; drawJobForm(null); return; }
    if (t.hasAttribute('data-jt')) { G.jobTab = t.getAttribute('data-jt'); drawJob(); return; }
    if (t.id === 'jbEdit') return drawJobForm(J.job);
    if (t.id === 'jbProc') return openProcedure(J.job.procedure_id);
    if (t.id === 'jbDel') { if (confirm('作業「' + J.job.name + '」を削除しますか？')) Api.del('/api/jobs/' + J.job.id).then(function () { G.jobId = null; renderJobs(); }).catch(fail); }
  });

  // 非同期応答の時点で別の作業／サブタブに切り替わっていたら、その描画は破棄する（競合回避）
  function stale(body, tab) { return !body.isConnected || G.jobTab !== tab; }
  /* ---------- ① 入力チェック ---------- */
  function itemsById() { var m = {}; ((J.template || {}).items || []).forEach(function (it) { m[it.id] = it; }); return m; }
  function drawInputs() {
    var body = $('#jobBody');
    if (!J.template) { body.innerHTML = '<div class="card muted">この作業には成果物テンプレートが設定されていません。</div>'; return; }
    var byId = itemsById(), res = J.resolved.filter(function (r) { return r.kind !== 'none' && r.kind !== 'evidence'; });
    var inputs = res.filter(function (r) { return r.kind === 'input'; }), others = res.filter(function (r) { return r.kind !== 'input'; });
    function row(r) {
      var it = byId[r.id] || {}, v = r.value == null ? '' : r.value, ctl;
      if (r.kind !== 'input') ctl = '<input type="text" value="' + esc(v) + '" disabled lang="ja" data-ro="' + esc(r.id) + '">';
      else if (it.type === 'dropdown') ctl = '<select data-in="' + esc(r.id) + '"><option value="">（未選択）</option>' + (it.options || []).map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      else ctl = '<input type="text" data-in="' + esc(r.id) + '" value="' + esc(v) + '" lang="ja"' + (it.type === 'number' ? ' inputmode="decimal"' : '') + ' placeholder="' + esc(placeholderFor(it)) + '">';
      return '<tr data-row="' + esc(r.id) + '"><td class="mono nowrap muted">' + esc(r.cell) + '</td><td lang="ja">' + esc(r.label) + ((it.rules || {}).required ? ' <span class="req" style="color:#dc2626">*</span>' : '') + '</td><td><span class="pill ' + r.kind + '">' + ({ param: 'パラメータ ' + (r.key || ''), fixed: '固定値', input: '入力' })[r.kind] + '</span></td><td class="w-val">' + ctl + '</td><td class="msg w-msg"></td></tr>';
    }
    body.innerHTML = '<div class="card"><div class="row spread"><h3>作業入力 <span class="muted">(' + inputs.length + ')</span></h3><span id="inStat"></span></div>' +
      '<div class="tscroll"><table class="t" id="inTable"><tr><th>セル</th><th>項目</th><th>取得元</th><th>値</th><th>チェック</th></tr>' + inputs.map(row).join('') + '</table></div></div>' +
      '<div class="card"><h3>パラメータシート / 固定値から <span class="muted">(' + others.length + ')（同じルールでチェックし、パラメータシート自体の誤りも検出）</span></h3><div class="tscroll"><table class="t" id="roTable"><tr><th>セル</th><th>項目</th><th>取得元</th><th>値</th><th>チェック</th></tr>' + others.map(row).join('') + '</table></div></div>';
    validateAll();
  }
  function placeholderFor(it) { var p = (it.rules || {}).preset, ps = Rules.presets(); return p && ps[p] ? '例: ' + ps[p].example : (it.type === 'number' ? '数値' : ''); }
  function validateAll() {
    var byId = itemsById(), bad = 0, total = 0;
    $$('#jobBody tr[data-row]').forEach(function (tr) {
      var id = tr.getAttribute('data-row'), it = byId[id] || {}, ctl = $('[data-in],[data-ro]', tr), errs = Rules.validate(it, ctl.value);
      total++; if (errs.length) bad++;
      ctl.classList.toggle('invalid', errs.length > 0);
      $('.msg', tr).innerHTML = errs.length ? '<span class="err">✕ ' + esc(errs.map(function (x) { return x.message; }).join('；')) + '</span>' : (String(ctl.value).trim() ? '<span class="okc">✓</span>' : '');
    });
    var s = $('#inStat'); if (s) s.innerHTML = bad ? '<span class="err" style="font-size:13px">ルール違反 ' + bad + ' 件（全 ' + total + ' 項目）</span>' : '<span class="okc" style="font-size:13px">全 ' + total + ' 項目 チェック OK</span>';
  }
  var pendingInputs = {};
  function flushInputs() {
    var b = pendingInputs; pendingInputs = {};
    if (!Object.keys(b).length || !J) return Promise.resolve();
    return Api.put('/api/jobs/' + J.job.id, { inputs: b }).then(function (v) { J.job = v.job; J.resolved = v.resolved; });
  }
  var saveInputs = debounce(function () { flushInputs().catch(fail); }, 300);
  function onInputChange(e) {
    var t = e.target; if (!t.hasAttribute('data-in') || !J) return;
    var id = t.getAttribute('data-in'); pendingInputs[id] = t.value; J.job.inputs[id] = t.value;
    J.resolved.forEach(function (r) { if (r.id === id) r.value = t.value; });
    validateAll(); saveInputs();
  }
  $('#jobs').addEventListener('input', onInputChange);
  $('#jobs').addEventListener('change', function (e) { if (e.target.tagName === 'SELECT') onInputChange(e); });

  /* ---------- ② コマンド生成 ---------- */
  function drawCommands() {
    var body = $('#jobBody');
    if (!J.job.command_set_id) { body.innerHTML = '<div class="card muted">この作業にはコマンドテンプレート集が選択されていません。</div>'; return; }
    Api.get('/api/jobs/' + J.job.id + '/commands').then(function (r) {
      if (stale(body, 'commands')) return;
      var needed = {}; r.commands.forEach(function (c) { (c.sh.match(/\{\{\s*[\w.-]+\s*\}\}/g) || []).forEach(function (x) { needed[x.replace(/[{}\s]/g, '')] = 1; }); });
      var gl = J.job.globals || {};
      var used = {}; ((G.lib.command_set || []).filter(function (c) { return c.id === J.job.command_set_id; })[0] || { templates: [] }).templates.forEach(function (t) { (t.template.match(/\{\{\s*([\w.-]+)\s*\}\}/g) || []).forEach(function (x) { used[x.replace(/[{}\s]/g, '')] = 1; }); });
      var keys = Object.keys(used).sort();
      body.innerHTML = '<div class="card"><div class="row spread"><h3>確認コマンド <span class="muted">(' + r.commands.length + ')</span></h3><div class="row">' +
        '<button id="dlSh">.sh をダウンロード</button><button id="dlPs1">.ps1 をダウンロード</button></div></div>' +
        '<p class="muted">⚠ テキストを生成するだけで、<b>自動実行はしません</b>。内容を確認のうえ、ご自身の端末で手動実行してください。aws コマンドにはすべて <code>--no-cli-pager</code> / <code>--output</code>、ssh には <code>-o BatchMode=yes</code> を付けています（不足は lint で警告）。</p>' +
        '<details open><summary>プレースホルダ変数（パラメータシートの値。ここで上書き可）</summary><div class="tscroll"><table class="t" id="glTable" style="margin-top:6px"><tr><th>変数</th><th>現在の値</th><th>上書き値（この作業のみ）</th></tr>' +
        keys.map(function (k) { return '<tr><td class="mono">{{' + esc(k) + '}}</td><td class="mono' + (needed[k] ? ' err' : '') + '">' + esc(r.context[k] == null || r.context[k] === '' ? '（未定義）' : r.context[k]) + '</td><td><input type="text" class="mono" data-gl="' + esc(k) + '" value="' + esc(gl[k] || '') + '"></td></tr>'; }).join('') + '</table></div></details>' +
        '<div style="margin-top:10px" id="cmdList">' + cmdList(r.commands) + '</div></div>';
      $('#dlSh').addEventListener('click', function () { download('/api/jobs/' + J.job.id + '/commands.sh'); });
      $('#dlPs1').addEventListener('click', function () { download('/api/jobs/' + J.job.id + '/commands.ps1'); });
      $$('[data-gl]', body).forEach(function (inp) {
        inp.addEventListener('change', function () { J.job.globals = J.job.globals || {}; J.job.globals[inp.getAttribute('data-gl')] = inp.value; Api.put('/api/jobs/' + J.job.id, { globals: J.job.globals }).then(drawCommands).catch(fail); });
      });
    }).catch(fail);
  }

  /* ---------- ③ パラメータ比較 ---------- */
  function drawCompare() {
    var body = $('#jobBody');
    if (!J.job.param_sheet_id) { body.innerHTML = '<div class="card muted">この作業にはパラメータシートが設定されていません。</div>'; return; }
    Api.get('/api/jobs/' + J.job.id + '/compare').then(function (r) {
      if (stale(body, 'compare')) return;
      J.compareRows = r.rows;
      body.innerHTML = '<div class="card"><div class="row spread"><h3>パラメータ比較 <span class="muted">サーバ ' + esc(J.job.server) + '</span></h3><div class="row"><span id="cmpStat"></span><button class="primary" id="cmpExport">比較結果を出力 .xlsx</button></div></div>' +
        '<p class="muted">確認コマンドの出力結果を「実測値」に入力すると、期待値との一致を自動判定します（全角/半角・大文字/小文字・空白は無視、8 / 8 GiB / 8GB は同一とみなします）。最後に 1 項目ずつ OK / NG をクリックしてください。</p>' +
        '<div class="tscroll"><table class="t" id="cmpTable"><tr><th class="nowrap">区分</th><th class="w-item">項目 / キー</th><th class="w-exp">期待値</th><th class="w-actual">実測値</th><th>自動判定</th><th>判定</th><th class="w-note">備考</th><th>確認コマンド</th></tr>' +
        r.rows.map(function (x) {
          return '<tr data-key="' + esc(x.key) + '" class="' + (x.auto === 'mismatch' ? 'mismatch' : '') + '"><td lang="ja" class="nowrap">' + esc(x.category) + '</td><td lang="ja">' + esc(x.label) + '<div class="mono muted keyline">' + esc(x.key) + '</div></td><td class="mono brk exp" lang="ja">' + esc(x.expected) + '</td>' +
            '<td><input type="text" data-cmp="actual" value="' + esc(x.actual) + '" lang="ja"></td><td class="nowrap"><span class="pill ' + x.auto + '" data-auto>' + esc(x.auto_label) + '</span></td>' +
            '<td class="jg nowrap"><button class="small ok' + (x.judgement === 'OK' ? ' on' : '') + '" data-j="OK">OK</button> <button class="small ng' + (x.judgement === 'NG' ? ' on' : '') + '" data-j="NG">NG</button></td>' +
            '<td><input type="text" data-cmp="note" value="' + esc(x.note) + '" lang="ja"></td><td><div class="copylist">' + x.commands.map(function (c) { return '<button class="small" data-copy="' + esc(c.sh) + '" title="' + esc(c.sh) + '" lang="ja">コピー: ' + esc(c.title) + '</button>'; }).join('') + '</div></td></tr>';
        }).join('') + '</table></div></div>';
      cmpStat();
      $('#cmpExport').addEventListener('click', function () { flushCompare().then(function () { download('/api/jobs/' + J.job.id + '/compare.xlsx'); }); });
    }).catch(fail);
  }
  function cmpStat() {
    var rows = $$('#cmpTable tr[data-key]'), mm = 0, ok = 0, ng = 0, miss = 0;
    rows.forEach(function (tr) { var a = $('[data-auto]', tr).className; if (/mismatch/.test(a)) mm++; if (/missing/.test(a)) miss++; if ($('[data-j=OK].on', tr)) ok++; if ($('[data-j=NG].on', tr)) ng++; });
    $('#cmpStat').innerHTML = '<span class="pill mismatch">不一致 ' + mm + '</span> <span class="pill missing">未入力 ' + miss + '</span> <span class="pill match">OK ' + ok + '</span> <span class="pill mismatch">NG ' + ng + '</span> <span class="muted">/ ' + rows.length + '</span>';
  }
  var pendingCmp = {};
  function cmpState(key) { J.job.compare = J.job.compare || {}; return (J.job.compare[key] = J.job.compare[key] || {}); }
  function queueCmp(key) { pendingCmp[key] = cmpState(key); saveCmp(); }
  function flushCompare() { var b = pendingCmp; pendingCmp = {}; return Object.keys(b).length ? Api.put('/api/jobs/' + J.job.id, { compare: b }) : Promise.resolve(); }
  var saveCmp = debounce(function () { flushCompare().catch(fail); }, 300);
  $('#jobs').addEventListener('input', function (e) {
    var t = e.target, f = t.getAttribute('data-cmp'); if (!f) return;
    var tr = t.closest('tr'), key = tr.getAttribute('data-key'), st = cmpState(key); st[f] = t.value;
    if (f === 'actual') {
      var row = J.compareRows.filter(function (x) { return x.key === key; })[0], a = Rules.judge(row.expected, t.value), pill = $('[data-auto]', tr);
      pill.className = 'pill ' + a; pill.textContent = Rules.STATUS_LABEL[a]; tr.classList.toggle('mismatch', a === 'mismatch'); cmpStat();
    }
    queueCmp(key);
  });
  $('#jobs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-j]'); if (!b) return;
    var tr = b.closest('tr'), key = tr.getAttribute('data-key'), st = cmpState(key), v = b.getAttribute('data-j');
    st.judgement = st.judgement === v ? '' : v; st.judged_at = st.judgement ? new Date().toLocaleString('sv-SE') : '';
    $$('[data-j]', tr).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-j') === st.judgement); });
    cmpStat(); queueCmp(key);
  });

  function flushAll() { return Promise.all([flushInputs(), flushCompare()]); }

  /* ---------- 共通：ダイアログ ---------- */
  // opts: { title, html, cls, buttons: [{ label, value, cls, href }] } → 押したボタンの value（Esc / 背景クリックは ''）
  function showModal(opts) {
    return new Promise(function (resolve) {
      var o = document.createElement('div'); o.className = 'modal-back'; o.id = 'modal';
      o.innerHTML = '<div class="modal ' + (opts.cls || '') + '" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h3 id="modalTitle">' + esc(opts.title) + '</h3><div class="modal-body">' + opts.html + '</div><div class="modal-actions">' +
        opts.buttons.map(function (b, i) { return b.href ? '<a class="btnlink ' + (b.cls || '') + '" data-mi="' + i + '" href="' + esc(b.href) + '"' + (b.download ? ' download' : ' target="_blank" rel="noopener"') + '>' + esc(b.label) + '</a>' : '<button class="' + (b.cls || '') + '" data-mi="' + i + '">' + esc(b.label) + '</button>'; }).join('') + '</div></div>';
      function close(v) { o.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') close(''); }
      o.addEventListener('click', function (e) { var b = e.target.closest('[data-mi]'); if (b) close(opts.buttons[+b.getAttribute('data-mi')].value || ''); else if (e.target === o) close(''); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(o);
      var f = $('.modal-actions [data-mi]', o); if (f) f.focus();
    });
  }

  /* ---------- ④ 最終値チェック ---------- */
  var VSTAT = { match: '一致', mismatch: '不一致', missing: '未入力', no_expected: '期待値なし', invalid: '書式エラー', ok: '入力済み' };
  function vPill(r) { return r.conflict ? '<span class="pill mismatch">食い違い</span>' + (r.status === 'mismatch' ? ' <span class="pill mismatch">不一致</span>' : '') : '<span class="pill ' + (r.status === 'ok' ? 'none' : r.status === 'invalid' ? 'mismatch' : r.status) + '">' + VSTAT[r.status] + '</span>'; }
  function shortAt(t) { return t ? t.slice(5, 16).replace('-', '/') : ''; }
  function sessionLabel(s) {
    var done = (s.steps || []).filter(function (st) { return s.results && s.results[st.id] && s.results[st.id].confirmedAt; }).length;
    return (s.docTitle || s.docName) + '（確認 ' + done + '/' + (s.steps || []).length + '・' + (s.updatedAt ? new Date(s.updatedAt).toLocaleString('sv-SE').slice(0, 16) : '') + '）';
  }
  function drawValues() {
    var body = $('#jobBody');
    body.innerHTML = '<div class="card muted">集計しています…</div>';
    flushAll().then(function () { return Promise.all([Api.get('/api/jobs/' + J.job.id + '/values'), Api.get('/api/sop/sessions')]); }).then(function (res) {
      if (stale(body, 'values')) return;
      var v = res[0], sessions = res[1].items, sm = v.summary, only = G.valuesAll ? false : true;
      var proc = (G.lib.procedure || []).filter(function (m) { return m.id === J.job.procedure_id; })[0];
      sessions.sort(function (a, b) { var pa = proc && a.docName === proc.original_name ? 1 : 0, pb = proc && b.docName === proc.original_name ? 1 : 0; return pb - pa || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
      var cand = !J.job.sop_key && proc ? sessions.filter(function (s) { return s.docName === proc.original_name; })[0] : null;
      var bound = v.sop;
      var bindMsg = bound ? (bound.found ? '<span class="okc">紐付け済み：' + esc(bound.title) + '（確認 ' + bound.done + '/' + bound.total + '）</span>' : '<span class="err">紐付けた手順実行の記録が見つかりません（削除された可能性があります）</span>')
        : '<span class="muted">未紐付け。手順実行で入力した値（キーを設定した入力項目）を集約するには記録を選んでください。' + (cand ? '候補：「' + esc(cand.docTitle || cand.docName) + '」' : '') + '</span>';
      var rows = v.rows.filter(function (r) { return !only || r.entries.length; });
      body.innerHTML = '<div class="card"><div class="row spread"><h3>最終値の整合チェック</h3><div class="row"><span id="vlStat">' +
        '<span class="pill ' + (sm.mismatch ? 'mismatch' : 'none') + '">不一致 ' + sm.mismatch + '</span> <span class="pill ' + (sm.conflict ? 'mismatch' : 'none') + '">食い違い ' + sm.conflict + '</span> ' +
        '<span class="pill match">一致 ' + sm.match + '</span> <span class="pill missing">未入力 ' + sm.missing + '</span></span>' +
        '<button class="primary" id="vlPdf">作業入力値一覧 PDF</button></div></div>' +
        '<p class="muted">パラメータシートの期待値（要求値）、① 作業入力、③ 実測値、手順実行の入力値（キーを設定した項目）を同じキーでまとめ、最終値を ③ と同じ判定ルールで照合します。同じ項目に入力元ごとに異なる値があれば「食い違い」として赤く表示します。最終値は入力日時が最も新しい値です。</p>' +
        '<div class="vl-bind"><label class="nowrap" for="vlSop"><b>手順実行の記録</b></label><select id="vlSop"><option value="">（紐付けない）</option>' +
        sessions.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === J.job.sop_key ? ' selected' : '') + '>' + esc(sessionLabel(s)) + '</option>'; }).join('') + '</select>' +
        (cand ? '<button class="small" id="vlBindCand">候補を紐付ける</button>' : '') + '<span id="vlBindMsg">' + bindMsg + '</span></div>' +
        (sm.problems ? '<div class="vl-alert" id="vlAlert">⚠ 要確認 ' + sm.problems + ' 項目：' + esc(v.rows.filter(function (r) { return r.problem; }).slice(0, 6).map(function (r) { return r.label; }).join('、')) + (sm.problems > 6 ? ' ほか' : '') + '</div>' : (sm.entered ? '<div class="vl-okbar">✓ 要求値との不一致・入力値の食い違いはありません</div>' : '')) +
        '<div class="row spread" style="margin:10px 0 6px"><label class="nowrap"><input type="checkbox" id="vlOnly"' + (only ? ' checked' : '') + '> 入力のある項目だけ表示</label><span class="muted">' + rows.length + ' / ' + v.rows.length + ' 項目</span></div>' +
        '<div class="tscroll"><table class="t" id="vlTable"><tr><th class="w-item">項目 / キー</th><th>要求値</th><th>最終値</th><th>判定</th><th>入力元</th><th class="nowrap">入力日時</th><th class="w-ents">各入力元の値</th></tr>' +
        rows.map(function (r) {
          return '<tr data-vkey="' + esc(r.id) + '" class="' + (r.problem ? 'problem' : '') + '"><td lang="ja">' + esc(r.label) + (r.key && r.key !== r.label ? '<div class="mono muted keyline">' + esc(r.key) + '</div>' : '') + '</td>' +
            '<td class="mono brk" lang="ja">' + (r.has_expected ? esc(r.expected) : '<span class="muted">—</span>') + '</td><td class="brk final" lang="ja">' + esc(r.final) + '</td><td class="nowrap">' + vPill(r) +
            (r.errors.length ? '<div class="err">' + esc(r.errors.map(function (x) { return x.message; }).join('；')) + '</div>' : '') + '</td>' +
            '<td lang="ja" class="src">' + esc(r.final_source) + '</td><td class="nowrap muted">' + esc(shortAt(r.final_at)) + '</td>' +
            '<td class="ents">' + r.entries.map(function (e) { return '<div class="vl-ent' + (e.differs ? ' diff' : '') + '"><span class="src">' + esc(e.source) + '</span>：<b lang="ja">' + esc(e.value) + '</b>' + (e.judge === 'mismatch' ? ' <span class="pill mismatch">不一致</span>' : '') + (e.at ? ' <span class="muted">' + esc(shortAt(e.at)) + '</span>' : '') + '</div>'; }).join('') + '</td></tr>';
        }).join('') + '</table></div></div>';
      $('#vlOnly').addEventListener('change', function (e) { G.valuesAll = !e.target.checked; drawValues(); });
      function bind(key) { Api.put('/api/jobs/' + J.job.id, { sop_key: key || null }).then(function (r) { J.job = r.job; toast(key ? '手順実行の記録を紐付けました' : '紐付けを解除しました'); drawValues(); }).catch(fail); }
      $('#vlSop').addEventListener('change', function (e) { bind(e.target.value); });
      if (cand) $('#vlBindCand').addEventListener('click', function () { bind(cand.key); });
      $('#vlPdf').addEventListener('click', function (e) { makeValuesPdf(e.target); });
    }).catch(fail);
  }
  function makeValuesPdf(btn) {
    btn.disabled = true; toast('作業入力値一覧の PDF を作成しています…');
    flushAll().then(function () { return Api.post('/api/jobs/' + J.job.id + '/values.pdf', {}); }).then(function (r) {
      btn.disabled = false;
      if (r.pdf) {
        showModal({ title: '作業入力値一覧の PDF を作成しました', cls: 'info',
          html: '<p>' + esc(r.browser) + ' で A4 横の PDF を作成し、成果物と同じ出力フォルダに保存しました。</p><p class="mono muted brk">' + esc(r.dir) + '<br>' + esc(r.pdf) + '</p>',
          buttons: [{ label: 'PDF をダウンロード', cls: 'primary', href: Api.dl('/api/exports/' + encodeURIComponent(r.pdf)), download: true, value: 'dl' }, { label: '印刷用ページを開く', href: Api.dl('/api/jobs/' + J.job.id + '/values.html'), value: 'open' }, { label: '閉じる' }] });
        return;
      }
      showModal({ title: 'PDF を自動作成できませんでした', cls: 'info',
        html: '<p>' + esc(r.error || '') + '</p><p>印刷用ページを開き、「印刷 / PDF に保存」ボタンから PDF にしてください（用紙は A4 横に設定済み）。印刷用 HTML は出力フォルダにも保存しました：<br><span class="mono muted">' + esc(r.html) + '</span></p>',
        buttons: [{ label: '印刷用ページを開く', cls: 'primary', href: Api.dl('/api/jobs/' + J.job.id + '/values.html'), value: 'open' }, { label: '閉じる' }] });
    }).catch(function (e) { btn.disabled = false; fail(e); });
  }

  /* ---------- ⑤ 成果物出力 ---------- */
  function drawDeliver() {
    var body = $('#jobBody');
    if (!J.template) { body.innerHTML = '<div class="card muted">この作業には成果物テンプレートが設定されていません。</div>'; return; }
    Api.get('/api/jobs/' + J.job.id).then(function (v) {
      if (stale(body, 'deliver')) return;
      J.job = v.job; J.resolved = v.resolved;
      var filled = v.resolved.filter(function (r) { return r.kind !== 'none' && r.kind !== 'evidence' && String(r.value || '').trim(); }).length, evCells = v.resolved.filter(function (r) { return r.kind === 'evidence'; });
      body.innerHTML = '<div class="card"><div class="row spread"><h3>成果物出力</h3><div class="row"><button id="dvMap">マッピング編集</button><button id="dvPdf">作業入力値一覧 PDF</button><button class="primary" id="dvExport">成果物を出力 .xlsx</button></div></div>' +
        '<p class="muted">パラメータシートの値と作業入力をお客様テンプレートの該当セルに書き込みます。テンプレートの書式（フォント・塗りつぶし・罫線・セル結合・列幅・入力規則）はそのまま保持されます。「記入しない」セルは変更しません。出力後、個別の記述は Excel で手作業で編集してください。</p>' +
        '<p><b>' + filled + '</b> セルに書き込みます' + (v.errors ? '。<span class="err" style="font-size:14px">うち ' + v.errors + ' 項目がチェック NG です（出力は可能）</span>' : '') + '。</p>' +
        '<div class="ev-xlsx" id="dvEv"><label class="nowrap"><input type="checkbox" id="dvEvOn" disabled> 証跡画像を挿入する</label> <select id="dvEvSrc" disabled><option value="">（読み込み中…）</option></select>' +
        '<div class="muted">手順実行の記録から画像を取り出し、末尾に「証跡」シートを追加して手順ごとに貼り付けます。マッピングで取得元を「証跡画像（キー指定）」にしたセル' + (evCells.length ? '（' + evCells.length + ' 個）' : '') + 'には、そのキーの最初の画像を配置します。</div></div>' +
        '<div class="tscroll"><table class="t" id="dvTable"><tr><th>セル</th><th>項目</th><th>取得元</th><th>書き込む値</th><th>チェック</th></tr>' + v.resolved.map(function (r) {
          return '<tr><td class="mono nowrap">' + esc(r.sheet + '!' + r.cell) + '</td><td lang="ja">' + esc(r.label) + '</td><td><span class="pill ' + r.kind + '">' + ({ param: 'パラメータ ' + (r.key || ''), fixed: '固定値', input: '入力', none: '記入しない', evidence: '証跡画像 ' + (r.key || '') })[r.kind] + '</span></td><td lang="ja">' + esc(r.value) + '</td><td>' + (r.errors.length ? '<span class="err">' + esc(r.errors.map(function (x) { return x.message; }).join('；')) + '</span>' : (r.kind !== 'none' && r.kind !== 'evidence' && String(r.value || '').trim() ? '<span class="okc">✓</span>' : '')) + '</td></tr>';
        }).join('') + '</table></div></div>';
      Api.get('/api/sop/sessions').then(function (r) {
        if (stale(body, 'deliver') || !$('#dvEvSrc')) return;
        var proc = (G.lib && G.lib.procedure || []).filter(function (m) { return m.id === J.job.procedure_id; })[0];
        var items = r.items.map(function (s) { var n = 0; Object.keys(s.results || {}).forEach(function (k) { var im = s.results[k].images || {}; Object.keys(im).forEach(function (q) { n += (im[q] || []).length; }); }); return { s: s, n: n }; }).filter(function (x) { return x.n > 0; });
        items.sort(function (a, b) { var pa = proc && a.s.docName === proc.original_name ? 1 : 0, pb = proc && b.s.docName === proc.original_name ? 1 : 0; return pb - pa || String(b.s.updatedAt || '').localeCompare(String(a.s.updatedAt || '')); });
        var sel = $('#dvEvSrc'), on = $('#dvEvOn');
        sel.innerHTML = items.length ? items.map(function (x) { return '<option value="' + esc(x.s.key) + '">' + esc(x.s.docTitle || x.s.docName) + '（画像 ' + x.n + ' 枚・' + esc(x.s.updatedAt ? new Date(x.s.updatedAt).toLocaleString('sv-SE').slice(0, 16) : '') + '）</option>'; }).join('') : '<option value="">証跡画像のある手順実行の記録がありません</option>';
        if (J.job.sop_key && items.some(function (x) { return x.s.key === J.job.sop_key; })) sel.value = J.job.sop_key;   // 最終値チェックで紐付けた記録を既定に
        on.disabled = !items.length; sel.disabled = !items.length || !on.checked;
        on.addEventListener('change', function () { sel.disabled = !on.checked; });
      }).catch(fail);
      $('#dvPdf').addEventListener('click', function (e) { makeValuesPdf(e.target); });
      $('#dvExport').addEventListener('click', function () {
        var on = $('#dvEvOn'), src = $('#dvEvSrc') && $('#dvEvSrc').value;
        function go() { download('/api/jobs/' + J.job.id + '/deliverable.xlsx' + (on && on.checked && src ? '?sop=' + encodeURIComponent(src) : '')); toast('成果物を生成しています…'); }
        // 出力前に最終値の整合チェック：不一致・食い違いがあれば警告（そのまま出力も可能。止めはしない）
        flushAll().then(function () { return Api.get('/api/jobs/' + J.job.id + '/values'); }).then(function (v) {
          var probs = v.rows.filter(function (r) { return r.problem; });
          if (!probs.length) return go();
          return showModal({ title: '最終値に不一致・食い違いがあります', cls: 'warn',
            html: '<p>次の ' + probs.length + ' 項目は、要求値と一致しないか、入力元によって値が異なります。このまま成果物を出力しますか？</p><ul class="modal-list">' +
              probs.slice(0, 8).map(function (r) {
                return '<li><b lang="ja">' + esc(r.label) + '</b>：最終値 <span class="mono">' + esc(r.final) + '</span>' + (r.has_expected ? ' ／ 要求値 <span class="mono">' + esc(r.expected) + '</span>' : '') + ' ' + vPill(r) +
                  r.entries.filter(function (e) { return e.differs; }).map(function (e) { return '<div class="muted">≠ ' + esc(e.source) + '：' + esc(e.value) + '</div>'; }).join('') + '</li>';
              }).join('') + (probs.length > 8 ? '<li class="muted">ほか ' + (probs.length - 8) + ' 項目</li>' : '') + '</ul>',
            buttons: [{ label: 'このまま出力する', value: 'go', cls: 'danger' }, { label: '最終値チェックを開く', value: 'check', cls: 'primary' }, { label: 'キャンセル', value: '' }] }).then(function (a) {
            if (a === 'go') go();
            else if (a === 'check') { G.jobTab = 'values'; drawJob(); }
          });
        }).catch(fail);
      });
      $('#dvMap').addEventListener('click', function () { G.libView = { id: J.job.template_id }; setTab('library'); });
    }).catch(fail);
  }

  /* ================= 起動 ================= */
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });
  Api.get('/api/presets').then(function (r) { Rules.setPresets(r.presets, r.messages); }).catch(fail).then(function () { setTab(G.tab); });   // 読み込み中にユーザーが切り替えたタブを維持（競合で上書きしない）
  window.BA = { G: G, setTab: setTab, openJob: openJob, flush: function () { return flushAll(); } };
})();
