/* ===================== 执行记录导出 (.docx) =====================
 * 分三层，方便以后替换为公司证跡模板：
 *   1) RecordModel.build(state)   → 纯数据（与版式无关）
 *   2) ExportTemplates[name].render(record, labels) → { 'word/document.xml': '...', ... } 部件
 *   3) DocxWriter.pack(parts)      → Blob（补齐 [Content_Types]、rels、styles 等通用部件）
 * 换模板 = 新增一个 ExportTemplates 条目（例如把公司模板 document.xml 里的 {{占位符}} 替换后返回）。
 */
var Fmt = {
  pad: function (n) { return (n < 10 ? '0' : '') + n; },
  local: function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getFullYear() + '-' + Fmt.pad(d.getMonth() + 1) + '-' + Fmt.pad(d.getDate()) + ' ' + Fmt.pad(d.getHours()) + ':' + Fmt.pad(d.getMinutes()) + ':' + Fmt.pad(d.getSeconds());
  },
  tz: function () { var o = -new Date().getTimezoneOffset(), s = o >= 0 ? '+' : '-'; o = Math.abs(o); return 'UTC' + s + Fmt.pad(Math.floor(o / 60)) + ':' + Fmt.pad(o % 60); }
};

var RecordModel = {
  build: function (S) {
    var rows = S.steps.map(function (st, i) {
      var r = S.results[st.id] || {};
      return {
        no: i + 1, section: st.section || '', title: st.title || '', content: st.content || '', expected: st.expected || '',
        values: (st.inputs || []).map(function (inp) { var v = (r.values || {})[inp.id]; return { label: inp.label, type: inp.type, unit: inp.unit || '', value: inp.type === 'check' ? (v ? '☑' : '☐') : (v == null ? '' : String(v)) }; }),
        confirmedAt: r.confirmedAt ? Fmt.local(r.confirmedAt) : '', note: r.note || '', anomaly: !!r.anomaly
      };
    });
    return {
      docName: S.docName, docTitle: S.docTitle || S.docName, hash: S.hash, executor: S.executor || '',
      startedAt: Fmt.local(S.startedAt), finishedAt: Fmt.local(S.finishedAt), tz: Fmt.tz(), exportedAt: Fmt.local(new Date().toISOString()),
      total: rows.length, confirmed: rows.filter(function (r) { return r.confirmedAt; }).length, anomalies: rows.filter(function (r) { return r.anomaly; }).length, rows: rows
    };
  }
};

var ExportLabels = {
  ja: { title: '作業実施記録', doc: '手順書名', hash: '文書ハッシュ', executor: '実施者', start: '開始日時', end: '終了日時', tz: 'タイムゾーン', total: '手順数', confirmed: '確認済', anomalies: '異常件数', exported: '出力日時', no: 'No.', step: '手順', expected: '期待結果', values: '記録値', at: '確認日時', note: '備考', anom: '異常', yes: 'あり', none: '－', footer: '本記録は SOP Runner（オフライン版）により出力されました。' },
  zh: { title: '作业执行记录', doc: '手顺书名称', hash: '文档哈希', executor: '执行者', start: '开始时间', end: '结束时间', tz: '时区', total: '步骤数', confirmed: '已确认', anomalies: '异常数', exported: '导出时间', no: '序号', step: '步骤', expected: '期待结果', values: '记录值', at: '确认时间', note: '备注', anom: '异常', yes: '有', none: '－', footer: '本记录由 SOP Runner（离线版）生成。' }
};

var Ox = {
  esc: function (s) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  run: function (text, o) {
    o = o || {};
    var rpr = '';
    if (o.mono) rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="MS Gothic"/>';
    if (o.bold) rpr += '<w:b/>';
    if (o.color) rpr += '<w:color w:val="' + o.color + '"/>';
    if (o.size) rpr += '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>';
    var parts = String(text == null ? '' : text).split('\n').map(function (t) { return '<w:t xml:space="preserve">' + Ox.esc(t) + '</w:t>'; }).join('<w:br/>');
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + parts + '</w:r>';
  },
  p: function (runs, o) {
    o = o || {};
    var ppr = '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 40 : o.after) + '"/>';
    if (o.align) ppr += '<w:jc w:val="' + o.align + '"/>';
    return '<w:p><w:pPr>' + ppr + '</w:pPr>' + (Array.isArray(runs) ? runs.join('') : runs) + '</w:p>';
  },
  cell: function (paras, w, o) {
    o = o || {};
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>' : '') + '</w:tcPr>' + (paras.length ? paras.join('') : Ox.p('')) + '</w:tc>';
  },
  table: function (widths, rows, o) {
    o = o || {};
    var b = '<w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:color="808080"/>';
    return '<w:tbl><w:tblPr><w:tblW w:w="' + widths.reduce(function (a, c) { return a + c; }, 0) + '" w:type="dxa"/><w:tblBorders>' + b + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' +
      rows.map(function (r, i) { return '<w:tr>' + (i === 0 && o.header ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>') + r + '</w:tr>'; }).join('') + '</w:tbl>';
  },
  /** content 文本（含 `命令` 约定）→ 段落数组 */
  contentParas: function (text, size) {
    return String(text || '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) {
      var m = l.trim().match(/^`([^`]*)`$/);
      if (m) return Ox.p(Ox.run(m[1], { mono: true, size: size }));
      var runs = l.split(/(`[^`]*`)/).filter(Boolean).map(function (seg) { var mm = seg.match(/^`([^`]*)`$/); return mm ? Ox.run(mm[1], { mono: true, size: size }) : Ox.run(seg, { size: size }); });
      return Ox.p(runs);
    });
  }
};

var ExportTemplates = {
  'simple-table': {
    name: '简单表格（横向 A4）',
    render: function (R, L) {
      var S = 18, P = Ox.p, run = Ox.run, cell = Ox.cell;
      var body = [];
      body.push(P(run(L.title, { bold: true, size: 32 }), { align: 'center', after: 120 }));
      var info = [[L.doc, R.docTitle + (R.docTitle !== R.docName ? '（' + R.docName + '）' : '')], [L.executor, R.executor], [L.start, R.startedAt], [L.end, R.finishedAt], [L.tz, R.tz],
        [L.total + ' / ' + L.confirmed + ' / ' + L.anomalies, R.total + ' / ' + R.confirmed + ' / ' + R.anomalies], [L.hash, R.hash], [L.exported, R.exportedAt]];
      body.push(Ox.table([2600, 8000], info.map(function (kv) { return cell([P(run(kv[0], { bold: true, size: 20 }))], 2600, { fill: 'EDEFF3' }) + cell([P(run(kv[1], { size: 20 }))], 8000); })));
      body.push(P('', { after: 120 }));
      var W = [520, 4700, 2500, 2700, 1500, 2100, 700];
      var hdr = [L.no, L.step, L.expected, L.values, L.at, L.note, L.anom].map(function (h, i) { return cell([P(run(h, { bold: true, size: S }), { align: 'center' })], W[i], { fill: 'D9E2F3' }); }).join('');
      var rows = [hdr];
      R.rows.forEach(function (r) {
        var fill = r.anomaly ? 'FDE2E2' : null;
        var stepParas = [];
        if (r.section) stepParas.push(P(run(r.section, { size: 16, color: '666666' })));
        stepParas.push(P(run(r.title, { bold: true, size: S })));
        stepParas = stepParas.concat(Ox.contentParas(r.content, S));
        var vals = r.values.map(function (v) { return P([run(v.label + '：', { size: S, color: '444444' }), run(v.value + (v.value && v.unit ? ' ' + v.unit : ''), { size: S, bold: true })]); });
        rows.push([
          cell([P(run(String(r.no), { size: S }), { align: 'center' })], W[0], { fill: fill }),
          cell(stepParas, W[1], { fill: fill }),
          cell(Ox.contentParas(r.expected, S), W[2], { fill: fill }),
          cell(vals, W[3], { fill: fill }),
          cell([P(run(r.confirmedAt, { size: S }))], W[4], { fill: fill }),
          cell([P(run(r.note, { size: S }))], W[5], { fill: fill }),
          cell([P(run(r.anomaly ? L.yes : L.none, { size: S, bold: r.anomaly, color: r.anomaly ? 'C00000' : null }), { align: 'center' })], W[6], { fill: fill })
        ].join(''));
      });
      body.push(Ox.table(W, rows, { header: true }));
      body.push(P(run(L.footer, { size: 16, color: '888888' }), { before: 120 }));
      var sect = '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>';
      var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body.join('') + sect + '</w:body></w:document>';
      return { 'word/document.xml': xml };
    }
  }
};

var DocxWriter = {
  pack: function (parts, meta) {
    meta = meta || {};
    var zip = new JSZip();
    var NS_PKG = 'http://schemas.openxmlformats.org/package/2006/';
    var NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    var defaults = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="' + NS_PKG + 'content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + NS_PKG + 'relationships"><Relationship Id="rId1" Type="' + NS_REL + 'officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="' + NS_PKG + 'relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + NS_PKG + 'relationships"><Relationship Id="rId1" Type="' + NS_REL + 'styles" Target="styles.xml"/></Relationships>',
      'word/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Yu Gothic" w:eastAsia="Yu Gothic" w:hAnsi="Yu Gothic" w:cs="Yu Gothic"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
      'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="' + NS_PKG + 'metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + Ox.esc(meta.title || '') + '</dc:title><dc:creator>' + Ox.esc(meta.creator || '') + '</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created></cp:coreProperties>'
    };
    Object.keys(defaults).forEach(function (k) { if (!parts[k]) zip.file(k, defaults[k]); });
    Object.keys(parts).forEach(function (k) { zip.file(k, parts[k]); });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
};

function exportRecordDocx(S, templateName, lang) {
  var record = RecordModel.build(S);
  var tpl = ExportTemplates[templateName] || ExportTemplates['simple-table'];
  var parts = tpl.render(record, ExportLabels[lang] || ExportLabels.ja);
  return DocxWriter.pack(parts, { title: record.docTitle + ' - ' + (ExportLabels[lang] || ExportLabels.ja).title, creator: record.executor });
}
