/* 输入校验 + 比对判定（与 ba/rules.py、ba/compare.py 逻辑一致；共用 tests/vectors/*.json 做一致性测试） */
(function (root) {
  'use strict';
  var MESSAGES = { required: '必填', options: '不在允许的选项中', number: '不是数字', min: '小于最小值 {min}', max: '大于最大值 {max}', preset: '格式不符：{label}', pattern: '不符合正则 {pattern}', bad_pattern: '正则无效' };
  var PRESETS = {};
  function fmt(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }
  function norm(v) { return v == null ? '' : String(v).normalize('NFKC').trim(); }
  function toNumber(v) { var s = norm(v).replace(/,/g, ''); return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? parseFloat(s) : null; }
  function full(p, s) { try { return new RegExp('^(?:' + p + ')$').test(s); } catch (e) { return null; } }
  function empty(x) { return x === null || x === undefined || x === ''; }
  function validate(item, value) {
    var r = item.rules || {}, errs = [], s = norm(value);
    if (s === '') { if (r.required) errs.push({ code: 'required', message: MESSAGES.required }); return errs; }
    var opts = item.options && item.options.length ? item.options : (r.options || []);
    if (item.type === 'dropdown' && opts.length && !r.allow_other && opts.map(norm).indexOf(s) < 0) errs.push({ code: 'options', message: MESSAGES.options });
    if (item.type === 'number' || !empty(r.min) || !empty(r.max)) {
      var n = toNumber(s);
      if (n === null) errs.push({ code: 'number', message: MESSAGES.number });
      else {
        if (!empty(r.min) && n < parseFloat(r.min)) errs.push({ code: 'min', message: fmt(MESSAGES.min, { min: r.min }) });
        if (!empty(r.max) && n > parseFloat(r.max)) errs.push({ code: 'max', message: fmt(MESSAGES.max, { max: r.max }) });
      }
    }
    if (r.preset && PRESETS[r.preset] && !full(PRESETS[r.preset].pattern, s)) errs.push({ code: 'preset', message: fmt(MESSAGES.preset, { label: PRESETS[r.preset].label }) });
    if (r.pattern) { var ok = full(r.pattern, s); if (ok === null) errs.push({ code: 'bad_pattern', message: MESSAGES.bad_pattern }); else if (!ok) errs.push({ code: 'pattern', message: fmt(MESSAGES.pattern, { pattern: r.pattern }) }); }
    return errs;
  }
  // ---- compare.judge ----
  var UNIT = { gib: 'gib', gb: 'gib', g: 'gib', mib: 'mib', mb: 'mib', m: 'mib', tib: 'tib', tb: 'tib', t: 'tib', '': '', core: '', cores: '', vcpu: '', '個': '' };
  function cnorm(s) { return (s == null ? '' : String(s)).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function judge(expected, actual) {
    var e = cnorm(expected), a = cnorm(actual);
    if (a === '') return 'missing';
    if (e === '') return 'no_expected';
    if (e === a) return 'match';
    var re = /^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z%]*)$/, me = e.replace(/,/g, '').match(re), ma = a.replace(/,/g, '').match(re);
    if (me && ma) {
      var ue = me[2] in UNIT ? UNIT[me[2]] : me[2], ua = ma[2] in UNIT ? UNIT[ma[2]] : ma[2];
      return ((ue === ua || ue === '' || ua === '') && parseFloat(me[1]) === parseFloat(ma[1])) ? 'match' : 'mismatch';
    }
    var te = e.split(/[,\s]+/).filter(Boolean), ta = a.split(/[,\s]+/).filter(Boolean);
    if (te.length > 1 || ta.length > 1) return te.slice().sort().join('\u0000') === ta.slice().sort().join('\u0000') ? 'match' : 'mismatch';
    return 'mismatch';
  }
  var api = { validate: validate, judge: judge, setPresets: function (p, m) { PRESETS = p || {}; if (m) MESSAGES = m; }, presets: function () { return PRESETS; },
    STATUS_LABEL: { match: '一致', mismatch: '不一致', missing: '未填写', no_expected: '无期待值' } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Rules = api;
})(this);
