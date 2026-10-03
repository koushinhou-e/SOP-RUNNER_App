// 同一组测试向量验证浏览器端 web/js/rules.js 与 Python 端结果一致：node tests/js/vectors_test.js
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const Rules = require(path.join(ROOT, 'web/js/rules.js'));
Rules.setPresets(JSON.parse(fs.readFileSync(path.join(ROOT, 'ba/rules_presets.json'), 'utf8')));
let fail = 0, n = 0;
for (const v of JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/vectors/rules_vectors.json'), 'utf8'))) {
  n++; const got = Rules.validate(v.item, v.value).map(e => e.code);
  if (JSON.stringify(got) !== JSON.stringify(v.codes)) { fail++; console.log('rules FAIL', JSON.stringify(v), '→', got); }
}
for (const [e, a, r] of JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/vectors/compare_vectors.json'), 'utf8'))) {
  n++; const got = Rules.judge(e, a); if (got !== r) { fail++; console.log('judge FAIL', e, '|', a, '→', got, 'expected', r); }
}
console.log(`JS vectors: ${n - fail}/${n} passed`); process.exit(fail ? 1 : 0);
