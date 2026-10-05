// E2E: 用“干净”的 Python（-I -S，只用 vendor/）启动应用，Headless Chromium 走完主要流程。
// 浏览器的一切非 127.0.0.1 请求都会被拦截并记录；最后断言为 0。
//   PYTHON=/path/to/python node tests/e2e/e2e.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const S = p => path.join(ROOT, 'samples', p);
const OUT = path.join(ROOT, 'tests', '_out'); const SHOT = path.join(ROOT, 'screenshots'); const SHOTF = path.join(ROOT, 'screenshots_feature');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SHOT, { recursive: true }); fs.mkdirSync(SHOTF, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-e2e-'));
const PY = process.env.PYTHON || 'python3';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

// 作業入力値一覧 PDF：ボックスでは Chromium 系ブラウザを候補に指定（Windows では Edge を自動検出）
// PDF 用ブラウザ：Linux の Chromium / Chrome、無ければ Playwright の chromium-headless-shell
// （Playwright 同梱の “Chrome for Testing” 本体は --print-to-pdf でハングすることがあるため使わない）
const headlessShell = (() => { try { const d = path.dirname(path.dirname(chromium.executablePath())); const base = path.dirname(d); const hs = fs.readdirSync(base).filter(n => n.startsWith('chromium_headless_shell-')).sort().pop(); if (!hs) return null; const sub = fs.readdirSync(path.join(base, hs)).find(n => n.startsWith('chrome-headless-shell')); return sub ? path.join(base, hs, sub, 'chrome-headless-shell') : null; } catch (e) { return null; } })();
const PDF_BROWSER = process.env.BA_PDF_BROWSER || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', headlessShell].find(p => p && fs.existsSync(p)) || 'none';
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(PY, ['-I', '-S', path.join(ROOT, 'app.py'), '--no-browser', '--port', '0', '--data-dir', DATA], { cwd: os.tmpdir(), env: Object.assign({}, process.env, { BA_PDF_BROWSER: PDF_BROWSER }) });
    let buf = '';
    proc.stdout.on('data', d => { buf += d; const m = buf.match(/起動しました: (http:\/\/127\.0\.0\.1:\d+\/)/); if (m) resolve({ proc, url: m[1] }); });
    proc.stderr.on('data', d => process.stderr.write('[server] ' + d));
    proc.on('exit', c => reject(new Error('server exited ' + c + ' ' + buf)));
    setTimeout(() => reject(new Error('server start timeout')), 15000);
  });
}

(async () => {
  const { proc, url } = await startServer();
  console.log('server:', url, 'python:', PY, '(-I -S, vendored deps only)', 'pdf browser:', PDF_BROWSER);
  const origin = url.replace(/\/$/, '');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const external = [], errors = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(origin + '/') || /^(blob|data):/.test(u)) return r.continue(); external.push(u); return r.abort(); });
  const page = await ctx.newPage();
  page.on('websocket', w => external.push(w.url()));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let promptAnswer = null;
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept());
  const api = (p, opt = {}) => page.evaluate(([p, opt]) => fetch(p, Object.assign({ headers: { 'X-Token': Api.token, 'Content-Type': 'application/json' } }, opt)).then(r => r.json()), [p, opt]);
  const shot = async () => { await page.evaluate(() => { document.querySelector('#toast').classList.remove('show'); window.scrollTo(0, 0); }); await page.waitForTimeout(300); };
  const dl = async (clickSel, name) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]); const p = path.join(OUT, name); await d.saveAs(p); return { p, name: d.suggestedFilename() }; };

  try {
    console.log('1) 模板库：上传');
    await page.goto(url);
    await page.waitForSelector('.up[data-type=param_sheet]');
    await page.setInputFiles('.up[data-type=param_sheet] input[type=file]', S('EC2パラメータシート_sample.xlsx'));
    await page.waitForSelector('.lib-param_sheet tr[data-id]');
    ok((await page.textContent('.lib-param_sheet')).includes('パラメータ 13 × サーバ web01, web02, db01'), '参数表解析：13 参数 × 3 服务器');
    await page.setInputFiles('#upCmd input[type=file]', S('command_templates_sample.json'));
    await page.waitForSelector('.lib-command_set tr[data-id]');
    await page.setInputFiles('.up[data-type=procedure] input[type=file]', S('Webサーバ定期パッチ適用手順書.docx'));
    await page.waitForSelector('.lib-procedure tr[data-id]');
    await page.setInputFiles('.up[data-type=excel_template] input[type=file]', S('構築結果報告書_template_sample.xlsx'));
    await page.waitForSelector('#itemTable');
    ok((await page.textContent('#edCount')).includes('全 50 項目'), '交付物模板检测：50 项');

    console.log('2) 模板编辑：映射 / 调整检测项');
    await page.selectOption('#edParam', { label: 'EC2パラメータシート_sample' });
    await page.waitForFunction(() => document.querySelectorAll('#itemTable option[value^="param:"]').length > 0);
    await page.click('#edAuto');
    await page.waitForFunction(() => /パラメータ 11/.test(document.querySelector('#edCount').textContent));
    ok(true, '按标签自动映射：11 项映射到参数');
    ok(await page.locator('#gridPrev td.hit.param').count() === 11, '网格预览：11 个蓝色(参数)单元格');
    ok(await page.locator('#gridPrev td.hit.result').count() === 11 && await page.locator('#gridPrev td.hit.judge').count() === 11, '自动映射：確認結果列 11 → 作業結果、判定列 11 → 判定（OK/NG）');
    await page.click('#gridPrev td[data-addr="C7"]');           // 点击空单元格 → 添加检测项
    let tm = await api('/api/library?type=excel_template');
    await page.waitForSelector('#itemTable tr.sel');
    await page.fill('#itemTable tr.sel input[data-f=label]', '管理番号');
    await page.fill('#itemTable tr.sel input[data-f=pattern]', 'MNG-[0-9]{4}');
    const row22 = page.locator('#itemTable tr', { has: page.locator('input[data-f=cell][value="C22"]') });
    await row22.locator('input[data-f=label]').fill('特記事項（任意）');
    const rowF9 = page.locator('#itemTable tr', { has: page.locator('input[data-f=cell][value="F9"]') });
    await rowF9.locator('button[data-f=del]').click();
    await page.waitForFunction(() => /全 50 項目/.test(document.querySelector('#edCount').textContent));   // +1 (C7) -1 (F9)
    await page.evaluate(() => document.querySelector('#gridPrev').scrollTo(0, 0));
    await shot(); await page.screenshot({ path: path.join(SHOT, '02-template-mapping.png') });
    await page.click('#edSave');
    await page.waitForFunction(() => !/未保存/.test(document.querySelector('#edStat').textContent));
    tm = (await api('/api/library?type=excel_template')).items[0];
    const byCell = Object.fromEntries(tm.items.map(i => [i.cell, i]));
    ok(byCell.C7 && byCell.C7.label === '管理番号' && byCell.C7.rules.pattern === 'MNG-[0-9]{4}' && !byCell.F9 && byCell.C22.label === '特記事项（任意）'.replace('项', '項') && tm.param_ref, '保存：新增 C7(管理番号+正则)、删除 F9、改名 C22、参照参数表');

    console.log('3) 命令模板集编辑：lint 预览');
    await page.click('[data-act=backLib]');
    await page.waitForSelector('.lib-command_set button[data-act=openItem]');
    await shot(); await page.screenshot({ path: path.join(SHOT, '01-library.png') });
    await page.click('.lib-command_set button[data-act=openItem]');
    await page.waitForSelector('#ceTable');
    await page.waitForFunction(() => document.querySelectorAll('#cePreview .cmdcard').length === 9);
    ok(await page.locator('#cePreview .warn').count() === 0, '示例 9 条命令：无安全警告');
    await page.click('#ceAdd');
    await page.waitForSelector('#ceTable tr[data-i="9"]');
    await page.fill('#ceTable tr[data-i="9"] textarea', 'aws ec2 describe-instances --instance-ids {{instance_id}} | less');
    await page.waitForFunction(() => document.querySelectorAll('#cePreview .cmdcard[data-cmd="9"] .warn').length >= 3);
    const warns = await page.textContent('#cePreview .cmdcard[data-cmd="9"]');
    ok(/no-cli-pager/.test(warns) && /--output/.test(warns) && /対話型/.test(warns), 'lint：缺 --no-cli-pager / --output、交互式 less → 警告');
    await page.click('#ceTable tr[data-i="9"] button[data-f=del]');
    await page.click('[data-act=backLib]');
    // 重命名 + 删除
    promptAnswer = 'EC2 確認コマンド（改名）';
    await page.click('.lib-command_set button[data-act=rename]');
    await page.waitForFunction(() => /改名/.test(document.querySelector('.lib-command_set').textContent));
    ok(true, '模板库：重命名');
    await page.setInputFiles('.up[data-type=param_sheet] input[type=file]', S('EC2パラメータシート_sample.xlsx'));
    await page.waitForFunction(() => document.querySelectorAll('.lib-param_sheet tr[data-id]').length === 2);
    await page.click('.lib-param_sheet tr[data-id] button[data-act=delItem]');   // 删除最新的那一份
    await page.waitForFunction(() => document.querySelectorAll('.lib-param_sheet tr[data-id]').length === 1);
    ok(true, '模板库：删除');

    console.log('4) 作业：新建 → 输入检查');
    await page.click('#nav [data-tab=jobs]');
    await page.waitForSelector('#jfSave');
    await page.fill('#jfName', 'web01 構築確認（サンプル）');
    await page.selectOption('#jfSrv', 'web01');
    const prId = (await api('/api/library?type=procedure')).items[0].id;
    await page.selectOption('#jfPr', prId);
    await page.click('#jfSave');
    await page.waitForSelector('#inTable');
    ok(/ルール違反 \d+ 件/.test(await page.textContent('#inStat')), '未填写时显示错误统计');
    const inId = c => `#inTable [data-in="構築結果!${c}"]`;
    await page.fill(inId('C3'), 'サンプル基盤構築');
    await page.fill(inId('C4'), '2026/13/40');
    await page.fill(inId('C5'), '山田 太郎');
    await page.fill(inId('C6'), '佐藤 花子');
    await page.fill(inId('C7'), 'ABC-1');
    ok(await page.locator(inId('C4') + '.invalid').count() === 1, '日期格式错误 → 红色');
    ok(await page.locator(inId('C7') + '.invalid').count() === 1, '自定义正则 MNG-[0-9]{4} 不符 → 红色');
    ok(await page.locator(inId('C21') + '.invalid').count() === 1, '必填下拉未选 → 红色');
    ok(await page.locator('#inTable [data-in="構築結果!D9"], #inTable [data-in="構築結果!E9"]').count() === 0, '確認結果・判定列不是作业输入（由作业结果自动填写）');
    ok(await page.locator('#roTable .invalid').count() === 0, '来自参数表的 11 个值全部通过规则检查');
    await shot(); await page.screenshot({ path: path.join(SHOT, '03-inputs-validation.png') });
    await page.fill(inId('C4'), '2026/10/03');
    await page.fill(inId('C7'), 'MNG-0042');
    await page.selectOption(inId('C21'), '合格');
    ok(await page.locator('#inTable .invalid').count() === 0 && /全 \d+ 項目 チェック OK/.test(await page.textContent('#inStat')), '修正后全部通过');
    await page.waitForTimeout(500);

    console.log('5) 命令生成');
    await page.click('[data-jt=commands]');
    await page.waitForSelector('#cmdList .cmdcard');
    ok(await page.locator('#cmdList .cmdcard').count() === 9 && await page.locator('#cmdList .warn, #cmdList .miss').count() === 0, '9 条命令、无警告、无未解析占位符');
    ok((await page.textContent('#cmdList')).includes('--instance-ids i-0123456789abcdef0'), '占位符替换为 web01 的实例ID');
    await page.click('#cmdList .cmdcard[data-cmd="5"] button[data-copy]');
    ok((await page.textContent('#toast')).includes("ssh -n -o BatchMode=yes"), '复制按钮');
    await shot(); await page.screenshot({ path: path.join(SHOT, '04-commands.png') });
    const sh = await dl('#dlSh', 'check.sh'), ps1 = await dl('#dlPs1', 'check.ps1');
    const shTxt = fs.readFileSync(sh.p, 'utf8'), ps1Buf = fs.readFileSync(ps1.p);
    ok(shTxt.startsWith('#!/usr/bin/env bash') && shTxt.includes("export AWS_PAGER=''") && (shTxt.match(/--no-cli-pager/g) || []).length === 4 && (shTxt.match(/BatchMode=yes/g) || []).length === 5, '.sh 下载：' + sh.name);
    ok(ps1Buf[0] === 0xef && ps1Buf.toString('utf8').includes("$env:AWS_PAGER = ''") && ps1Buf.toString('utf8').includes('\r\n'), '.ps1 下载（UTF-8 BOM + CRLF）：' + ps1.name);
    await page.fill('[data-gl=region]', 'ap-northeast-3'); await page.press('[data-gl=region]', 'Tab');
    await page.waitForFunction(() => /--region ap-northeast-3/.test(document.querySelector('#cmdList').textContent));
    ok(true, '覆盖变量 {{region}} → 命令即时更新');
    await page.fill('[data-gl=region]', ''); await page.press('[data-gl=region]', 'Tab');
    await page.waitForFunction(() => /--region ap-northeast-1/.test(document.querySelector('#cmdList').textContent));

    console.log('6) 参数比对');
    await page.click('[data-jt=compare]');
    await page.waitForSelector('#cmpTable tr[data-key]');
    const exp = await page.$$eval('#cmpTable tr[data-key]', trs => trs.map(t => [t.getAttribute('data-key'), t.querySelector('td.exp').textContent]));
    ok(exp.length === 13, '比对项 13');
    for (const [k, e] of exp) {
      const v = k === 'instance_type' ? 't3.medium' : k === 'memory_gib' ? '8 GiB' : k === 'private_ip' ? '１９２.０.２.１１' : e;
      await page.fill(`#cmpTable tr[data-key="${k}"] input[data-cmp=actual]`, v);
      await page.click(`#cmpTable tr[data-key="${k}"] button[data-j=${k === 'instance_type' ? 'NG' : 'OK'}]`);
    }
    await page.fill('#cmpTable tr[data-key="instance_type"] input[data-cmp=note]', 'パラメータシートは t3.large。変更要否を確認中');
    ok(await page.locator('#cmpTable tr.mismatch').count() === 1 && await page.locator('#cmpTable tr[data-key="instance_type"].mismatch').count() === 1, '自动判定：只有 instance_type 不一致（8 GiB / 全角 IP 视为一致）');
    ok((await page.textContent('#cmpStat')).includes('NG 1') && (await page.textContent('#cmpStat')).includes('OK 12'), 'OK 12 / NG 1');
    await shot(); await page.screenshot({ path: path.join(SHOT, '05-compare.png') });
    const cmpx = await dl('#cmpExport', 'compare.xlsx');
    ok(/パラメータ比較_\d{8}-\d{6}\.xlsx$/.test(cmpx.name), '比对结果导出：' + cmpx.name);

    console.log('7) 交付物输出');
    await page.click('[data-jt=deliver]');
    await page.waitForSelector('#dvTable');
    ok((await page.textContent('#jobBody')).includes('39 セルに書き込みます'), '将写入 39 个单元格（参数 11 + 输入 6 + 確認結果 11 + 判定 11；可选的特记事项未填）');
    ok((await page.textContent('#dvTable')).includes('確認結果 instance_type') && (await page.textContent('#dvTable')).includes('t3.medium'), '交付物：確認結果列 = ③ 的实测值');
    await shot(); await page.screenshot({ path: path.join(SHOT, '06-deliverable.png') });
    await page.click('#dvExport');
    await page.waitForSelector('#modal .modal.warn');
    const warnTxt = await page.textContent('#modal');
    ok(warnTxt.includes('最終値に不一致・食い違いがあります') && warnTxt.includes('インスタンスタイプ') && warnTxt.includes('t3.medium') && warnTxt.includes('t3.large'), '导出前警告：最终值不一致（instance_type t3.medium ≠ t3.large）');
    await page.click('#modal button[data-mi="2"]');   // キャンセル
    ok(!(await page.$('#modal')), '警告对话框：取消 → 不导出');
    await page.click('#dvExport'); await page.waitForSelector('#modal .modal.warn');
    const dv = await dl('#modal button[data-mi="0"]', 'deliverable.xlsx');   // このまま出力する
    ok(/web01_\d{8}-\d{6}\.xlsx$/.test(dv.name), '交付物导出：' + dv.name);

    console.log('8) 手顺执行（v1 模块，进度存服务器）＋ 自定义证迹图片');
    await page.click('#jbProc');
    await page.waitForSelector('#sop-app #stepCount');
    ok(await page.textContent('#sop-app #stepCount') === '18', '从模板库打开手顺书：18 步（v1 解析器）');
    // 编辑模式：给第 3 步加 2 个证迹图片要求
    await page.waitForSelector('#sop-app #evLibNote');
    ok((await page.textContent('#evLibNote')).includes('テンプレートライブラリの手順書'), '证迹设置：识别为模板库中的手顺书（设置将保存到模板库）');
    const sid3 = await page.evaluate(() => SopApp.state().steps[2].id);
    await page.click(`#sop-app button[data-ev=addReq][data-sid="${sid3}"]`);
    await page.fill(`#sop-app input.ev-desc[data-sid="${sid3}"]`, 'EC2 詳細画面のスクリーンショット');
    await page.fill(`#sop-app input.ev-key[data-sid="${sid3}"]`, 'img_ec2');
    await page.click(`#sop-app button[data-ev=addReq][data-sid="${sid3}"]`);
    await page.locator(`#sop-app input.ev-desc[data-sid="${sid3}"]`).nth(1).fill('セキュリティグループ設定');
    ok(await page.locator(`#sop-app .ev-req input.ev-desc[data-sid="${sid3}"]`).count() === 2, '编辑模式：第 3 步添加了 2 个证迹图片要求');
    await page.waitForTimeout(900);   // 设置去抖保存到模板库
    await page.locator(`#sop-app input.ev-desc[data-sid="${sid3}"]`).first().scrollIntoViewIfNeeded();
    await shot(); await page.locator(`#sop-app input.ev-desc[data-sid="${sid3}"]`).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, '08-evidence-edit.png') });
    const procMeta = (await api('/api/library?type=procedure')).items[0];
    const evs = procMeta.evidence && procMeta.evidence.steps;
    ok(evs && evs.length === 1 && evs[0].index === 2 && evs[0].items.length === 2 && evs[0].items[0].desc === 'EC2 詳細画面のスクリーンショット' && evs[0].items[0].key === 'img_ec2', '证迹要求已保存到模板库的手顺书设置（meta.evidence）');
    // 入力項目にパラメータキーを設定（最終値チェック用）：第 1 步の「作業日」→ work_date、「作業者」→ worker
    const st1 = await page.evaluate(() => SopApp.state().steps[0]);
    const inpBy = l => st1.inputs.find(i => i.label === l);
    ok(!!inpBy('作業日') && !!inpBy('作業者'), '第 1 步有输入项「作業日」「作業者」');
    ok(await page.evaluate(() => document.querySelectorAll('#sopKeyList option[value="instance_type"]').length === 1 && document.querySelectorAll('#sopKeyList option[value="worker"]').length === 1), '键候选列表（datalist）：参数表的键 + 模板的作业输入键');
    await page.fill(`#sop-app input.sop-key[data-iid="${inpBy('作業日').id}"]`, 'work_date');
    await page.fill(`#sop-app input.sop-key[data-iid="${inpBy('作業者').id}"]`, 'worker');
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => SopApp.state().steps[0].inputs.filter(i => i.key).map(i => i.key).join(',')) === 'work_date,worker', '编辑模式：输入项绑定参数键（inp.key）');
    const keySteps = (((await api('/api/library?type=procedure')).items[0].evidence || {}).steps || []).find(x => x.index === 0);
    ok(keySteps && keySteps.inputKeys.map(k => k.label + '=' + k.key).join(',') === '作業日=work_date,作業者=worker', '输入项的键已保存到模板库（随手顺书再次读取时恢复）');
    await page.evaluate((iid) => { const el = document.querySelector(`#sop-app input.sop-key[data-iid="${iid}"]`); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 360); }, inpBy('作業者').id);
    await page.evaluate(() => document.querySelector('#toast').classList.remove('show')); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTF, '01-runner-key-binding.png') });
    await page.fill('#sop-app input[data-bind=executor]', '山田 太郎');
    await page.click('#sop-app #btnStart');
    await page.waitForSelector('#sop-app #btnConfirm');
    ok(await page.isDisabled('#sop-app #btnConfirm'), '确认按钮在输入未填时禁用');
    const fillStep = async () => {
      const st = await page.evaluate(() => SopApp.state().steps[SopApp.state().view]);
      for (const inp of st.inputs) {
        const sel = '#in_' + inp.id, tag = await page.$eval(sel, e => e.tagName + ':' + (e.type || ''));
        if (tag.startsWith('SELECT')) await page.selectOption(sel, { index: 1 });
        else if (tag.endsWith('checkbox')) await page.check(sel);
        else await page.fill(sel, inp.type === 'time' ? '2026-10-03 09:00' : inp.type === 'number' ? '1' : 'テスト');
      }
    };
    await fillStep(); await page.fill('#in_' + inpBy('作業者').id, '山田 太朗');   // ① の「山田 太郎」と食い違う値
    await page.click('#sop-app #btnConfirm');
    await fillStep(); await page.click('#sop-app #btnConfirm');
    await page.waitForSelector('#sop-app #evRun');
    await fillStep();
    ok(await page.isDisabled('#sop-app #btnConfirm') && (await page.textContent('#missHint')).includes('証跡画像「EC2 詳細画面のスクリーンショット」'), '第 3 步：输入已填但证迹图片未附 → 确认仍禁用，并提示缺少的图片');
    // 合成剪贴板粘贴（canvas 生成的 PNG）
    const mkImg = (type, label, w, h, bg) => page.evaluate(async ([type, label, w, h, bg]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = '#ff9900'; g.fillRect(0, 0, w, 56);
      g.fillStyle = '#ffffff'; g.font = 'bold 30px sans-serif'; g.fillText(label, 24, 40);
      g.fillStyle = '#e2e8f0'; for (let i = 0; i < 6; i++) g.fillRect(24, 90 + i * 50, w - 48 - i * 60, 26);
      const b = await new Promise(r => c.toBlob(r, type, 0.9));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    }, [type, label, w, h, bg]);
    const png1 = await mkImg('image/png', 'EC2 Instance summary  i-0123456789abcdef0', 1280, 720, '#232f3e');
    await page.evaluate(async (bytes) => {
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png1);
    const [req1, req2] = await page.evaluate(() => SopApp.state().steps[2].evidence.map(e => e.id));
    await page.waitForSelector(`#evRun .ev-box[data-rid="${req1}"] .ev-th img`);
    ok(await page.evaluate(r => SopApp.state().results[SopApp.state().steps[2].id].images[r].length, req1) === 1, '合成 Ctrl+V 粘贴（ClipboardEvent + PNG）→ 图片附到第 1 个要求');
    ok(await page.isDisabled('#sop-app #btnConfirm'), '仍有 1 个要求未附图 → 确认禁用');
    // 拖放（DragEvent + DataTransfer）
    const png2 = await mkImg('image/png', 'Security Group  sg-0abc  inbound 443', 900, 600, '#1e3a5f');
    await page.evaluate(async ([bytes, rid]) => {
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'sg-rules.png', { type: 'image/png' }));
      document.querySelector(`.ev-drop[data-rid="${rid}"]`).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [png2, req2]);
    await page.waitForSelector(`#evRun .ev-box[data-rid="${req2}"] .ev-th img`);
    ok(!(await page.isDisabled('#sop-app #btnConfirm')), '拖放附图后所有要求满足 → 确认按钮可用');
    // 文件选择（JPEG），然后删除
    const jpg = await mkImg('image/jpeg', 'extra JPEG', 640, 480, '#334155');
    await page.setInputFiles(`#evRun input[data-evfile="${req2}"]`, { name: 'extra.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) });
    await page.waitForFunction(r => document.querySelectorAll(`#evRun .ev-box[data-rid="${r}"] .ev-th`).length === 2, req2);
    const jpgMeta = await page.evaluate(r => SopApp.state().results[SopApp.state().steps[2].id].images[r][1], req2);
    ok(jpgMeta.ext === 'jpg' && jpgMeta.w === 640 && jpgMeta.h === 480 && fs.existsSync(path.join(DATA, 'sop_images', jpgMeta.id + '.jpg')), '文件选择 JPEG：640×480，保存到 data/sop_images/');
    await page.click(`#evRun .ev-th button[data-img="${jpgMeta.id}"]`);
    await page.waitForFunction(r => document.querySelectorAll(`#evRun .ev-box[data-rid="${r}"] .ev-th`).length === 1, req2);
    await page.waitForTimeout(300);
    ok(!fs.existsSync(path.join(DATA, 'sop_images', jpgMeta.id + '.jpg')), '删除缩略图：服务器上的图片文件也被删除');
    // 点击放大
    await page.click(`#evRun .ev-box[data-rid="${req1}"] .ev-th img`);
    await page.waitForSelector('#evZoom img');
    ok(await page.$eval('#evZoom img', i => i.complete && i.naturalWidth === 1280), '点击缩略图放大显示（原尺寸 1280px）');
    await shot(); await page.screenshot({ path: path.join(SHOT, '10-evidence-zoom.png') });
    await page.keyboard.press('Escape');
    ok(!(await page.$('#evZoom')), 'Esc 关闭放大');
    await page.locator('#evRun').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('#toast').classList.remove('show')); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOT, '09-evidence-run.png') });
    await page.evaluate(() => SopStore.flush());
    const files = fs.readdirSync(path.join(DATA, 'sop_sessions'));
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'sop_sessions', files[0]), 'utf8'));
    const savedImgs = saved.results[sid3].images;
    ok(files.length === 1 && Object.values(saved.results).filter(r => r.confirmedAt).length === 2, '进度已写入 data/sop_sessions/*.json（2 步已确认）');
    ok(savedImgs[req1].length === 1 && savedImgs[req2].length === 1 && !JSON.stringify(saved).includes('base64') && fs.statSync(path.join(DATA, 'sop_sessions', files[0])).size < 30000, '会话 JSON 只存图片元数据（无 base64）');
    const lsSize = await page.evaluate(() => Object.keys(localStorage).reduce((a, k) => a + localStorage.getItem(k).length, 0));
    ok(lsSize < 30000, 'localStorage 中无大体积图片数据（' + lsSize + ' 字符）');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('#nav [data-tab=sop]');
    await page.waitForSelector('#sop-app #sessions');
    ok((await page.textContent('#sop-app #sessions')).includes('2 / 18'), '清空 localStorage 并刷新后，从服务器恢复会话列表（2 / 18）');
    await page.click('#sop-app button[data-act=resume]');
    ok(await page.evaluate(() => SopApp.state().view) === 2, '继续执行：定位到第 3 步');
    await page.waitForSelector('#evRun .ev-th img');
    await page.waitForFunction(() => [...document.querySelectorAll('#evRun .ev-th img')].every(i => i.complete && i.naturalWidth > 0));
    ok(await page.locator('#evRun .ev-th img').count() === 2 && !(await page.isDisabled('#sop-app #btnConfirm')), '刷新后恢复：2 张证迹图片仍在、确认按钮可用');
    // 完成全部步骤 → 导出 Word 实施记录
    while (await page.$('#sop-app #btnConfirm')) {
      await fillStep();
      if (await page.isDisabled('#sop-app #btnConfirm')) break;
      await page.click('#sop-app #btnConfirm');
    }
    await page.waitForSelector('#btnExportDocx');
    // 全部步骤确认完成 → 询问是否制作確認結果報告書（只问一次；完成页上也有按钮）
    await page.waitForSelector('#modal .modal');
    ok((await page.textContent('#modal')).includes('確認結果報告書を作成しますか') && !!(await page.$('#sopReport #sopReportBtn')), '完成后：弹出“是否制作確認結果報告書”确认框，完成页有制作按钮');
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTF, '05-report-prompt.png') });
    await page.click('#modal button[data-mi="1"]');   // 今は作成しない
    ok(!(await page.$('#modal')) && await page.evaluate(() => !!SopApp.state().reportAskedAt), '“今は作成しない” → 关闭（记录已询问，不再弹出）');
    const docx = await dl('#btnExportDocx', 'record.docx');
    ok(/_実施記録_\d{8}-\d{4}\.docx$/.test(docx.name), 'Word 实施记录导出：' + docx.name);
    const zipInfo = await page.evaluate(async (b64) => {
      const z = await JSZip.loadAsync(b64, { base64: true }), names = Object.keys(z.files);
      return { names, rels: await z.file('word/_rels/document.xml.rels').async('string'), ct: await z.file('[Content_Types].xml').async('string'), doc: await z.file('word/document.xml').async('string') };
    }, fs.readFileSync(docx.p).toString('base64'));
    const media = zipInfo.names.filter(n => n.startsWith('word/media/') && !n.endsWith('/'));
    ok(media.length === 2 && (zipInfo.doc.match(/<w:drawing>/g) || []).length === 2 && media.every(m => zipInfo.rels.includes('Target="' + m.slice(5) + '"')) && zipInfo.ct.includes('Extension="png"'), 'docx：2 张图片（word/media + 关系 + 内容类型 + drawing）');
    ok(zipInfo.doc.includes('証跡 3-1：EC2 詳細画面のスクリーンショット'), 'docx：图片说明（证迹 3-1：…）');

    console.log('8a) 最终值一致性检查 + 作业输入值一览 PDF');
    const sessKey = await page.evaluate(() => SopApp.state().key);
    const savedSess = JSON.parse(fs.readFileSync(path.join(DATA, 'sop_sessions', fs.readdirSync(path.join(DATA, 'sop_sessions'))[0]), 'utf8'));
    ok(savedSess.results[st1.id].valuesAt && /Z$/.test(savedSess.results[st1.id].valuesAt[inpBy('作業者').id]), '手顺执行的输入值带输入时间（results[].valuesAt）');
    await page.click('#nav [data-tab=jobs]'); await page.click('[data-job]'); await page.click('[data-jt=values]');
    await page.waitForSelector('#vlTable');
    ok((await page.textContent('#vlBindMsg')).includes('未紐付け') && await page.$('#vlBindCand'), '最终值检查：未绑定时显示候选执行记录');
    await page.selectOption('#vlSop', sessKey);
    await page.waitForFunction(() => /紐付け済み/.test((document.querySelector('#vlBindMsg') || {}).textContent || ''));
    const jobNow = (await api('/api/jobs')).items[0];
    ok(jobNow.sop_key === sessKey, '作业绑定手顺执行记录（job.sop_key）');
    const vlStat = await page.textContent('#vlStat');
    ok(vlStat.includes('不一致 1') && vlStat.includes('食い違い 1'), '一致性面板：不一致 1 / 食い違い 1 ' + vlStat);
    const rowInfo = await page.evaluate(() => [...document.querySelectorAll('#vlTable tr[data-vkey]')].map(tr => ({ id: tr.getAttribute('data-vkey'), problem: tr.classList.contains('problem'), text: tr.textContent, bg: getComputedStyle(tr.cells[0]).backgroundColor })));
    const wRow = rowInfo.find(r => r.id === 'worker'), iRow = rowInfo.find(r => r.id === 'instance_type'), dRow = rowInfo.find(r => r.id === 'work_date');
    ok(wRow && wRow.problem && wRow.text.includes('食い違い') && wRow.text.includes('山田 太朗') && wRow.text.includes('山田 太郎') && wRow.text.includes('手順 1'), '作業者：手顺执行「山田 太朗」与 ①「山田 太郎」食い違い → 红色');
    ok(iRow && iRow.problem && iRow.text.includes('不一致') && iRow.text.includes('t3.medium'), 'インスタンスタイプ：最终值 t3.medium ≠ 要求值 t3.large → 红色');
    ok(dRow && !dRow.problem, '作業日：2026/10/03 与 2026-10-03 09:00 视为同一天（不报食い違い）');
    ok(/rgb\(254, 242, 242\)/.test(wRow.bg) && (await page.$eval('#vlAlert', e => getComputedStyle(e).color)) === 'rgb(153, 27, 27)', '问题行与提示条为红色');
    await page.waitForTimeout(1900); await shot();
    await page.screenshot({ path: path.join(SHOTF, '02-consistency-panel.png') });
    await page.evaluate(() => { const r = document.querySelector('#vlTable tr[data-vkey="worker"]'); window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - 330); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTF, '02c-consistency-conflict-rows.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    // PDF（Chromium 系ブラウザでヘッドレス印刷）
    await page.click('#vlPdf');
    await page.waitForSelector('#modal a.btnlink[download]', { timeout: 120000 });
    ok((await page.textContent('#modal')).includes('PDF を作成しました') && (await page.textContent('#modal')).includes('exports'), 'PDF 生成后显示保存位置（exports）');
    await shot(); await page.screenshot({ path: path.join(SHOTF, '02b-pdf-created.png') });
    const pdf = await dl('#modal a.btnlink[download]', 'values.pdf');
    ok(/作業入力値一覧_\d{8}-\d{6}\.pdf$/.test(pdf.name) && fs.readFileSync(pdf.p).slice(0, 5).toString() === '%PDF-', '作业输入值一览 PDF 生成：' + pdf.name);
    ok(fs.readdirSync(path.join(DATA, 'exports')).some(f => f === pdf.name), 'PDF 与其他交付物一起保存在 data/exports/');
    // フォールバック（ブラウザが無い場合）：印刷用ページへ誘導
    await page.route('**/values.pdf', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pdf: null, html: 'x.html', browser: null, error: 'Microsoft Edge（または Chrome / Chromium）が見つかりませんでした' }) }));
    await page.click('#vlPdf');
    await page.waitForSelector('#modal a.btnlink');
    ok((await page.textContent('#modal')).includes('PDF を自動作成できませんでした'), 'PDF 失败时：提示并提供打印用页面');
    const [printPage] = await Promise.all([ctx.waitForEvent('page'), page.click('#modal a.btnlink')]);
    await printPage.waitForLoadState();
    ok(await printPage.$('#printBtn') && (await printPage.textContent('table')).includes('入力元（手順/ページ）'), '打印用页面（window.print 按钮、A4 横）');
    ok(await printPage.evaluate(() => typeof window.print === 'function' && !!document.querySelector('script[src="/js/print.js"]')), '打印按钮脚本从本地加载（CSP 内）');
    await printPage.close();
    await page.unroute('**/values.pdf');

    console.log('8b) 交付物插入证迹图片（纯 Python，无 Pillow）');
    const tplId = (await api('/api/library?type=excel_template')).items[0].id;
    const tpl = await api('/api/library/' + tplId);
    // F9 已在步骤 2 中删除 → 重新添加为“证迹图片”映射（键 img_ec2）
    tpl.items.push(Object.assign({}, tpl.items[0], { id: '構築結果!F9', sheet: '構築結果', cell: 'F9', label: 'EC2 画面（証跡）', rules: {}, options: [], source: { kind: 'evidence', key: 'img_ec2' } }));
    await api('/api/library/' + tplId, { method: 'PUT', body: JSON.stringify({ items: tpl.items }) });
    await page.click('#nav [data-tab=jobs]'); await page.click('[data-job]'); await page.click('[data-jt=deliver]');
    await page.waitForSelector('#dvTable');
    await page.waitForFunction(() => !document.querySelector('#dvEvOn').disabled);
    ok((await page.textContent('#dvTable')).includes('証跡画像 img_ec2') && (await page.textContent('#dvEvSrc')).includes('画像 2 枚'), '交付物：映射显示“証跡画像 img_ec2”，可选择含 2 张图片的执行记录');
    await page.check('#dvEvOn');
    await page.waitForTimeout(2500); await shot();
    await page.screenshot({ path: path.join(SHOT, '11-deliverable-evidence.png') });
    ok(await page.$eval('#dvEvSrc', e => e.value) === sessKey, '交付物：证迹记录默认选中已绑定的执行记录');
    await page.click('#dvExport'); await page.waitForSelector('#modal .modal.warn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTF, '03-export-warning.png') });
    const dve = await dl('#modal button[data-mi="0"]', 'deliverable_evidence.xlsx');
    ok(/web01_\d{8}-\d{6}\.xlsx$/.test(dve.name), '含证迹图片的交付物导出：' + dve.name);

    console.log('8b2) 从手顺执行的完成页制作確認結果報告書（设定值 + 确认结果）');
    await page.click('#nav [data-tab=sop]');
    await page.waitForSelector('#sopReport #sopReportBtn');
    await page.click('#sopReportBtn');
    await page.waitForSelector('#modal .rp-rows');
    const jobId = (await api('/api/jobs')).items[0].id;
    ok(await page.$eval('#rpJob', e => e.value) === jobId, '报告书对话框：默认选中已绑定该执行记录的作业');
    const rpTxt = await page.textContent('#modal .rp-rows');
    ok(rpTxt.includes('t3.large') && rpTxt.includes('t3.medium') && rpTxt.includes('NG') && rpTxt.includes('web01.example.local'), '报告书对话框：设定值（参数表）/ 确认结果（作业输入值）/ 判定');
    ok(!!(await page.$('#rpEv:checked')), '报告书对话框：默认插入证迹图片');
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTF, '06-report-dialog.png') });
    const rpx = await dl('#rpOut', 'report.xlsx');
    ok(/web01_\d{8}-\d{6}\.xlsx$/.test(rpx.name) && !(await page.$('#modal')), '確認結果報告書导出：' + rpx.name);

    console.log('8c) 再次从模板库打开同一手顺书 → 证迹要求自动重新应用');
    await page.click('#nav [data-tab=sop]'); await page.click('#sop-hdr button[data-act=home]');
    await page.waitForSelector('#sop-app #sessions');
    await page.click('#sop-app button[data-act=delSession]');
    await page.waitForFunction(() => !document.querySelector('#sop-app button[data-act=delSession]'));
    await page.click('#sop-lib button[data-open-proc]');
    await page.waitForSelector('#sop-app .ev-req');
    const re = await page.evaluate(() => SopApp.state().steps[2].evidence);
    ok(re.length === 2 && re[0].desc === 'EC2 詳細画面のスクリーンショット' && re[0].key === 'img_ec2' && re[1].desc === 'セキュリティグループ設定', '新会话自动应用模板库中保存的证迹要求（第 3 步 2 项）');

    console.log('9) 响应式布局：1024 / 1280 宽度下各视图无横向溢出、按钮完整可见');
    const views = [
      ['模板库', async () => { await page.click('#nav [data-tab=library]'); await page.waitForSelector('.lib-excel_template tr[data-id]'); }],
      ['模板编辑', async () => { await page.click('.lib-excel_template button[data-act=openItem]'); await page.waitForSelector('#itemTable'); }],
      ['参数表', async () => { await page.click('[data-act=backLib]'); await page.click('.lib-param_sheet button[data-act=openItem]'); await page.waitForSelector('#paramTable'); }],
      ['命令集编辑', async () => { await page.click('[data-act=backLib]'); await page.click('.lib-command_set button[data-act=openItem]'); await page.waitForSelector('#cePreview .cmdcard'); }],
      ['①输入', async () => { await page.click('[data-act=backLib]'); await page.click('#nav [data-tab=jobs]'); await page.click('[data-job]'); await page.click('[data-jt=inputs]'); await page.waitForSelector('#inTable'); }],
      ['②命令', async () => { await page.click('[data-jt=commands]'); await page.waitForSelector('#cmdList .cmdcard'); }],
      ['③比对', async () => { await page.click('[data-jt=compare]'); await page.waitForSelector('#cmpTable tr[data-key]'); }],
      ['④最终值', async () => { await page.click('[data-jt=values]'); await page.waitForSelector('#vlTable'); }],
      ['⑤交付物', async () => { await page.click('[data-jt=deliver]'); await page.waitForSelector('#dvTable'); }],
      ['手顺执行(编辑+证迹)', async () => {
        await page.click('#nav [data-tab=sop]'); await page.waitForSelector('#sop-app');
        if (await page.evaluate(() => SopApp.state() && SopApp.state().phase !== 'edit')) {   // 第 2 轮：删除会话后从模板库重新打开（证迹要求再次自动应用）
          await page.click('#sop-hdr button[data-act=home]'); await page.click('#sop-app button[data-act=delSession]');
          await page.click('#sop-lib button[data-open-proc]');
        }
        await page.waitForSelector('#sop-app .ev-req');
      }],
      ['手顺执行(执行+证迹)', async () => {
        await page.fill('#sop-app input[data-bind=executor]', '山田 太郎'); await page.click('#sop-app #btnStart'); await page.waitForSelector('#sop-app #btnConfirm');
        await fillStep(); await page.click('#sop-app #btnConfirm'); await fillStep(); await page.click('#sop-app #btnConfirm');
        await page.waitForSelector('#evRun .ev-drop');
        const b = await mkImg('image/png', 'layout check', 800, 450, '#475569');
        await page.evaluate(async (bytes) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' })); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, b);
        await page.waitForSelector('#evRun .ev-th img');
      }],
    ];
    const layoutIssues = () => page.evaluate(() => {
      const W = document.documentElement.clientWidth, bad = [];
      if (document.documentElement.scrollWidth > W + 1) bad.push('page scrollWidth ' + document.documentElement.scrollWidth + ' > ' + W);
      document.querySelectorAll('.tab.on button, .tab:not(.hidden) button, header button').forEach(b => {
        const r = b.getBoundingClientRect(); if (!r.width || b.closest('.tscroll,.grid-prev,.hidden')) return;
        if (r.right > W + 1 || r.left < -1) bad.push('button "' + b.textContent.trim().slice(0, 20) + '" right=' + Math.round(r.right));
      });
      document.querySelectorAll('.ev-box,.ev-drop,.ev-req,.ev-xlsx,#evLibNote,.vl-bind,.vl-alert,#vlStat').forEach(t => { const r = t.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push('evidence overflow ' + t.className + ' ' + Math.round(r.right)); });
      document.querySelectorAll('.tscroll').forEach(t => { const r = t.getBoundingClientRect(); if (r.width && r.right > W + 1) bad.push('tscroll overflow ' + Math.round(r.right)); });
      return bad;
    });
    for (const w of [1024, 1280]) {
      await page.setViewportSize({ width: w, height: 900 });
      const issues = [];
      for (const [name, go] of views) {
        await go(); await page.waitForTimeout(150);
        (await layoutIssues()).forEach(x => issues.push(name + ': ' + x));
        if (w === 1024 && name === '③比对') { await shot(); await page.screenshot({ path: path.join(SHOT, '05-compare-1024.png') }); }
        if (w === 1024 && name === '手顺执行(执行+证迹)') { await page.evaluate(() => document.querySelector('#toast').classList.remove('show')); await page.locator('#evRun').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOT, '09-evidence-run-1024.png') }); }
      }
      ok(issues.length === 0, `宽度 ${w}px：${views.length} 个视图无横向溢出 ` + (issues.length ? JSON.stringify(issues) : ''));
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    console.log('10) 网络与错误');
    ok(external.length === 0, '浏览器外部请求 = 0 ' + (external.length ? JSON.stringify(external) : ''));
    ok(errors.length === 0, '无 JS 错误 ' + (errors.length ? JSON.stringify(errors) : ''));
  } catch (e) {
    fail++; console.error(e); await page.screenshot({ path: path.join(OUT, 'failure.png') });
  } finally {
    await browser.close();
    proc.kill();
    fs.writeFileSync(path.join(OUT, 'data_dir.txt'), DATA);
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
