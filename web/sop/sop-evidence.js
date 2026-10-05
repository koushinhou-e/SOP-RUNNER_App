/* カスタム証跡画像（手順実行モジュールの v2 拡張）。
 * - 編集モード：任意の手順に「証跡画像」の要求（説明・キー付き、複数可）を追加
 * - 実行モード：貼り付け（Ctrl+V）／ドラッグ＆ドロップ／ファイル選択で画像を添付、サムネイル表示・削除・拡大
 * - 必要な画像が揃うまで「確認」ボタンは押せない（入力項目のチェックに追加）
 * - 画像ファイルはサーバの data/sop_images/ に保存し、セッション JSON にはメタデータのみ保持
 * - 要求の設定はテンプレートライブラリの手順書に保存し、同じ手順書を次に読み込んだときに再適用
 * - Word 実施記録に各手順の下へ説明付きで画像を埋め込む
 * sop-app.js（v1 から同期）へのフックは tools/sync_from_v1.py のパッチで挿入している。 */
(function () {
  'use strict';
  var pendingLibId = null, importLibId = null, lastFile = null, activeRid = null, saveTimer = null;
  function S() { return window.SopApp && SopApp.state(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rid() { return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function stepById(id) { var s = S(); for (var i = 0; i < s.steps.length; i++) if (s.steps[i].id === id) return s.steps[i]; return null; }
  function res(st) { var s = S(); return s.results[st.id] || (s.results[st.id] = { values: {}, note: '', anomaly: false, confirmedAt: null }); }
  function imgsOf(st, reqId) { var r = res(st); r.images = r.images || {}; return (r.images[reqId] = r.images[reqId] || []); }
  function imgUrl(id) { return Api.dl('/api/sop/images/' + encodeURIComponent(id)); }
  function say(m) { if (window.toast) toast(m); }

  /* ---------- テンプレートライブラリとの連携（設定の保存・再適用） ---------- */
  function settingsOf(s) {
    var steps = [];
    s.steps.forEach(function (st, i) {
      var keys = (st.inputs || []).filter(function (inp) { return String(inp.key || '').trim(); }).map(function (inp) { return { label: inp.label, key: String(inp.key).trim() }; });
      if ((st.evidence && st.evidence.length) || keys.length) steps.push({ index: i, title: st.title, items: (st.evidence || []).map(function (e) { return { id: e.id, desc: e.desc || '', key: e.key || '' }; }), inputKeys: keys });
    });
    return { docHash: s.hash, docName: s.docName, steps: steps, updated: new Date().toISOString() };
  }
  function applySettings(s, ev) {
    if (!ev || !ev.steps) return 0;
    var used = {}, n = 0;
    ev.steps.forEach(function (x) {
      var idx = -1;
      for (var i = 0; i < s.steps.length; i++) if (!used[i] && s.steps[i].title === x.title) { idx = i; if (i === x.index) break; }
      if (idx < 0 && s.steps[x.index] && !used[x.index]) idx = x.index;
      if (idx < 0) return;
      used[idx] = 1;
      s.steps[idx].evidence = (x.items || []).map(function (e) { return { id: e.id || rid(), desc: e.desc || '', key: e.key || '' }; });
      n += (x.items || []).length;
      var taken = {};
      (x.inputKeys || []).forEach(function (k) {   // 入力項目のパラメータキー（同じラベルの入力項目に適用）
        var inps = s.steps[idx].inputs || [];
        for (var j = 0; j < inps.length; j++) if (!taken[j] && inps[j].label === k.label) { taken[j] = 1; inps[j].key = k.key; n++; break; }
      });
    });
    return n;
  }
  function persistSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var s = S(); if (!s || !s.libId) { updateLibNote(); return; }
      Api.put('/api/library/' + s.libId, { evidence: settingsOf(s) }).then(function () { updateLibNote('saved'); }).catch(function (e) { say('証跡設定を保存できませんでした：' + e.message); });
    }, 400);
  }
  function countReqs(s) { return s.steps.reduce(function (a, st) { return a + ((st.evidence || []).length); }, 0); }
  function libNoteHtml(state) {
    var s = S(), n = countReqs(s);
    var nk = s.steps.reduce(function (a, st) { return a + (st.inputs || []).filter(function (inp) { return String(inp.key || '').trim(); }).length; }, 0);
    var head = '<b>証跡画像・キーの設定</b> <span class="muted">証跡画像の要求 ' + n + ' 件・キー設定済みの入力項目 ' + nk + ' 件</span> ';
    if (s.libId) return head + '<span class="okc">テンプレートライブラリの手順書「' + esc(s.libName || '') + '」に' + (state === 'saved' ? '保存しました' : '自動保存されます') + '。同じ手順書を次に読み込むと再適用されます。</span>';
    return head + '<span class="muted">この手順書はテンプレートライブラリに未登録のため、設定はこの進捗にのみ保存されます。</span> ' +
      (lastFile ? '<button class="small primary" data-ev="register">ライブラリに登録して設定を保存</button>' : '<span class="muted">（ライブラリから開き直すと保存できます）</span>');
  }
  function updateLibNote(state) { var el = document.getElementById('evLibNote'); if (el) el.innerHTML = libNoteHtml(state); }

  /* ---------- 画像のアップロード ---------- */
  function upload(st, reqId, files) {
    var list = [].filter.call(files || [], function (f) { return /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name || ''); });
    if (!list.length) { say('PNG または JPEG の画像を指定してください'); return Promise.resolve(); }
    if (res(st).confirmedAt) return Promise.resolve();
    return list.reduce(function (p, f) {
      return p.then(function () {
        return fetch('/api/sop/images', { method: 'POST', headers: { 'X-Token': Api.token, 'Content-Type': f.type || 'application/octet-stream' }, body: f })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
          .then(function (meta) {
            meta.name = f.name && f.name !== 'image.png' ? f.name : ('clipboard-' + new Date().toLocaleString('sv-SE').replace(/\D/g, '').slice(0, 14) + '.' + meta.ext);
            meta.addedAt = new Date().toISOString();
            imgsOf(st, reqId).push(meta);
          });
      });
    }, Promise.resolve()).then(function () { SopApp.save(); redrawRun(st); SopApp.refreshGate(); say('証跡画像を添付しました'); })
      .catch(function (e) { say('画像を保存できませんでした：' + e.message); });
  }

  /* ---------- 描画 ---------- */
  var keyOpts = null;   // 入力項目のキー候補（パラメータシートのキー・成果物テンプレートの項目キー）
  function keyListHtml() { return (keyOpts || []).map(function (o) { return '<option value="' + esc(o.key) + '">' + esc(o.label) + '</option>'; }).join(''); }
  function loadKeyOpts() {
    Promise.all([Api.get('/api/library?type=param_sheet'), Api.get('/api/library?type=excel_template')]).then(function (r) {
      var seen = {}, out = [];
      r[0].items.forEach(function (m) { ((m.parsed || {}).params || []).forEach(function (p) { if (!seen[p.key]) { seen[p.key] = 1; out.push({ key: p.key, label: p.label + '（パラメータ）' }); } }); });
      r[1].items.forEach(function (m) { (m.items || []).forEach(function (it) { if (it.key && /^[A-Za-z0-9_.-]+$/.test(it.key) && !seen[it.key] && (it.source || {}).kind === 'input') { seen[it.key] = 1; out.push({ key: it.key, label: it.label + '（作業入力）' }); } }); });
      keyOpts = out; var dl = document.getElementById('sopKeyList'); if (dl) dl.innerHTML = keyListHtml();
    }).catch(function () { keyOpts = []; });
  }
  function editHeader() {
    if (!keyOpts) loadKeyOpts();
    return '<div class="card ev-libnote" id="evLibNote">' + libNoteHtml() + '</div><datalist id="sopKeyList">' + keyListHtml() + '</datalist>';
  }
  function editExtra(st) {
    var ev = st.evidence || [];
    return '<div class="full ev-edit"><div class="lbl">証跡画像（' + ev.length + '）</div>' +
      ev.map(function (e) {
        return '<div class="row ev-req"><span class="ev-ico">🖼</span><input type="text" class="ev-desc" data-evdesc="desc" data-sid="' + st.id + '" data-rid="' + e.id + '" value="' + esc(e.desc) + '" placeholder="説明（例：EC2 詳細画面のスクリーンショット）" lang="ja">' +
          '<input type="text" class="ev-key mono" data-evdesc="key" data-sid="' + st.id + '" data-rid="' + e.id + '" value="' + esc(e.key) + '" placeholder="キー（任意・Excel 用）" title="成果物テンプレートのマッピング「証跡画像」で使うキー（例：img_ec2）">' +
          '<button class="small danger" data-ev="delReq" data-sid="' + st.id + '" data-rid="' + e.id + '" title="この証跡画像の要求を削除">✕</button></div>';
      }).join('') +
      '<button class="small" data-ev="addReq" data-sid="' + st.id + '" style="margin-top:6px">＋ 証跡画像を要求</button></div>';
  }
  function runBox(st) {
    var ev = st.evidence || [], r = res(st), confirmed = !!r.confirmedAt;
    if (!ev.length) return '';
    var h = '<div class="lbl">証跡画像（' + ev.length + ' 件）</div><div class="ev-run" id="evRun" data-sid="' + st.id + '">';
    ev.forEach(function (e, k) {
      var imgs = imgsOf(st, e.id), ok = imgs.length > 0;
      h += '<div class="ev-box' + (ok ? ' ok' : '') + (activeRid === e.id ? ' active' : '') + '" data-rid="' + e.id + '">' +
        '<div class="ev-h"><span lang="ja"><b>' + (k + 1) + '. ' + esc(e.desc || '証跡画像') + '</b>' + (e.key ? ' <span class="muted mono">[' + esc(e.key) + ']</span>' : '') + '</span>' +
        '<span class="' + (ok ? 'okc' : 'req') + '">' + (ok ? '✓ ' + imgs.length + ' 枚' : '* 未添付') + '</span></div>' +
        '<div class="ev-thumbs">' + imgs.map(function (m) {
          return '<figure class="ev-th"><img src="' + imgUrl(m.id) + '" alt="' + esc(m.name) + '" data-ev="zoom" data-img="' + m.id + '" title="クリックで拡大：' + esc(m.name) + '（' + m.w + '×' + m.h + '）">' +
            (confirmed ? '' : '<button class="small danger" data-ev="delImg" data-rid="' + e.id + '" data-img="' + m.id + '" title="削除">✕</button>') + '<figcaption>' + esc(m.name) + '</figcaption></figure>';
        }).join('') + '</div>' +
        (confirmed ? '' : '<div class="ev-drop" data-rid="' + e.id + '" tabindex="0">ここに画像をドロップ、またはクリックして Ctrl+V で貼り付け　<button class="small" data-ev="pick" data-rid="' + e.id + '">ファイルを選択</button>' +
          '<input type="file" class="hidden" accept="image/png,image/jpeg" multiple data-evfile="' + e.id + '"></div>') +
        '</div>';
    });
    return h + '</div>';
  }
  function redrawRun(st) {
    var el = document.getElementById('evRun');
    if (!el || el.getAttribute('data-sid') !== st.id) return;
    var tmp = document.createElement('div'); tmp.innerHTML = runBox(st);
    el.parentNode.replaceChild(tmp.querySelector('#evRun'), el);
  }
  function missingExtra(st) {
    return (st.evidence || []).filter(function (e) { return !imgsOf(st, e.id).length; }).map(function (e) { return { label: '証跡画像「' + (e.desc || '説明なし') + '」' }; });
  }
  function zoom(id, name) {
    var o = document.createElement('div'); o.className = 'ev-zoom'; o.id = 'evZoom';
    o.innerHTML = '<img src="' + imgUrl(id) + '" alt=""><div class="ev-zoom-cap">' + esc(name || '') + '　（クリックまたは Esc で閉じる）</div>';
    o.addEventListener('click', function () { o.remove(); });
    document.body.appendChild(o);
  }
  function currentRunStep() { var s = S(); return s && s.phase !== 'edit' && typeof s.view === 'number' ? s.steps[s.view] : null; }
  function targetReq(st) {
    var ev = st.evidence || [];
    if (activeRid && ev.some(function (e) { return e.id === activeRid; })) return activeRid;
    var empty = ev.filter(function (e) { return !imgsOf(st, e.id).length; })[0];
    return (empty || ev[0] || {}).id;
  }

  /* ---------- イベント ---------- */
  function setup() {
    var app = document.getElementById('sop-app');
    app.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ev]'), box = e.target.closest('.ev-box');
      if (box) { activeRid = box.getAttribute('data-rid'); [].forEach.call(app.querySelectorAll('.ev-box'), function (x) { x.classList.toggle('active', x === box); }); }
      if (!b) return;
      var s = S(), act = b.getAttribute('data-ev'), st = b.getAttribute('data-sid') ? stepById(b.getAttribute('data-sid')) : currentRunStep(), r = b.getAttribute('data-rid');
      if (act === 'addReq') { st.evidence = (st.evidence || []).concat([{ id: rid(), desc: '', key: '' }]); SopApp.save(); SopApp.render(); persistSettings(); setTimeout(function () { var ins = app.querySelectorAll('input.ev-desc[data-sid="' + st.id + '"]'); if (ins.length) ins[ins.length - 1].focus(); }, 0); }
      else if (act === 'delReq') { st.evidence = (st.evidence || []).filter(function (x) { return x.id !== r; }); SopApp.save(); SopApp.render(); persistSettings(); }
      else if (act === 'pick') { e.preventDefault(); var f = app.querySelector('input[data-evfile="' + r + '"]'); if (f) f.click(); }
      else if (act === 'delImg') {
        var id = b.getAttribute('data-img'), list = imgsOf(st, r);
        if (res(st).confirmedAt) return;
        res(st).images[r] = list.filter(function (m) { return m.id !== id; });
        Api.del('/api/sop/images/' + encodeURIComponent(id)).catch(function () { });
        SopApp.save(); redrawRun(st); SopApp.refreshGate();
      } else if (act === 'zoom') zoom(b.getAttribute('data-img'), b.getAttribute('alt'));
      else if (act === 'register') {
        if (!lastFile) return;
        Api.upload('procedure', lastFile).then(function (m) { s.libId = m.id; s.libName = m.name; SopApp.save(); persistSettings(); say('テンプレートライブラリに登録しました：' + m.name); }).catch(function (er) { say('登録できませんでした：' + er.message); });
      }
    });
    app.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-inped') === 'key') { persistSettings(); return; }   // 値の保存は sop-app 側（data-inped）
      var t = e.target; if (!t.hasAttribute('data-evdesc')) return;
      var st = stepById(t.getAttribute('data-sid')), it = (st.evidence || []).filter(function (x) { return x.id === t.getAttribute('data-rid'); })[0];
      if (!it) return;
      it[t.getAttribute('data-evdesc')] = t.value; SopApp.save(); persistSettings();
    });
    app.addEventListener('change', function (e) {
      var t = e.target; if (!t.hasAttribute('data-evfile')) return;
      var st = currentRunStep(); if (st) upload(st, t.getAttribute('data-evfile'), t.files).then(function () { t.value = ''; });
    });
    app.addEventListener('dragover', function (e) { var d = e.target.closest('.ev-drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
    app.addEventListener('dragleave', function (e) { var d = e.target.closest('.ev-drop'); if (d) d.classList.remove('over'); });
    app.addEventListener('drop', function (e) {
      var d = e.target.closest('.ev-drop'); if (!d) return;
      e.preventDefault(); e.stopPropagation(); d.classList.remove('over');
      var st = currentRunStep(); if (st && e.dataTransfer) { activeRid = d.getAttribute('data-rid'); upload(st, activeRid, e.dataTransfer.files); }
    });
    document.addEventListener('paste', function (e) {
      if (app.offsetParent === null) return;
      var st = currentRunStep(); if (!st || !(st.evidence || []).length || res(st).confirmedAt) return;
      var cd = e.clipboardData; if (!cd) return;
      var files = [].slice.call(cd.files || []);
      if (!files.length && cd.items) [].forEach.call(cd.items, function (it) { if (it.kind === 'file') { var f = it.getAsFile(); if (f) files.push(f); } });
      files = files.filter(function (f) { return /^image\/(png|jpeg)$/.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      upload(st, targetReq(st), files);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var z = document.getElementById('evZoom'); if (z) z.remove(); } });
  }

  /* ---------- Word 実施記録への埋め込み ---------- */
  var EMU_PER_PX = 9525, EMU_PER_TWIP = 635;
  function drawingXml(rId, n, cx, cy, name, descr) {
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="' + n + '" name="証跡画像 ' + n + '" descr="' + Ox.esc(descr) + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + n + '" name="' + Ox.esc(name) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  function exportDocx(s) {
    var jobs = [], media = {}, rels = [], n = 0;
    s.steps.forEach(function (st, i) {
      var r = s.results[st.id] || {};
      (st.evidence || []).forEach(function (e) {
        ((r.images || {})[e.id] || []).forEach(function (m) { jobs.push({ step: i, req: e, meta: m }); });
      });
    });
    return Promise.all(jobs.map(function (j) {
      return Api.blob('/api/sop/images/' + encodeURIComponent(j.meta.id)).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { j.data = new Uint8Array(buf); }).catch(function () { j.data = null; });
    })).then(function () {
      var byStep = {};
      jobs.forEach(function (j) {
        if (!j.data) return;
        n++;
        var ext = j.meta.ext === 'jpg' ? 'jpeg' : 'png', file = 'evidence' + n + '.' + ext, rId = 'rIdEv' + n;
        media['word/media/' + file] = j.data;
        rels.push('<Relationship Id="' + rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + file + '"/>');
        (byStep[j.step] = byStep[j.step] || []).push({ rId: rId, n: n, j: j, file: file });
      });
      window.ExportHooks = {
        stepRows: function (row, W, L) {
          var list = byStep[row.no - 1] || [], total = W.reduce(function (a, c) { return a + c; }, 0);
          var maxW = (total - 160) * EMU_PER_TWIP, maxH = 8600 * EMU_PER_TWIP;   // 表の内幅（A4 横）、1 ページに収まる高さ
          return list.map(function (x, k) {
            var w = (x.j.meta.w || 800) * EMU_PER_PX, h = (x.j.meta.h || 600) * EMU_PER_PX, sc = Math.min(maxW / w, maxH / h);
            var cx = Math.round(w * sc), cy = Math.round(h * sc);
            var cap = '証跡 ' + row.no + '-' + (k + 1) + '：' + (x.j.req.desc || '（説明なし）') + (x.j.req.key ? ' [' + x.j.req.key + ']' : '') + '　' + (x.j.meta.name || '');
            return '<w:tc><w:tcPr><w:tcW w:w="' + total + '" w:type="dxa"/><w:gridSpan w:val="' + W.length + '"/></w:tcPr>' +
              Ox.p(Ox.run(cap, { size: 16, bold: true, color: '1F4E79' }), { before: 40 }) +
              '<w:p><w:pPr><w:spacing w:before="0" w:after="60"/><w:jc w:val="center"/></w:pPr>' + drawingXml(x.rId, 1000 + x.n, cx, cy, x.file, cap) + '</w:p></w:tc>';
          });
        }
      };
      try {
        var record = RecordModel.build(s), L = ExportLabels.ja;
        var parts = ExportTemplates['simple-table'].render(record, L);
        Object.keys(media).forEach(function (k) { parts[k] = media[k]; });
        return DocxWriter.pack(parts, {
          title: record.docTitle + ' - ' + L.title, creator: record.executor,
          extend: function (d) {
            d['word/_rels/document.xml.rels'] = d['word/_rels/document.xml.rels'].replace('</Relationships>', rels.join('') + '</Relationships>');
            d['[Content_Types].xml'] = d['[Content_Types].xml'].replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="xml"');
          }
        });
      } finally { window.ExportHooks = null; }
    });
  }

  /* ---------- フック登録 ---------- */
  var H = window.SopHooks = window.SopHooks || {};
  H.onImport = function (file) { lastFile = file; importLibId = pendingLibId; pendingLibId = null; };
  H.afterParse = function (s) {
    var libId = importLibId; importLibId = null;
    var p = libId ? Api.get('/api/library/' + libId).then(function (m) { return [m]; }) : Api.get('/api/library?type=procedure').then(function (r) { return r.items; });
    p.then(function (items) {
      var m = items.filter(function (x) { return x.id === libId || (x.evidence && x.evidence.docHash === s.hash); })[0];
      if (!m || S() !== s) return;
      s.libId = m.id; s.libName = m.name;
      var n = applySettings(s, m.evidence);
      SopApp.save(); SopApp.render();
      if (n) say('ライブラリの証跡画像・キー設定を適用しました（' + n + ' 件）');
    }).catch(function () { });
  };
  H.editHeader = editHeader;
  H.editExtra = editExtra;
  H.runExtra = function (st) { return runBox(st); };
  H.missingExtra = function (st) { return missingExtra(st); };
  window.SopEvidence = { exportDocx: exportDocx, openFromLibrary: function (id) { pendingLibId = id; }, settingsOf: settingsOf, applySettings: applySettings };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
