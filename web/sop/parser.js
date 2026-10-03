/* ===================== DOCX → 步骤 解析器 =====================
 * 只依赖 JSZip + 浏览器内置 DOMParser。不发起任何网络请求。
 * 输出: { title, steps:[{section,title,context,content,expected,inputs[]}] }
 * content 约定: 整行用 `反引号` 包住 = 命令块；行内 `xxx` = 行内代码。
 */
var SopParser = (function () {
  'use strict';
  var WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'; // XML 命名空间标识符（字符串常量），不会被请求

  function kids(el, name) { var r = []; if (!el) return r; for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!name || c.localName === name)) r.push(c); return r; }
  function kid(el, name) { if (!el) return null; for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === name) return c; return null; }
  function attr(el, name) { if (!el) return null; var v = el.getAttributeNS(WNS, name); if (v === null || v === '') v = el.getAttribute('w:' + name); return v === '' ? null : v; }
  function onOff(el) { if (!el) return false; var v = attr(el, 'val'); return v === null || !/^(0|false|off|none)$/i.test(v); }

  var MONO_FONT = /courier|consolas|menlo|monaco|lucida console|lucida sans typewriter|source code|dejavu sans mono|liberation mono|ubuntu mono|fira (code|mono)|inconsolata|roboto mono|cascadia|jetbrains mono|monospace|osaka.?等幅|ocr/i;
  var CODE_STYLE = /code|コード|preformatted|verbatim|source|macro|console|terminal|コマンド|命令/i;

  /* ---------- styles.xml / numbering.xml ---------- */
  function parseStyles(xml) {
    var map = {};
    if (!xml) return map;
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var all = doc.getElementsByTagNameNS(WNS, 'style');
    for (var i = 0; i < all.length; i++) {
      var s = all[i], id = attr(s, 'styleId');
      var nameEl = kid(s, 'name'), name = nameEl ? (attr(nameEl, 'val') || '') : '';
      var pPr = kid(s, 'pPr'), rPr = kid(s, 'rPr');
      var numPr = pPr && kid(pPr, 'numPr');
      var ol = pPr && kid(pPr, 'outlineLvl');
      var fonts = rPr && kid(rPr, 'rFonts');
      map[id] = {
        id: id, name: name, type: attr(s, 'type'),
        basedOn: attr(kid(s, 'basedOn'), 'val'),
        numId: numPr ? attr(kid(numPr, 'numId'), 'val') : null,
        ilvl: numPr && kid(numPr, 'ilvl') ? +attr(kid(numPr, 'ilvl'), 'val') : null,
        outline: ol ? +attr(ol, 'val') : null,
        font: fonts ? (attr(fonts, 'ascii') || attr(fonts, 'hAnsi') || '') : '',
        bold: rPr ? onOff(kid(rPr, 'b')) : false
      };
    }
    return map;
  }
  function styleProp(styles, id, prop) {
    var guard = 0;
    while (id && styles[id] && guard++ < 20) { var v = styles[id][prop]; if (v !== null && v !== '' && v !== undefined && v !== false) return v; id = styles[id].basedOn; }
    return null;
  }
  function headingLevel(styles, id) {
    var guard = 0, cur = id;
    while (cur && styles[cur] && guard++ < 20) {
      var n = (styles[cur].name || '') + ' ' + cur;
      if (/^(title|表題|标题$|タイトル)/i.test(styles[cur].name) || /^Title$/i.test(cur)) return 0;
      var m = n.match(/(?:heading|見出し|标题|標題)\s*([1-9])/i);
      if (m) return +m[1];
      cur = styles[cur].basedOn;
    }
    var ol = styleProp(styles, id, 'outline');
    if (ol !== null && ol < 9) return ol + 1;
    return null;
  }
  function parseNumbering(xml) {
    var res = { num: {}, abs: {} };
    if (!xml) return res;
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var abs = doc.getElementsByTagNameNS(WNS, 'abstractNum');
    for (var i = 0; i < abs.length; i++) {
      var a = abs[i], lv = {};
      kids(a, 'lvl').forEach(function (l) { lv[attr(l, 'ilvl')] = attr(kid(l, 'numFmt'), 'val') || 'decimal'; });
      res.abs[attr(a, 'abstractNumId')] = lv;
    }
    var nums = doc.getElementsByTagNameNS(WNS, 'num');
    for (var j = 0; j < nums.length; j++) res.num[attr(nums[j], 'numId')] = attr(kid(nums[j], 'abstractNumId'), 'val');
    return res;
  }

  /* ---------- 段落 ---------- */
  function paraInfo(p, C) {
    var pPr = kid(p, 'pPr');
    var styleId = pPr ? attr(kid(pPr, 'pStyle'), 'val') : null;
    var st = C.styles[styleId] || null;
    var styleName = st ? st.name : '';
    var styleMono = !!(CODE_STYLE.test(styleName || '') || MONO_FONT.test(styleProp(C.styles, styleId, 'font') || ''));
    var styleBold = !!styleProp(C.styles, styleId, 'bold');
    var segs = [];
    function push(text, mono, bold) {
      if (!text) return;
      var last = segs[segs.length - 1];
      if (last && last.mono === mono && last.bold === bold) last.text += text; else segs.push({ text: text, mono: mono, bold: bold });
    }
    function run(r) {
      var rPr = kid(r, 'rPr'), mono = styleMono, bold = styleBold;
      if (rPr) {
        var f = kid(rPr, 'rFonts');
        if (f) { var fn = attr(f, 'ascii') || attr(f, 'hAnsi') || ''; if (fn) mono = MONO_FONT.test(fn); }
        var rs = attr(kid(rPr, 'rStyle'), 'val');
        if (rs && C.styles[rs] && (CODE_STYLE.test(C.styles[rs].name) || MONO_FONT.test(C.styles[rs].font || ''))) mono = true;
        var b = kid(rPr, 'b'); if (b) bold = onOff(b);
      }
      for (var c = r.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var n = c.localName;
        if (n === 't') push(c.textContent, mono, bold);
        else if (n === 'tab' || n === 'ptab') push('\t', mono, bold);
        else if (n === 'br' || n === 'cr') push('\n', mono, bold);
        else if (n === 'noBreakHyphen') push('-', mono, bold);
        else if (n === 'sym') push('□', mono, bold);
      }
    }
    (function walk(el) {
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var n = c.localName;
        if (n === 'r') run(c);
        else if (n === 'pPr' || n === 'del' || n === 'moveFrom' || n === 'rPr') continue;
        else walk(c);
      }
    })(p);
    var full = segs.map(function (s) { return s.text; }).join('');
    var nonWs = segs.filter(function (s) { return /\S/.test(s.text); });
    var allMono = nonWs.length > 0 && nonWs.every(function (s) { return s.mono; });
    var allBold = nonWs.length > 0 && nonWs.every(function (s) { return s.bold; });
    var text;
    if (allMono) text = full;
    else text = segs.map(function (s) {
      if (!s.mono || !/\S/.test(s.text) || /\n/.test(s.text)) return s.text;
      var m = s.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return m[1] + '`' + m[2].replace(/`/g, "'") + '`' + m[3];
    }).join('');
    // 列表/编号
    var numId = null, ilvl = 0;
    var numPr = pPr && kid(pPr, 'numPr');
    if (numPr && kid(numPr, 'numId')) { numId = attr(kid(numPr, 'numId'), 'val'); ilvl = kid(numPr, 'ilvl') ? +attr(kid(numPr, 'ilvl'), 'val') : 0; }
    else { numId = styleProp(C.styles, styleId, 'numId'); var sl = styleProp(C.styles, styleId, 'ilvl'); ilvl = sl ? +sl : 0; }
    if (numId === '0') numId = null;
    var listFmt = null;
    if (numId) {
      var absId = C.numbering.num[numId], lv = absId != null ? C.numbering.abs[absId] : null;
      var fmt = lv ? (lv[String(ilvl)] || 'decimal') : (/bullet|箇条書き|项目符号/i.test(styleName) ? 'bullet' : 'decimal');
      listFmt = fmt === 'bullet' || fmt === 'none' ? 'bullet' : 'number';
    }
    var hl = headingLevel(C.styles, styleId);
    if (hl === null && pPr && kid(pPr, 'outlineLvl')) { var o = +attr(kid(pPr, 'outlineLvl'), 'val'); if (o < 9) hl = o + 1; }
    return { kind: 'p', text: text, plain: full, isCode: allMono || (styleMono && nonWs.length > 0 && !nonWs.some(function (s) { return !s.mono; })), bold: allBold, numId: numId, ilvl: ilvl, listFmt: listFmt, heading: hl, styleName: styleName };
  }

  /* ---------- 文本规则 ---------- */
  var RE_MANUAL_HEAD = /^(第[0-9０-９一二三四五六七八九十]+[章節节部]|[0-9０-９]{1,2}(?:[\.．][0-9０-９]{1,2}){0,3}[\.．]?)[\s　]+\S/;
  var RE_MANUAL_NUM = /^\s*(?:[0-9０-９]{1,3}[\.．\)）、](?![0-9０-９])|[（(][0-9０-９]{1,3}[）)]|[①-⑳]|手順\s*[0-9０-９]+|ステップ\s*[0-9０-９]+|步骤\s*[0-9０-９]+|Step\s*\d+)[\s　:：]*/i;
  var RE_MANUAL_BULLET = /^\s*[・●○■◆◇▪•‣–]\s*/;
  var RE_EXPECTED = /^\s*[【\[［(（]?\s*(期待(?:する)?結果|期待値|期待動作|想定結果|確認内容|確認事項|確認ポイント|判定基準|合格基準|预期结果|预期|期望结果|expected(?:\s+result)?s?)\s*[】\]］)）]?\s*[:：\-－]?\s*/i;
  var RE_PROMPT = /^\s*(?:\$|#|>|%|PS [^>]{0,60}>|[A-Za-z]:\\[^>]{0,80}>|\[[^\]\s]+@[^\]]+\][#$]|[\w.-]+@[\w.-]+[:~][^\s]*[#$]|mysql>|SQL>|postgres=#)\s?\S/;
  var RE_CMDWORD = /^\s*(sudo|su|ssh|scp|sftp|cd|ls|ll|cat|less|more|grep|egrep|tail|head|cp|mv|rm|mkdir|chmod|chown|ln|tar|gzip|unzip|find|df|du|free|top|ps|kill|pkill|systemctl|service|journalctl|dnf|yum|apt|apt-get|rpm|dpkg|pip|npm|git|docker|kubectl|curl|wget|ping|traceroute|tracert|nslookup|dig|ip|ifconfig|ipconfig|netstat|ss|nc|telnet|uname|hostname|whoami|date|shutdown|reboot|mount|umount|crontab|vi|vim|echo|export|source|java|python3?|perl|sh|bash|powershell|Get-\w+|Set-\w+|net|sc|reg|robocopy|xcopy|dir|type|copy|del|ren|exit|mysql|psql|sqlplus|openssl|lbctl|virsh|aws|az|gcloud|ansible(-playbook)?|make)\b/;

  function asciiRatio(s) { s = s.replace(/\s/g, ''); if (!s) return 0; var n = 0; for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) < 128) n++; return n / s.length; }
  function isCmdLine(line) {
    var t = line.trim();
    if (!t || t.length > 400) return false;
    if (/^`[^`]+`$/.test(t)) return true;
    if (RE_PROMPT.test(t) && asciiRatio(t) >= 0.7 && !/^#\s*[^\x00-\x7f]/.test(t)) return true;
    if (RE_CMDWORD.test(t) && asciiRatio(t) >= 0.95 && /\s|^\w+$/.test(t)) return true;
    return false;
  }
  function stripPrompt(cmd) {
    return cmd.replace(/^\s*(?:\[[^\]\s]+@[^\]]+\][#$]|[\w.-]+@[\w.-]+[:~][^\s]*[#$]|PS [^>]{0,60}>|[A-Za-z]:\\[^>]{0,80}>|mysql>|SQL>|postgres=#|\$|#|>|%)\s*/, '');
  }

  /* ---------- 输入项检测 ---------- */
  var BLANK_SRC = '[＿_]{3,}|＿{2,}|[（(][ 　\\t]*[）)]|【[ 　]*】|［[ 　]*］|\\[[ 　]+\\]|「[ 　]+」|[（(【\\[［]\\s*記入\\s*[）)】\\]］]|[□☐]';
  var RE_TIME = /時刻|日時|時間|日付|作業日|実施日|time|date|时间|日期/i;
  var RE_RESULT = /結果|判定|OK|NG|result|结果|チェック|check|確認欄/i;
  function cleanLabel(s) {
    return s.replace(/`/g, '').replace(/^[\s　・●○■◆◇▪•\-–※*]+/, '').replace(RE_MANUAL_NUM, '')
      .replace(/[\s　|｜]*[:：=＝]?[\s　|｜]*$/, '').replace(/^[\s　|｜:：]+/, '').trim();
  }
  function guessType(label, marker) {
    if (/[□☐]/.test(marker || '')) return 'check';
    if (RE_TIME.test(label)) return 'time';
    if (RE_RESULT.test(label)) return 'result';
    return 'text';
  }
  /** lines: 文本行数组 → {strong:[...], weak:[...]} */
  function detectInLines(lines, fallbackLabel) {
    var strong = [], weak = [];
    lines.forEach(function (raw, li) {
      if (!raw || isCmdLine(raw)) return;
      var line = raw.replace(/`[^`]*`/g, function (m) { return m.replace(/[_（）()\[\]【】□☐＿]/g, 'x'); }); // 行内代码不检测
      var re = new RegExp(BLANK_SRC, 'g'), m, last = 0, found = 0;
      while ((m = re.exec(line))) {
        var marker = m[0], before = raw.slice(last, m.index), after = raw.slice(m.index + marker.length);
        var label, unit = '';
        if (/[□☐]/.test(marker)) {
          var nx = after.search(new RegExp(BLANK_SRC));
          label = cleanLabel(nx >= 0 ? after.slice(0, nx) : after);
        } else {
          label = cleanLabel(before);
          if (label.length > 40) label = '…' + label.slice(-30);
          var um = after.match(/^[\s　]*([^\s　、。，,:：（(【]{1,3})(?=$|[\s　、。，,※])/);
          if (um && !/^[0-9]+$/.test(um[1]) && !/[をにがはでと]/.test(um[1])) unit = um[1];
          if (!label) label = cleanLabel(after.split(/[\s　]{2,}|※/)[0]).slice(0, 30);
        }
        if (!label) label = fallbackLabel || '记录';
        strong.push({ label: label, type: guessType(label, marker), unit: unit, line: li });
        last = m.index + marker.length; found++;
      }
      if (found) return;
      var t = raw.trim();
      // "確認結果：" "結果：" "記入：" 等 —— 冒号后为空视为明确空栏
      var km = t.match(/^(.{0,40}?(?:確認結果|実施結果|作業結果|結果|記入欄|記入|記録|备注|结果|确认结果))\s*[:：]\s*$/);
      if (km && !/(期待|想定|予想|予定|预期)結果\s*[:：]\s*$/.test(t) && !/(期待|想定|予想|予定|预期)(結果|结果)/.test(km[1])) {
        var lb = cleanLabel(km[1]);
        strong.push({ label: lb, type: guessType(lb), unit: '', line: li });
        return;
      }
      // "～を記入する" 之类句子（弱规则：同一步骤没有明确空栏时才生效；指向"欄/表"的说明句除外）
      if (/記入|填写|填入/.test(t) && !/欄|表|栏|列/.test(t)) {
        var wl = cleanLabel(t.replace(/[をに]?(記入|填写|填入)[^]*$/, '')) || cleanLabel(t);
        if (wl.length > 40) wl = wl.slice(0, 38) + '…';
        weak.push({ label: wl || fallbackLabel || '记录', type: guessType(wl), unit: '', line: li });
      }
    });
    return { strong: strong, weak: weak };
  }
  function detectInputs(step) {
    var lines = (step.content || '').split('\n');
    var r = detectInLines(lines, step.title);
    var list = r.strong.length ? r.strong : r.weak;
    return list.map(function (x) { return { label: x.label, type: x.type, unit: x.unit, optional: false }; });
  }

  /* ---------- 表格 ---------- */
  function cellInfo(tc, C) {
    var tcPr = kid(tc, 'tcPr');
    var span = tcPr && kid(tcPr, 'gridSpan') ? (+attr(kid(tcPr, 'gridSpan'), 'val') || 1) : 1;
    var vm = tcPr && kid(tcPr, 'vMerge');
    var vCont = !!vm && attr(vm, 'val') !== 'restart';
    var lines = [], codeCount = 0, total = 0;
    var ps = tc.getElementsByTagNameNS(WNS, 'p');
    for (var i = 0; i < ps.length; i++) {
      var pi = paraInfo(ps[i], C);
      pi.text.split('\n').forEach(function (l) {
        if (!l.trim()) return; total++;
        if (pi.isCode) { codeCount++; lines.push('`' + l.replace(/`/g, "'") + '`'); } else lines.push(l);
      });
    }
    var text = lines.join('\n');
    var stripped = text.replace(new RegExp(BLANK_SRC, 'g'), '').replace(/[\s　]/g, '');
    return { text: text, span: span, vCont: vCont, empty: !stripped && !vCont, hasBlank: new RegExp(BLANK_SRC).test(text), allCode: total > 0 && codeCount === total };
  }
  function tableRows(tbl, C) {
    var rows = [];
    kids(tbl, 'tr').forEach(function (tr) {
      var cells = [], col = 0;
      kids(tr).forEach(function (el) {
        var tcs = el.localName === 'tc' ? [el] : (el.localName === 'sdt' ? kids(kid(el, 'sdtContent'), 'tc') : []);
        tcs.forEach(function (tc) { var ci = cellInfo(tc, C); ci.col = col; col += ci.span; cells.push(ci); });
      });
      rows.push(cells);
    });
    // 纵向合并：继续单元格复制上方文字，不算空格子
    for (var r = 1; r < rows.length; r++) rows[r].forEach(function (c) {
      if (!c.vCont) return;
      var up = rows[r - 1].filter(function (u) { return u.col === c.col; })[0];
      if (up) { c.text = up.text; c.empty = false; c.merged = true; }
    });
    return rows;
  }
  function cellToLine(c) { return c.allCode ? c.text : c.text.replace(/\n/g, ' / '); }
  var BL = '＿＿＿';
  function analyzeTable(tbl, C, sectionTitle) {
    var rows = tableRows(tbl, C).filter(function (r) { return r.length; });
    if (!rows.length) return { record: false, lines: [] };
    var hasEmpty = rows.some(function (r) { return r.some(function (c) { return c.empty; }); });
    var hasBlank = rows.some(function (r) { return r.some(function (c) { return c.hasBlank; }); });
    var head = rows[0];
    var headOk = rows.length >= 2 && head.length >= 2 && head.every(function (c) { return !c.empty && c.text.length <= 40; });
    function role(h) {
      h = h.replace(/\s/g, '');
      if (/^(no\.?|#|番号|項番|№|ＮＯ|序号|編号)$/i.test(h)) return 'no';
      if (/期待|想定結果|expected|確認内容|判定基準|合格基準|预期|期望/i.test(h)) return 'expected';
      if (/コマンド|command|cmd|命令|実行コマンド|入力値/i.test(h)) return 'command';
      if (/確認結果|実施結果|結果|result|記入|チェック|check|確認欄|判定|✓|✔|结果|实施者|実施者|確認者|実施日|サイン|署名|印/i.test(h)) return 'result';
      return 'content';
    }
    var roles = head.map(function (c) { return role(c.text); });
    var hasResultCol = roles.indexOf('result') >= 0;
    var lines = rows.map(function (r) { return r.map(function (c) { return c.empty ? BL : cellToLine(c); }).join(' | '); });
    if (!hasEmpty && !hasBlank && !hasResultCol) return { record: false, lines: lines };
    if (headOk && (hasEmpty || hasResultCol || hasBlank)) {
      var steps = [];
      rows.slice(1).forEach(function (r) {
        if (r.every(function (c) { return c.empty || c.merged; })) return;
        var s = { title: '', content: [], expected: [] }, no = '', contentTexts = [];
        r.forEach(function (c) {
          var hc = head.filter(function (h) { return h.col === c.col; })[0] || head[Math.min(head.length - 1, r.indexOf(c))];
          var hname = (hc ? hc.text : '').replace(/\n/g, ' '), rl = hc ? roles[head.indexOf(hc)] : 'content';
          if (c.empty) { s.content.push(hname + '：' + BL); return; }
          if (rl === 'no') { no = c.text; return; }
          if (rl === 'expected') { s.expected.push(c.text); return; }
          if (rl === 'command' || c.allCode) {
            c.text.split('\n').forEach(function (l) { l = l.replace(/^`|`$/g, ''); if (l.trim()) s.content.push('`' + l + '`'); }); return;
          }
          if (rl === 'content' && contentTexts.length < 2) { contentTexts.push(c.text.split('\n')[0].replace(/`/g, '')); s.content.push(contentTexts.length === 1 ? c.text : hname + '：' + c.text); return; }
          s.content.push(hname + '：' + c.text);
        });
        s.title = ((no ? 'No.' + no + ' ' : '') + (contentTexts.join(' / ') || r.filter(function (c) { return !c.empty; }).map(function (c) { return c.text.split('\n')[0].replace(/`/g, ''); })[0] || '表格行')).slice(0, 80);
        steps.push({ title: s.title, content: s.content.join('\n'), expected: s.expected.join('\n') });
      });
      return { record: true, steps: steps };
    }
    // 键值型记录表：整表 1 个步骤
    var labels = rows.map(function (r) { var c = r.filter(function (x) { return !x.empty; })[0]; return c ? c.text.split('\n')[0].replace(/`/g, '') : ''; }).filter(Boolean);
    return { record: true, steps: [{ title: ('记录: ' + labels.slice(0, 4).join('・') + (labels.length > 4 ? '…' : '')).slice(0, 80), content: rows.map(function (r) { return r.length === 2 ? (r[0].empty ? BL : cellToLine(r[0])) + '：' + (r[1].empty ? BL : cellToLine(r[1])) : r.map(function (c) { return c.empty ? BL : cellToLine(c); }).join(' | '); }).join('\n'), expected: '' }] };
  }

  /* ---------- 分段 ---------- */
  function addParaToStep(step, pi, asSub) {
    pi.text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      if (pi.isCode || isCmdLine(line)) { step._exp = false; step.lines.push('`' + line.replace(/^`|`$/g, '').replace(/`/g, "'") + '`'); return; }
      var m = line.match(RE_EXPECTED);
      if (m && !/^\s*確認内容\s*を/.test(line)) {
        var rest = line.slice(m[0].length).trim();
        step._exp = true; if (rest) step.exp.push(rest); return;
      }
      if (step._exp && asSub && !new RegExp(BLANK_SRC).test(line)) { step.exp.push('・' + line.replace(RE_MANUAL_BULLET, '')); return; }
      step._exp = false;
      step.lines.push((asSub ? '  ・' : '') + line.replace(asSub ? RE_MANUAL_BULLET : /^$/, ''));
    });
  }
  function actionable(paras) {
    return paras.some(function (pi) {
      if (pi.kind === 'tbl') return false;
      var ls = pi.text.split('\n');
      if (pi.isCode || ls.some(isCmdLine)) return true;
      var d = detectInLines(ls, ''); return d.strong.length > 0 || d.weak.length > 0;
    });
  }

  function segment(blocks, docTitle) {
    var steps = [], path = [], cur = null, sec, pendingCtx = '';
    function newSec() { sec = { intro: [], hasItems: false, sawNumbered: false, firstIdx: steps.length }; }
    newSec();
    function sectionPath() { var p = path.slice(path.length > 1 ? 1 : 0).filter(Boolean); if (!p.length) p = path.filter(Boolean); return p.join(' › '); }
    function heading() { var p = path.filter(Boolean); return p.length ? p[p.length - 1] : (docTitle || '步骤'); }
    function mk(title) {
      var s = { section: sectionPath(), title: (title || '').replace(/`/g, '').trim().slice(0, 80) || heading(), context: pendingCtx, lines: [], exp: [], _exp: false };
      pendingCtx = ''; steps.push(s); return s;
    }
    function flushIntro(beforeItems) {
      if (!sec.intro.length) return;
      var paras = sec.intro; sec.intro = [];
      if (!beforeItems || actionable(paras)) {
        if (beforeItems === 'trail' && !actionable(paras) && steps.length > sec.firstIdx) {
          var last = steps[steps.length - 1]; paras.forEach(function (pi) { addParaToStep(last, pi, false); }); return;
        }
        var s = mk(heading()); paras.forEach(function (pi) { addParaToStep(s, pi, false); });
      } else {
        pendingCtx = paras.map(function (pi) { return pi.text.replace(/`/g, ''); }).join('\n');
      }
    }
    function closeSec() { flushIntro(sec.hasItems ? 'trail' : false); pendingCtx = ''; cur = null; }

    blocks.forEach(function (b) {
      if (b.kind === 'tbl') {
        var t = analyzeTable(b.el, b.C, heading());
        if (t.record) {
          if (!sec.hasItems) flushIntro(true); else flushIntro('trail');
          sec.hasItems = true; cur = null;
          t.steps.forEach(function (ts) { var s = mk(ts.title); s.lines = ts.content ? ts.content.split('\n') : []; if (ts.expected) s.exp.push(ts.expected); });
        } else {
          var fake = { kind: 'p', text: t.lines.join('\n'), isCode: false };
          if (cur) addParaToStep(cur, fake, false); else sec.intro.push(fake);
        }
        return;
      }
      var pi = b;
      if (!pi.text.trim()) return;
      var plain = pi.text.replace(/`/g, '');
      var lvl = pi.heading;
      if (lvl === null && !pi.numId && pi.bold && plain.length <= 40 && RE_MANUAL_HEAD.test(plain) && !/[。]$/.test(plain)) {
        var mm = plain.match(/^[0-9０-９]+((?:[\.．][0-9０-９]+)*)/); lvl = mm ? Math.min(6, (mm[1].match(/[\.．]/g) || []).length + 1) : 1;
      }
      if (lvl !== null && lvl !== undefined && plain.length <= 120) {
        closeSec();
        path[lvl] = plain.trim(); path.length = lvl + 1;
        if (lvl === 0 && !docTitle) docTitle = plain.trim();
        newSec(); return;
      }
      var listType = pi.listFmt, ilvl = pi.ilvl || 0;
      if (!listType) {
        if (RE_MANUAL_NUM.test(plain) && !isCmdLine(plain) && !RE_EXPECTED.test(plain)) { listType = 'number'; ilvl = /^\s+/.test(plain) ? 1 : 0; }
        else if (RE_MANUAL_BULLET.test(plain)) { listType = 'bullet'; ilvl = 1; }
      }
      if (listType) {
        var starts = (ilvl === 0 && (listType === 'number' || !sec.sawNumbered)) || (!cur && !(listType === 'bullet' && sec.intro.length && !sec.hasItems && false));
        if (listType === 'bullet' && cur && sec.sawNumbered) starts = false;
        if (listType === 'bullet' && ilvl > 0 && cur) starts = false;
        if (starts) {
          if (!sec.hasItems) flushIntro(true); else flushIntro('trail');
          sec.hasItems = true; if (listType === 'number') sec.sawNumbered = true;
          cur = mk(plain.split('\n')[0].replace(RE_MANUAL_NUM, '').replace(RE_MANUAL_BULLET, ''));
          addParaToStep(cur, pi, false);
        } else addParaToStep(cur, pi, true);
        return;
      }
      if (cur) addParaToStep(cur, pi, false); else sec.intro.push(pi);
    });
    closeSec();
    return {
      title: docTitle, steps: steps.map(function (s) {
        var st = { section: s.section, title: s.title, context: s.context || '', content: s.lines.join('\n'), expected: s.exp.join('\n') };
        st.inputs = detectInputs(st); return st;
      })
    };
  }

  function collectBlocks(body, C, out) {
    kids(body).forEach(function (el) {
      if (el.localName === 'p') { var pi = paraInfo(el, C); out.push(pi); }
      else if (el.localName === 'tbl') out.push({ kind: 'tbl', el: el, C: C });
      else if (el.localName === 'sdt') collectBlocks(kid(el, 'sdtContent'), C, out);
      else if (el.localName === 'customXml') collectBlocks(el, C, out);
    });
    return out;
  }

  async function parseDocx(arrayBuffer) {
    var zip = await JSZip.loadAsync(arrayBuffer);
    var docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('不是有效的 Word .docx 文件（找不到 word/document.xml）');
    var xml = await docFile.async('string');
    var stylesXml = zip.file('word/styles.xml') ? await zip.file('word/styles.xml').async('string') : '';
    var numXml = zip.file('word/numbering.xml') ? await zip.file('word/numbering.xml').async('string') : '';
    var C = { styles: parseStyles(stylesXml), numbering: parseNumbering(numXml) };
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var body = doc.getElementsByTagNameNS(WNS, 'body')[0];
    var blocks = collectBlocks(body, C, []);
    var title = null;
    var core = zip.file('docProps/core.xml');
    if (core) { var cx = await core.async('string'); var tm = cx.match(/<dc:title>([^<]*)<\/dc:title>/); if (tm && tm[1].trim()) title = tm[1].trim(); }
    return segment(blocks, title);
  }

  return { parseDocx: parseDocx, detectInputs: detectInputs, detectInLines: detectInLines, isCmdLine: isCmdLine, stripPrompt: stripPrompt, BLANK_SRC: BLANK_SRC };
})();
