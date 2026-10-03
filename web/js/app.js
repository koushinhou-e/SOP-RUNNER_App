/* 构建作业助手 v2 —— 主界面（模板库 / 作业 / 手顺执行）。原生 JS，无框架、无外部资源。 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1800); }
  window.toast = toast;
  function fail(e) { console.error(e); alert('出错：' + (e && e.message || e)); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function copyText(t) {
    function fb() { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb); else fb();
    toast('已复制：' + (t.length > 50 ? t.slice(0, 50) + '…' : t));
  }
  function download(url) { var a = document.createElement('a'); a.href = Api.dl(url); a.download = ''; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500); }
  var TYPE_NAMES = { excel_template: '交付物模板 (.xlsx)', param_sheet: '参数表 (.xlsx)', procedure: '手顺书 (.docx)', command_set: '命令模板集' };
  var ITYPES = { text: '文本', number: '数字', dropdown: '下拉', date: '日期' };
  var REASONS = { placeholder: '占位符', validation: '数据验证', highlight: '底色', label: '标签旁空格', manual: '手动' };

  var G = { tab: 'library', lib: {}, libView: null, jobId: null, jobTab: 'inputs', jobs: [], presets: {} };

  /* ================= 标签页 ================= */
  function setTab(t) {
    G.tab = t;
    $$('#nav [data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    $$('.tab').forEach(function (s) { s.classList.toggle('hidden', s.id !== 'tab-' + t); });
    if (t === 'library') renderLibrary();
    if (t === 'jobs') renderJobs();
  }
  $('#nav').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) setTab(b.getAttribute('data-tab')); });
  $('#btnQuit').addEventListener('click', function () {
    if (!confirm('停止本机服务？（数据已保存在 data 文件夹）')) return;
    var p = window.SopStore ? SopStore.flush() : Promise.resolve();
    p.then(function () { return Api.post('/api/shutdown'); }).then(function () { document.body.innerHTML = '<p style="padding:40px;font-size:18px">已停止。可以关闭此页面。</p>'; });
  });

  function loadLib() { return Api.get('/api/library').then(function (r) { G.lib = { excel_template: [], param_sheet: [], procedure: [], command_set: [] }; r.items.forEach(function (m) { (G.lib[m.type] = G.lib[m.type] || []).push(m); }); }); }
  function libName(id) { var all = [].concat(G.lib.excel_template || [], G.lib.param_sheet || [], G.lib.procedure || [], G.lib.command_set || []); var m = all.filter(function (x) { return x.id === id; })[0]; return m ? m.name : (id ? '（已删除）' : '—'); }

  /* ================= 模板库 ================= */
  function renderLibrary() {
    var el = $('#library');
    ED = null; CE = null;
    if (G.libView) return renderLibItem(el);
    loadLib().then(function () {
      var h = '<div class="card"><div class="row spread"><h3>模板库</h3><div class="row"><button id="btnSamples">加载示例数据（虚构）</button></div></div>' +
        '<div class="uploads">' + upCard('excel_template', '交付物模板', '.xlsx', '客户的输出模板，自动检测要填写的单元格') + upCard('param_sheet', '参数表', '.xlsx', '键/期待值（可多台服务器列）') +
        upCard('procedure', '手顺书', '.docx', '在「手顺执行」中逐步执行') +
        '<div class="up" id="upCmd"><h4>命令模板集</h4><p class="muted">{{param}} 占位符的只读确认命令</p><button data-act="newCmdSet">新建（含示例命令）</button> <button data-act="pickCmdJson">导入 JSON</button><input type="file" accept=".json,application/json" class="hidden" id="cmdJson"></div></div></div>';
      ['excel_template', 'param_sheet', 'procedure', 'command_set'].forEach(function (t) {
        var list = G.lib[t] || [];
        h += '<div class="card"><h3>' + TYPE_NAMES[t] + ' <span class="muted">(' + list.length + ')</span></h3>';
        if (!list.length) h += '<p class="muted">暂无</p>';
        else h += '<div class="tscroll"><table class="t lib-' + t + '"><tr><th>名称</th><th>文件</th><th>概要</th><th>更新</th><th></th></tr>' + list.map(function (m) {
          return '<tr data-id="' + m.id + '"><td lang="ja"><b>' + esc(m.name) + '</b></td><td class="muted" lang="ja">' + esc(m.original_name || '') + '</td><td>' + esc(summary(m)) + '</td><td class="nowrap muted">' + esc((m.updated || '').replace('T', ' ')) + '</td><td class="nowrap right">' +
            (t === 'procedure' ? '<button class="small primary" data-act="openSop" data-id="' + m.id + '">在手顺执行中打开</button> ' : '<button class="small primary" data-act="openItem" data-id="' + m.id + '">' + (t === 'param_sheet' ? '查看' : '编辑') + '</button> ') +
            '<button class="small" data-act="rename" data-id="' + m.id + '">重命名</button> <button class="small danger" data-act="delItem" data-id="' + m.id + '">删除</button></td></tr>';
        }).join('') + '</table></div>';
        h += '</div>';
      });
      el.innerHTML = h;
      $$('.up[data-type]', el).forEach(bindUpload);
      $('#cmdJson').addEventListener('change', function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        f.text().then(function (t) {
          var o = JSON.parse(t); if (!o || !Array.isArray(o.templates)) throw new Error('JSON 需要 {"name": "...", "templates": [...]} 格式');
          return Api.post('/api/library/command_set', { name: o.name || f.name.replace(/\.json$/i, ''), templates: o.templates });
        }).then(function (m) { toast('已导入命令模板集：' + m.name); renderLibrary(); }).catch(fail);
      });
    }).catch(fail);
  }
  function upCard(type, title, ext, desc) {
    return '<div class="up" data-type="' + type + '"><h4>' + title + ' <span class="muted">' + ext + '</span></h4><p class="muted">' + desc + '</p><button data-act="pick">选择文件</button> <span class="muted">或拖放到这里</span><input type="file" accept="' + ext + '" class="hidden"></div>';
  }
  function summary(m) {
    if (m.type === 'excel_template') { var it = m.items || []; return '检测项 ' + it.length + '，映射到参数 ' + it.filter(function (x) { return (x.source || {}).kind === 'param'; }).length; }
    if (m.type === 'param_sheet') { var p = m.parsed || {}; return '参数 ' + (p.params || []).length + ' × 服务器 ' + (p.servers || []).join(', '); }
    if (m.type === 'command_set') return '命令 ' + (m.templates || []).length + ' 条';
    if (m.type === 'procedure') return Math.round((m.size || 0) / 1024) + ' KB';
    return '';
  }
  function bindUpload(box) {
    var type = box.getAttribute('data-type'), inp = $('input[type=file]', box);
    function go(f) {
      if (!f) return;
      toast('上传中：' + f.name);
      Api.upload(type, f).then(function (m) { toast('已导入：' + m.name); if (type === 'excel_template') { G.libView = { id: m.id }; } renderLibrary(); }).catch(fail);
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
      var cur = $('tr[data-id="' + id + '"] b').textContent, n = prompt('新名称', cur);
      if (n && n.trim()) Api.put('/api/library/' + id, { name: n.trim() }).then(function () { toast('已重命名'); renderLibrary(); }).catch(fail);
    } else if (act === 'delItem') {
      if (confirm('从模板库删除？（文件也会删除，不可恢复）')) Api.del('/api/library/' + id).then(function () { toast('已删除'); renderLibrary(); }).catch(fail);
    } else if (act === 'newCmdSet') {
      Api.post('/api/library/command_set', { name: '命令模板集 ' + new Date().toLocaleDateString(), templates: SAMPLE_CMDS }).then(function (m) { G.libView = { id: m.id }; renderLibrary(); }).catch(fail);
    } else if (act === 'pickCmdJson') { $('#cmdJson').click();
    } else if (act === 'openSop') {
      openProcedure(id);
    } else if (act === 'backLib') { G.libView = null; renderLibrary(); }
  });
  $('#library').addEventListener('click', function (e) { if (e.target.id === 'btnSamples') Api.post('/api/samples').then(function (r) { toast('已加载 ' + r.items.length + ' 个示例'); renderLibrary(); }).catch(fail); });

  var SAMPLE_CMDS = [
    { title: 'インスタンス基本情報', kind: 'aws', checks: 'instance_type', template: "aws ec2 describe-instances --region {{region}} --instance-ids {{instance_id}} --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name]' --output text --no-cli-pager" },
    { title: 'メモリ (GiB)', kind: 'linux', checks: 'memory_gib', template: "ssh -n -o BatchMode=yes -o ConnectTimeout=10 {{ssh_user}}@{{private_ip}} 'free -g'" }
  ];

  function openProcedure(id) {
    Api.get('/api/library/' + id).then(function (m) {
      return Api.blob('/api/library/' + id + '/file').then(function (b) {
        setTab('sop');
        SopApp.importFile(new File([b], m.original_name || (m.name + '.docx'), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      });
    }).catch(fail);
  }
  window.SopHooks = {
    afterHome: function (appEl) {
      var box = document.createElement('div'); box.className = 'card'; box.id = 'sop-lib';
      box.innerHTML = '<b>从模板库打开手顺书</b> <span class="muted">加载中…</span>';
      var drop = appEl.querySelector('#drop'); appEl.insertBefore(box, drop ? drop.nextSibling : null);
      Api.get('/api/library?type=procedure').then(function (r) {
        box.innerHTML = '<b>从模板库打开手顺书</b>' + (r.items.length ? '<table class="t" style="margin-top:6px">' + r.items.map(function (m) { return '<tr><td lang="ja">' + esc(m.name) + '</td><td class="right"><button class="small primary" data-open-proc="' + m.id + '">打开</button></td></tr>'; }).join('') + '</table>' : '<p class="muted">模板库中还没有手顺书。</p>');
        $$('[data-open-proc]', box).forEach(function (b) { b.addEventListener('click', function () { openProcedure(b.getAttribute('data-open-proc')); }); });
      });
    }
  };

  /* ---------- 单个库项目 ---------- */
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
    el.innerHTML = '<div class="card"><div class="row spread"><h3 lang="ja">参数表：' + esc(m.name) + '</h3><button data-act="backLib">← 返回模板库</button></div>' +
      '<p class="muted">工作表「' + esc(p.sheet) + '」，表头第 ' + p.header_row + ' 行；服务器列：' + esc(p.servers.join(', ')) + '</p>' +
      '<div class="tscroll"><table class="t" id="paramTable" lang="ja"><tr><th>区分</th><th>项目</th><th>键</th>' + p.servers.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '</tr>' +
      p.params.map(function (x) { return '<tr><td>' + esc(x.category) + '</td><td>' + esc(x.label) + '</td><td class="mono">' + esc(x.key) + '</td>' + p.servers.map(function (s) { return '<td>' + esc(x.values[s]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div></div>';
  }

  /* ---------- 交付物模板编辑器（检测项 + 规则 + 映射） ---------- */
  var ED = null;
  function renderTemplateEditor(el, m) {
    ED = { m: m, items: JSON.parse(JSON.stringify(m.items || [])), paramRef: m.param_ref || '', params: [], sheets: null, sheet: 0, sel: null, dirty: false };
    var p1 = ED.paramRef ? Api.get('/api/library/' + ED.paramRef).then(function (ps) { ED.params = ps.parsed.params; }).catch(function () { ED.paramRef = ''; }) : Promise.resolve();
    Promise.all([p1, Api.get('/api/library/' + m.id + '/preview').then(function (r) { ED.sheets = r.sheets; })]).then(function () { drawEditor(el); }).catch(fail);
  }
  function srcValue(it) { var s = it.source || { kind: 'input' }; return s.kind === 'param' ? 'param:' + s.key : s.kind; }
  function drawEditor(el) {
    var m = ED.m, presets = Rules.presets();
    var psOpts = '<option value="">（不参照）</option>' + (G.lib.param_sheet || []).map(function (p) { return '<option value="' + p.id + '"' + (p.id === ED.paramRef ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    var h = '<div class="card"><div class="row spread"><h3 lang="ja">交付物模板：' + esc(m.name) + ' <span class="muted">' + esc(m.original_name || '') + '</span></h3>' +
      '<div class="row"><button data-act="backLib">← 返回</button><button class="primary" id="edSave">保存</button></div></div>' +
      '<div class="row"><label>参照参数表 <select id="edParam">' + psOpts + '</select></label><button id="edAuto">按标签自动映射</button><button id="edRedetect">重新检测</button>' +
      '<span class="muted" id="edStat"></span></div>' +
      '<p class="muted">黄色 = 作业输入，蓝色 = 参数表值，灰色 = 不填（交付后手动编辑）。点击网格单元格可定位或添加检测项。</p>';
    if (ED.sheets && ED.sheets.length) {
      h += '<div class="row" style="margin:6px 0">' + ED.sheets.map(function (s, i) { return '<button class="small' + (i === ED.sheet ? ' primary' : '') + '" data-sheet="' + i + '">' + esc(s.name) + '</button>'; }).join('') + '</div>';
      h += '<div class="grid-prev" id="gridPrev">' + gridHtml(ED.sheets[ED.sheet]) + '</div>';
    }
    h += '</div><div class="card"><div class="row spread"><h3>检测项 / 映射 <span class="muted" id="edCount"></span></h3><button id="edAdd">＋ 添加项</button></div>' +
      '<div class="tscroll"><table class="t" id="itemTable"><tr><th>单元格</th><th style="min-width:180px">标签</th><th>来源(检测)</th><th>类型</th><th style="min-width:110px">选项(逗号)</th><th>必填</th><th>格式</th><th>正则</th><th>最小</th><th>最大</th><th style="min-width:170px">填充来源（映射）</th><th>固定值</th><th></th></tr>' +
      ED.items.map(function (it, i) {
        var r = it.rules || {}, sv = srcValue(it);
        var srcOpts = '<option value="input"' + (sv === 'input' ? ' selected' : '') + '>作业输入</option><option value="none"' + (sv === 'none' ? ' selected' : '') + '>不填（手动）</option><option value="fixed"' + (sv === 'fixed' ? ' selected' : '') + '>固定值</option>';
        var keys = ED.params.map(function (p) { return p.key; });
        if (sv.indexOf('param:') === 0 && keys.indexOf(sv.slice(6)) < 0) srcOpts += '<option value="' + esc(sv) + '" selected>参数: ' + esc(sv.slice(6)) + '</option>';
        srcOpts += ED.params.map(function (p) { return '<option value="param:' + esc(p.key) + '"' + (sv === 'param:' + p.key ? ' selected' : '') + '>参数: ' + esc(p.label) + ' (' + esc(p.key) + ')</option>'; }).join('');
        return '<tr data-i="' + i + '"' + (ED.sel === it.id ? ' class="sel"' : '') + '><td class="mono nowrap">' + esc(it.sheet) + '!' + '<input type="text" data-f="cell" value="' + esc(it.cell) + '" style="width:58px"></td>' +
          '<td><input type="text" data-f="label" value="' + esc(it.label) + '" lang="ja"></td><td class="muted nowrap">' + esc(REASONS[it.reason] || it.reason || '') + '</td>' +
          '<td><select data-f="type">' + Object.keys(ITYPES).map(function (k) { return '<option value="' + k + '"' + (it.type === k ? ' selected' : '') + '>' + ITYPES[k] + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="text" data-f="options" value="' + esc((it.options || []).join(',')) + '" lang="ja"></td>' +
          '<td><input type="checkbox" data-f="required"' + (r.required ? ' checked' : '') + '></td>' +
          '<td><select data-f="preset"><option value="">—</option>' + Object.keys(presets).map(function (k) { return '<option value="' + k + '"' + (r.preset === k ? ' selected' : '') + '>' + esc(presets[k].label) + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="text" data-f="pattern" value="' + esc(r.pattern || '') + '" class="mono" style="width:90px"></td>' +
          '<td><input type="text" data-f="min" value="' + esc(r.min == null ? '' : r.min) + '" style="width:50px"></td><td><input type="text" data-f="max" value="' + esc(r.max == null ? '' : r.max) + '" style="width:50px"></td>' +
          '<td><select data-f="source">' + srcOpts + '</select></td><td><input type="text" data-f="fixed" value="' + esc((it.source || {}).value || '') + '" ' + (sv === 'fixed' ? '' : 'disabled') + ' style="width:90px"></td>' +
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
    var s = $('#edCount'); if (s) s.textContent = '共 ' + n + ' 项：参数 ' + np + '，作业输入 ' + ni + '，其他 ' + (n - np - ni);
    var st = $('#edStat'); if (st) st.textContent = ED.dirty ? '● 有未保存的修改' : '';
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
    else if (f === 'fixed') it.source = { kind: 'fixed', value: t.value };
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
      var fx = $('input[data-f=fixed]', tr); fx.disabled = t.value !== 'fixed';
      var g = $('#gridPrev'); if (g) g.innerHTML = gridHtml(ED.sheets[ED.sheet]);
    }
    edDirty();
  });
  $('#library').addEventListener('click', function (e) {
    if (!ED) return;
    var t = e.target;
    if (t.id === 'edSave') {
      Api.put('/api/library/' + ED.m.id, { items: ED.items, param_ref: ED.paramRef || null }).then(function (m) { ED.m = m; ED.dirty = false; updateEdStat(); toast('已保存模板设置'); }).catch(fail);
    } else if (t.id === 'edAuto') {
      if (!ED.paramRef) { toast('请先选择参照参数表'); return; }
      Api.put('/api/library/' + ED.m.id, { items: ED.items, param_ref: ED.paramRef }).then(function () { return Api.post('/api/library/' + ED.m.id + '/automap', { param_sheet_id: ED.paramRef }); })
        .then(function (r) { toast('自动映射：' + r.mapped + ' 项'); renderTemplateEditor($('#library'), r.item); }).catch(fail);
    } else if (t.id === 'edRedetect') {
      if (confirm('重新检测会覆盖当前的检测项和映射，继续？')) Api.post('/api/library/' + ED.m.id + '/redetect').then(function (m) { renderTemplateEditor($('#library'), m); toast('已重新检测：' + m.items.length + ' 项'); }).catch(fail);
    } else if (t.id === 'edAdd') {
      var sh = ED.sheets ? ED.sheets[ED.sheet].name : 'Sheet1';
      ED.items.push({ id: sh + '!A1', sheet: sh, cell: 'A1', label: '新项目', type: 'text', options: [], rules: { required: true }, reason: 'manual', source: { kind: 'input' } });
      edDirty(); drawEditor($('#library'));
    } else if (t.getAttribute('data-f') === 'del' && t.closest('#itemTable')) {
      ED.items.splice(+t.closest('tr').getAttribute('data-i'), 1); edDirty(); drawEditor($('#library'));
    } else if (t.hasAttribute('data-sheet')) {
      ED.sheet = +t.getAttribute('data-sheet'); drawEditor($('#library'));
    } else if (t.closest('#gridPrev td[data-addr]')) {
      var td = t.closest('td[data-addr]'), addr = td.getAttribute('data-addr'), shn = ED.sheets[ED.sheet];
      var found = ED.items.filter(function (x) { return x.sheet === shn.name && x.cell === addr; })[0];
      if (!found) {
        if (!confirm('把 ' + shn.name + '!' + addr + ' 添加为检测项？')) return;
        found = { id: shn.name + '!' + addr, sheet: shn.name, cell: addr, label: leftLabel(shn, addr), type: 'text', options: [], rules: { required: true }, reason: 'manual', source: { kind: 'input' } };
        ED.items.push(found); edDirty();
      }
      ED.sel = found.id; drawEditor($('#library'));
      var row = $('#itemTable tr.sel'); if (row) row.scrollIntoView({ block: 'center' });
    }
  });

  /* ---------- 命令模板集编辑器 ---------- */
  var CE = null;
  function renderCmdSetEditor(el, m) {
    CE = { m: m, t: JSON.parse(JSON.stringify(m.templates || [])), ps: (G.lib.param_sheet || [])[0] ? G.lib.param_sheet[0].id : '', server: '' };
    drawCmdEditor(el);
  }
  function drawCmdEditor(el) {
    var ps = (G.lib.param_sheet || []).filter(function (p) { return p.id === CE.ps; })[0], servers = ps ? ps.parsed.servers : [];
    if (servers.indexOf(CE.server) < 0) CE.server = servers[0] || '';
    var h = '<div class="card"><div class="row spread"><h3 lang="ja">命令模板集：' + esc(CE.m.name) + '</h3><div class="row"><button data-act="backLib">← 返回</button><button id="ceExport">导出 JSON</button><button class="primary" id="ceSave">保存</button></div></div>' +
      '<p class="muted">用 <code>{{键}}</code> 引用参数表的键（如 <code>{{instance_id}}</code>）。只放<b>只读</b>确认命令：aws 需 <code>--output</code> 与 <code>--no-cli-pager</code>，ssh 需 <code>-o BatchMode=yes</code>。本工具只生成文本，<b>不会执行任何命令</b>。</p>' +
      '<div class="tscroll"><table class="t" id="ceTable"><tr><th style="width:160px">标题</th><th style="width:80px">类型</th><th style="width:140px">比对参数键(逗号)</th><th>命令模板</th><th></th></tr>' +
      CE.t.map(function (t, i) {
        return '<tr data-i="' + i + '"><td><input type="text" data-f="title" value="' + esc(t.title) + '" lang="ja"></td><td><select data-f="kind">' + ['aws', 'linux', 'windows', 'other'].map(function (k) { return '<option' + (t.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="text" data-f="checks" value="' + esc(t.checks || '') + '" class="mono"></td><td><textarea class="mono tpl" data-f="template">' + esc(t.template) + '</textarea></td><td><button class="small danger" data-f="del">✕</button></td></tr>';
      }).join('') + '</table></div><button id="ceAdd" style="margin-top:8px">＋ 添加命令</button></div>' +
      '<div class="card"><div class="row"><b>预览</b><label>参数表 <select id="cePs">' + (G.lib.param_sheet || []).map(function (p) { return '<option value="' + p.id + '"' + (p.id === CE.ps ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>服务器 <select id="ceSrv">' + servers.map(function (s) { return '<option' + (s === CE.server ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label></div><div id="cePreview" style="margin-top:8px"></div></div>';
    el.innerHTML = h;
    cePreview();
  }
  var cePreview = debounce(function () {
    if (!CE) return;
    Api.post('/api/library/commands_preview', { templates: CE.t, param_sheet_id: CE.ps, server: CE.server }).then(function (r) { var p = $('#cePreview'); if (p) p.innerHTML = cmdList(r.commands); }).catch(function () { });
  }, 250);
  function cmdList(cmds) {
    if (!cmds.length) return '<p class="muted">没有命令。</p>';
    return cmds.map(function (c, i) {
      return '<div class="cmdcard" data-cmd="' + i + '"><div class="row spread"><b lang="ja">[' + (i + 1) + '] ' + esc(c.title) + '</b><span class="muted">' + esc(c.kind) + (c.checks ? ' · 比对: ' + esc(c.checks) : '') + '</span></div>' +
        c.warnings.map(function (w) { return '<div class="warn">⚠ ' + esc(w) + '</div>'; }).join('') +
        (c.missing.length ? '<div class="miss">未解析的占位符：' + esc(c.missing.join(', ')) + '</div>' : '') +
        '<div class="cmd"><code>' + esc(c.sh) + '</code><button data-copy="' + esc(c.sh) + '">复制</button></div></div>';
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
    if (t.id === 'ceSave') Api.put('/api/library/' + CE.m.id, { templates: CE.t }).then(function () { toast('已保存命令模板'); }).catch(fail);
    else if (t.id === 'ceExport') {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ name: CE.m.name, templates: CE.t }, null, 2)], { type: 'application/json' }));
      a.download = CE.m.name + '.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }
    else if (t.id === 'ceAdd') { CE.t.push({ title: '新命令', kind: 'linux', checks: '', template: "ssh -n -o BatchMode=yes -o ConnectTimeout=10 {{ssh_user}}@{{private_ip}} 'uptime'" }); drawCmdEditor($('#library')); }
    else if (t.getAttribute('data-f') === 'del' && t.closest('#ceTable')) { CE.t.splice(+t.closest('tr').getAttribute('data-i'), 1); drawCmdEditor($('#library')); }
  });

  // 全局复制按钮
  document.addEventListener('click', function (e) { var b = e.target.closest('#library [data-copy], #jobs [data-copy]'); if (b) copyText(b.getAttribute('data-copy')); });

  /* ================= 作业 ================= */
  var J = null; // 当前作业视图 {job, resolved, template, compare}
  function renderJobs() {
    Promise.all([loadLib(), Api.get('/api/jobs')]).then(function (r) {
      G.jobs = r[1].items;
      var el = $('#jobs');
      var list = '<div class="side joblist"><div style="padding:10px"><button class="primary" id="jobNew" style="width:100%">＋ 新建作业</button></div>' +
        (G.jobs.length ? G.jobs.map(function (j) { return '<div class="it' + (j.id === G.jobId ? ' on' : '') + '" data-job="' + j.id + '"><b lang="ja">' + esc(j.name) + '</b><div class="muted">' + esc(j.server || '') + ' · ' + esc((j.updated || '').replace('T', ' ')) + '</div></div>'; }).join('') : '<p class="muted" style="padding:0 10px">暂无作业</p>') + '</div>';
      el.innerHTML = '<div class="cols">' + list + '<div id="jobMain"></div></div>';
      if (G.jobId === 'new' || !G.jobs.length) drawJobForm(null);
      else if (G.jobId && G.jobs.some(function (j) { return j.id === G.jobId; })) openJob(G.jobId);
      else $('#jobMain').innerHTML = '<div class="card muted">请选择或新建一个作业。</div>';
    }).catch(fail);
  }
  function sel(id, list, cur, empty) {
    return '<select id="' + id + '">' + (empty ? '<option value="">' + empty + '</option>' : '') + list.map(function (m) { return '<option value="' + m.id + '"' + (m.id === cur ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select>';
  }
  function drawJobForm(job) {
    var j = job || { name: '', template_id: (G.lib.excel_template[0] || {}).id, param_sheet_id: (G.lib.param_sheet[0] || {}).id, command_set_id: (G.lib.command_set[0] || {}).id, server: '' };
    var h = '<div class="card"><h3>' + (job ? '作业设置' : '新建作业') + '</h3><div class="formgrid">' +
      '<label>作业名<input type="text" id="jfName" value="' + esc(j.name) + '" placeholder="例：web01 構築確認" lang="ja"></label>' +
      '<label>交付物模板' + sel('jfTpl', G.lib.excel_template, j.template_id, '（不使用）') + '</label>' +
      '<label>参数表' + sel('jfPs', G.lib.param_sheet, j.param_sheet_id, '（不使用）') + '</label>' +
      '<label>服务器（参数表的列）<select id="jfSrv"></select></label>' +
      '<label>命令模板集' + sel('jfCs', G.lib.command_set, j.command_set_id, '（不使用）') + '</label>' +
      '<label>手顺书（可选）' + sel('jfPr', G.lib.procedure, j.procedure_id, '（不使用）') + '</label>' +
      '</div><div class="actions"><button class="primary" id="jfSave">' + (job ? '保存设置' : '创建作业') + '</button>' + (job ? '<button id="jfCancel">取消</button>' : '') + '</div></div>';
    $('#jobMain').innerHTML = h;
    function fillSrv() {
      var ps = G.lib.param_sheet.filter(function (p) { return p.id === $('#jfPs').value; })[0], s = ps ? ps.parsed.servers : [];
      $('#jfSrv').innerHTML = s.map(function (x) { return '<option' + (x === j.server ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
    }
    fillSrv(); $('#jfPs').addEventListener('change', fillSrv);
    $('#jfSave').addEventListener('click', function () {
      var b = { name: $('#jfName').value.trim() || ('作业 ' + new Date().toLocaleString()), template_id: $('#jfTpl').value || null, param_sheet_id: $('#jfPs').value || null, server: $('#jfSrv').value || '', command_set_id: $('#jfCs').value || null, procedure_id: $('#jfPr').value || null };
      (job ? Api.put('/api/jobs/' + job.id, b).then(function () { return job; }) : Api.post('/api/jobs', b)).then(function (r) { G.jobId = r.id; toast(job ? '已保存' : '已创建作业'); renderJobs(); }).catch(fail);
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
    var h = '<div class="card"><div class="row spread"><div><h3 lang="ja" style="margin:0">' + esc(j.name) + '</h3><div class="muted" lang="ja">服务器 <b>' + esc(j.server || '—') + '</b> · 模板 ' + esc(libName(j.template_id)) + ' · 参数表 ' + esc(libName(j.param_sheet_id)) + ' · 命令 ' + esc(libName(j.command_set_id)) + '</div></div>' +
      '<div class="row">' + (j.procedure_id ? '<button id="jbProc">打开手顺书</button>' : '') + '<button id="jbEdit">设置</button><button class="danger" id="jbDel">删除</button></div></div>' +
      '<div class="subtabs" id="jobTabs">' + [['inputs', '① 输入检查'], ['commands', '② 命令生成'], ['compare', '③ 参数比对'], ['deliver', '④ 交付物输出']].map(function (t) { return '<button data-jt="' + t[0] + '"' + (G.jobTab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div></div><div id="jobBody"></div>';
    $('#jobMain').innerHTML = h;
    ({ inputs: drawInputs, commands: drawCommands, compare: drawCompare, deliver: drawDeliver })[G.jobTab]();
  }
  $('#jobs').addEventListener('click', function (e) {
    var t = e.target, it = t.closest('[data-job]');
    if (it) return openJob(it.getAttribute('data-job'));
    if (t.id === 'jobNew') { G.jobId = 'new'; drawJobForm(null); return; }
    if (t.hasAttribute('data-jt')) { G.jobTab = t.getAttribute('data-jt'); drawJob(); return; }
    if (t.id === 'jbEdit') return drawJobForm(J.job);
    if (t.id === 'jbProc') return openProcedure(J.job.procedure_id);
    if (t.id === 'jbDel') { if (confirm('删除作业「' + J.job.name + '」？')) Api.del('/api/jobs/' + J.job.id).then(function () { G.jobId = null; renderJobs(); }).catch(fail); }
  });

  // 异步返回时若用户已切换到别的作业/子标签，则丢弃这次渲染（避免竞态）
  function stale(body, tab) { return !body.isConnected || G.jobTab !== tab; }
  /* ---------- ① 输入检查 ---------- */
  function itemsById() { var m = {}; ((J.template || {}).items || []).forEach(function (it) { m[it.id] = it; }); return m; }
  function drawInputs() {
    var body = $('#jobBody');
    if (!J.template) { body.innerHTML = '<div class="card muted">此作业没有交付物模板。</div>'; return; }
    var byId = itemsById(), res = J.resolved.filter(function (r) { return r.kind !== 'none'; });
    var inputs = res.filter(function (r) { return r.kind === 'input'; }), others = res.filter(function (r) { return r.kind !== 'input'; });
    function row(r) {
      var it = byId[r.id] || {}, v = r.value == null ? '' : r.value, ctl;
      if (r.kind !== 'input') ctl = '<input type="text" value="' + esc(v) + '" disabled lang="ja" data-ro="' + esc(r.id) + '">';
      else if (it.type === 'dropdown') ctl = '<select data-in="' + esc(r.id) + '"><option value="">（未选择）</option>' + (it.options || []).map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      else ctl = '<input type="text" data-in="' + esc(r.id) + '" value="' + esc(v) + '" lang="ja"' + (it.type === 'number' ? ' inputmode="decimal"' : '') + ' placeholder="' + esc(placeholderFor(it)) + '">';
      return '<tr data-row="' + esc(r.id) + '"><td class="mono nowrap muted">' + esc(r.cell) + '</td><td lang="ja">' + esc(r.label) + ((it.rules || {}).required ? ' <span class="req" style="color:#dc2626">*</span>' : '') + '</td><td><span class="pill ' + r.kind + '">' + ({ param: '参数 ' + (r.key || ''), fixed: '固定值', input: '输入' })[r.kind] + '</span></td><td class="w-val">' + ctl + '</td><td class="msg w-msg"></td></tr>';
    }
    body.innerHTML = '<div class="card"><div class="row spread"><h3>作业输入 <span class="muted">(' + inputs.length + ')</span></h3><span id="inStat"></span></div>' +
      '<div class="tscroll"><table class="t" id="inTable"><tr><th>单元格</th><th>项目</th><th>来源</th><th>值</th><th>检查</th></tr>' + inputs.map(row).join('') + '</table></div></div>' +
      '<div class="card"><h3>来自参数表 / 固定值 <span class="muted">(' + others.length + ')（同样按规则检查，发现参数表本身的错误）</span></h3><div class="tscroll"><table class="t" id="roTable"><tr><th>单元格</th><th>项目</th><th>来源</th><th>值</th><th>检查</th></tr>' + others.map(row).join('') + '</table></div></div>';
    validateAll();
  }
  function placeholderFor(it) { var p = (it.rules || {}).preset, ps = Rules.presets(); return p && ps[p] ? '例: ' + ps[p].example : (it.type === 'number' ? '数字' : ''); }
  function validateAll() {
    var byId = itemsById(), bad = 0, total = 0;
    $$('#jobBody tr[data-row]').forEach(function (tr) {
      var id = tr.getAttribute('data-row'), it = byId[id] || {}, ctl = $('[data-in],[data-ro]', tr), errs = Rules.validate(it, ctl.value);
      total++; if (errs.length) bad++;
      ctl.classList.toggle('invalid', errs.length > 0);
      $('.msg', tr).innerHTML = errs.length ? '<span class="err">✕ ' + esc(errs.map(function (x) { return x.message; }).join('；')) + '</span>' : (String(ctl.value).trim() ? '<span class="okc">✓</span>' : '');
    });
    var s = $('#inStat'); if (s) s.innerHTML = bad ? '<span class="err" style="font-size:13px">有 ' + bad + ' 项不符合规则（共 ' + total + ' 项）</span>' : '<span class="okc" style="font-size:13px">全部 ' + total + ' 项通过检查</span>';
  }
  var pendingInputs = {};
  var saveInputs = debounce(function () {
    var b = pendingInputs; pendingInputs = {};
    Api.put('/api/jobs/' + J.job.id, { inputs: b }).then(function (v) { J.job = v.job; J.resolved = v.resolved; }).catch(fail);
  }, 300);
  function onInputChange(e) {
    var t = e.target; if (!t.hasAttribute('data-in') || !J) return;
    var id = t.getAttribute('data-in'); pendingInputs[id] = t.value; J.job.inputs[id] = t.value;
    J.resolved.forEach(function (r) { if (r.id === id) r.value = t.value; });
    validateAll(); saveInputs();
  }
  $('#jobs').addEventListener('input', onInputChange);
  $('#jobs').addEventListener('change', function (e) { if (e.target.tagName === 'SELECT') onInputChange(e); });

  /* ---------- ② 命令生成 ---------- */
  function drawCommands() {
    var body = $('#jobBody');
    if (!J.job.command_set_id) { body.innerHTML = '<div class="card muted">此作业没有选择命令模板集。</div>'; return; }
    Api.get('/api/jobs/' + J.job.id + '/commands').then(function (r) {
      if (stale(body, 'commands')) return;
      var needed = {}; r.commands.forEach(function (c) { (c.sh.match(/\{\{\s*[\w.-]+\s*\}\}/g) || []).forEach(function (x) { needed[x.replace(/[{}\s]/g, '')] = 1; }); });
      var gl = J.job.globals || {};
      var used = {}; ((G.lib.command_set || []).filter(function (c) { return c.id === J.job.command_set_id; })[0] || { templates: [] }).templates.forEach(function (t) { (t.template.match(/\{\{\s*([\w.-]+)\s*\}\}/g) || []).forEach(function (x) { used[x.replace(/[{}\s]/g, '')] = 1; }); });
      var keys = Object.keys(used).sort();
      body.innerHTML = '<div class="card"><div class="row spread"><h3>确认命令 <span class="muted">(' + r.commands.length + ')</span></h3><div class="row">' +
        '<button id="dlSh">下载 .sh</button><button id="dlPs1">下载 .ps1</button></div></div>' +
        '<p class="muted">⚠ 只生成文本，<b>不会自动执行</b>。请审阅后在你的终端里手动运行。所有 aws 命令带 <code>--no-cli-pager</code> / <code>--output</code>，ssh 带 <code>-o BatchMode=yes</code>（lint 会提示缺失）。</p>' +
        '<details open><summary>占位符变量（参数表值，可在此覆盖）</summary><div class="tscroll"><table class="t" id="glTable" style="margin-top:6px"><tr><th>变量</th><th>当前值</th><th>覆盖值（仅此作业）</th></tr>' +
        keys.map(function (k) { return '<tr><td class="mono">{{' + esc(k) + '}}</td><td class="mono' + (needed[k] ? ' err' : '') + '">' + esc(r.context[k] == null || r.context[k] === '' ? '（未定义）' : r.context[k]) + '</td><td><input type="text" class="mono" data-gl="' + esc(k) + '" value="' + esc(gl[k] || '') + '"></td></tr>'; }).join('') + '</table></div></details>' +
        '<div style="margin-top:10px" id="cmdList">' + cmdList(r.commands) + '</div></div>';
      $('#dlSh').addEventListener('click', function () { download('/api/jobs/' + J.job.id + '/commands.sh'); });
      $('#dlPs1').addEventListener('click', function () { download('/api/jobs/' + J.job.id + '/commands.ps1'); });
      $$('[data-gl]', body).forEach(function (inp) {
        inp.addEventListener('change', function () { J.job.globals = J.job.globals || {}; J.job.globals[inp.getAttribute('data-gl')] = inp.value; Api.put('/api/jobs/' + J.job.id, { globals: J.job.globals }).then(drawCommands).catch(fail); });
      });
    }).catch(fail);
  }

  /* ---------- ③ 参数比对 ---------- */
  function drawCompare() {
    var body = $('#jobBody');
    if (!J.job.param_sheet_id) { body.innerHTML = '<div class="card muted">此作业没有参数表。</div>'; return; }
    Api.get('/api/jobs/' + J.job.id + '/compare').then(function (r) {
      if (stale(body, 'compare')) return;
      J.compareRows = r.rows;
      body.innerHTML = '<div class="card"><div class="row spread"><h3>参数比对 <span class="muted">服务器 ' + esc(J.job.server) + '</span></h3><div class="row"><span id="cmpStat"></span><button class="primary" id="cmpExport">导出比对结果 .xlsx</button></div></div>' +
        '<p class="muted">把确认命令的输出结果填入「实测值」，自动判定与期待值是否一致（忽略全角/半角、大小写、空格，8 / 8 GiB / 8GB 视为相同）。最后逐项点击 OK / NG。</p>' +
        '<div class="tscroll"><table class="t" id="cmpTable"><tr><th class="nowrap">区分</th><th class="w-item">项目 / 键</th><th class="w-exp">期待值</th><th class="w-actual">实测值</th><th>自动判定</th><th>判定</th><th class="w-note">备注</th><th>确认命令</th></tr>' +
        r.rows.map(function (x) {
          return '<tr data-key="' + esc(x.key) + '" class="' + (x.auto === 'mismatch' ? 'mismatch' : '') + '"><td lang="ja" class="nowrap">' + esc(x.category) + '</td><td lang="ja">' + esc(x.label) + '<div class="mono muted keyline">' + esc(x.key) + '</div></td><td class="mono brk exp" lang="ja">' + esc(x.expected) + '</td>' +
            '<td><input type="text" data-cmp="actual" value="' + esc(x.actual) + '" lang="ja"></td><td class="nowrap"><span class="pill ' + x.auto + '" data-auto>' + esc(x.auto_label) + '</span></td>' +
            '<td class="jg nowrap"><button class="small ok' + (x.judgement === 'OK' ? ' on' : '') + '" data-j="OK">OK</button> <button class="small ng' + (x.judgement === 'NG' ? ' on' : '') + '" data-j="NG">NG</button></td>' +
            '<td><input type="text" data-cmp="note" value="' + esc(x.note) + '" lang="ja"></td><td><div class="copylist">' + x.commands.map(function (c) { return '<button class="small" data-copy="' + esc(c.sh) + '" title="' + esc(c.sh) + '" lang="ja">复制: ' + esc(c.title) + '</button>'; }).join('') + '</div></td></tr>';
        }).join('') + '</table></div></div>';
      cmpStat();
      $('#cmpExport').addEventListener('click', function () { flushCompare().then(function () { download('/api/jobs/' + J.job.id + '/compare.xlsx'); }); });
    }).catch(fail);
  }
  function cmpStat() {
    var rows = $$('#cmpTable tr[data-key]'), mm = 0, ok = 0, ng = 0, miss = 0;
    rows.forEach(function (tr) { var a = $('[data-auto]', tr).className; if (/mismatch/.test(a)) mm++; if (/missing/.test(a)) miss++; if ($('[data-j=OK].on', tr)) ok++; if ($('[data-j=NG].on', tr)) ng++; });
    $('#cmpStat').innerHTML = '<span class="pill mismatch">不一致 ' + mm + '</span> <span class="pill missing">未填 ' + miss + '</span> <span class="pill match">OK ' + ok + '</span> <span class="pill mismatch">NG ' + ng + '</span> <span class="muted">/ ' + rows.length + '</span>';
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

  /* ---------- ④ 交付物输出 ---------- */
  function drawDeliver() {
    var body = $('#jobBody');
    if (!J.template) { body.innerHTML = '<div class="card muted">此作业没有交付物模板。</div>'; return; }
    Api.get('/api/jobs/' + J.job.id).then(function (v) {
      if (stale(body, 'deliver')) return;
      J.job = v.job; J.resolved = v.resolved;
      var filled = v.resolved.filter(function (r) { return r.kind !== 'none' && String(r.value || '').trim(); }).length;
      body.innerHTML = '<div class="card"><div class="row spread"><h3>交付物输出</h3><div class="row"><button id="dvMap">编辑映射</button><button class="primary" id="dvExport">导出交付物 .xlsx</button></div></div>' +
        '<p class="muted">把参数表的值和作业输入写入客户模板的对应单元格，模板原有格式（字体、底色、边框、合并单元格、列宽、数据验证）保持不变。「不填」的单元格保持原样，导出后请在 Excel 中手动编辑个性化部分。</p>' +
        '<p>将写入 <b>' + filled + '</b> 个单元格' + (v.errors ? '，<span class="err" style="font-size:14px">其中 ' + v.errors + ' 项未通过检查（仍可导出）</span>' : '') + '。</p>' +
        '<div class="tscroll"><table class="t" id="dvTable"><tr><th>单元格</th><th>项目</th><th>来源</th><th>写入值</th><th>检查</th></tr>' + v.resolved.map(function (r) {
          return '<tr><td class="mono nowrap">' + esc(r.sheet + '!' + r.cell) + '</td><td lang="ja">' + esc(r.label) + '</td><td><span class="pill ' + r.kind + '">' + ({ param: '参数 ' + (r.key || ''), fixed: '固定值', input: '输入', none: '不填' })[r.kind] + '</span></td><td lang="ja">' + esc(r.value) + '</td><td>' + (r.errors.length ? '<span class="err">' + esc(r.errors.map(function (x) { return x.message; }).join('；')) + '</span>' : (r.kind !== 'none' && String(r.value || '').trim() ? '<span class="okc">✓</span>' : '')) + '</td></tr>';
        }).join('') + '</table></div></div>';
      $('#dvExport').addEventListener('click', function () { download('/api/jobs/' + J.job.id + '/deliverable.xlsx'); toast('正在生成交付物…'); });
      $('#dvMap').addEventListener('click', function () { G.libView = { id: J.job.template_id }; setTab('library'); });
    }).catch(fail);
  }

  /* ================= 启动 ================= */
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });
  Api.get('/api/presets').then(function (r) { Rules.setPresets(r.presets, r.messages); }).catch(fail).then(function () { setTab(G.tab); });   // 保留加载期间用户已切换的标签（避免竞态覆盖）
  window.BA = { G: G, setTab: setTab, openJob: openJob, flush: function () { return flushCompare(); } };
})();
