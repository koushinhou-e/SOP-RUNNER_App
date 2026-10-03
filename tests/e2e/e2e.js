// E2E: 用“干净”的 Python（-I -S，只用 vendor/）启动应用，Headless Chromium 走完主要流程。
// 浏览器的一切非 127.0.0.1 请求都会被拦截并记录；最后断言为 0。
//   PYTHON=/path/to/python node tests/e2e/e2e.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const S = p => path.join(ROOT, 'samples', p);
const OUT = path.join(ROOT, 'tests', '_out'); const SHOT = path.join(ROOT, 'screenshots');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SHOT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-e2e-'));
const PY = process.env.PYTHON || 'python3';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(PY, ['-I', '-S', path.join(ROOT, 'app.py'), '--no-browser', '--port', '0', '--data-dir', DATA], { cwd: os.tmpdir() });
    let buf = '';
    proc.stdout.on('data', d => { buf += d; const m = buf.match(/running at: (http:\/\/127\.0\.0\.1:\d+\/)/); if (m) resolve({ proc, url: m[1] }); });
    proc.stderr.on('data', d => process.stderr.write('[server] ' + d));
    proc.on('exit', c => reject(new Error('server exited ' + c + ' ' + buf)));
    setTimeout(() => reject(new Error('server start timeout')), 15000);
  });
}

(async () => {
  const { proc, url } = await startServer();
  console.log('server:', url, 'python:', PY, '(-I -S, vendored deps only)');
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
    ok((await page.textContent('.lib-param_sheet')).includes('参数 13 × 服务器 web01, web02, db01'), '参数表解析：13 参数 × 3 服务器');
    await page.setInputFiles('#upCmd input[type=file]', S('command_templates_sample.json'));
    await page.waitForSelector('.lib-command_set tr[data-id]');
    await page.setInputFiles('.up[data-type=procedure] input[type=file]', S('Webサーバ定期パッチ適用手順書.docx'));
    await page.waitForSelector('.lib-procedure tr[data-id]');
    await page.setInputFiles('.up[data-type=excel_template] input[type=file]', S('構築結果報告書_template_sample.xlsx'));
    await page.waitForSelector('#itemTable');
    ok((await page.textContent('#edCount')).includes('共 39 项'), '交付物模板检测：39 项');

    console.log('2) 模板编辑：映射 / 调整检测项');
    await page.selectOption('#edParam', { label: 'EC2パラメータシート_sample' });
    await page.waitForFunction(() => document.querySelectorAll('#itemTable option[value^="param:"]').length > 0);
    await page.click('#edAuto');
    await page.waitForFunction(() => /参数 11/.test(document.querySelector('#edCount').textContent));
    ok(true, '按标签自动映射：11 项映射到参数');
    ok(await page.locator('#gridPrev td.hit.param').count() === 11, '网格预览：11 个蓝色(参数)单元格');
    await page.click('#gridPrev td[data-addr="C7"]');           // 点击空单元格 → 添加检测项
    let tm = await api('/api/library?type=excel_template');
    await page.waitForSelector('#itemTable tr.sel');
    await page.fill('#itemTable tr.sel input[data-f=label]', '管理番号');
    await page.fill('#itemTable tr.sel input[data-f=pattern]', 'MNG-[0-9]{4}');
    const row22 = page.locator('#itemTable tr', { has: page.locator('input[data-f=cell][value="C22"]') });
    await row22.locator('input[data-f=label]').fill('特記事項（任意）');
    const rowE9 = page.locator('#itemTable tr', { has: page.locator('input[data-f=cell][value="E9"]') });
    await rowE9.locator('button[data-f=del]').click();
    await page.waitForFunction(() => /共 39 项/.test(document.querySelector('#edCount').textContent));   // +1 (C7) -1 (E9)
    await page.evaluate(() => document.querySelector('#gridPrev').scrollTo(0, 0));
    await shot(); await page.screenshot({ path: path.join(SHOT, '02-template-mapping.png') });
    await page.click('#edSave');
    await page.waitForFunction(() => !/未保存/.test(document.querySelector('#edStat').textContent));
    tm = (await api('/api/library?type=excel_template')).items[0];
    const byCell = Object.fromEntries(tm.items.map(i => [i.cell, i]));
    ok(byCell.C7 && byCell.C7.label === '管理番号' && byCell.C7.rules.pattern === 'MNG-[0-9]{4}' && !byCell.E9 && byCell.C22.label === '特記事项（任意）'.replace('项', '項') && tm.param_ref, '保存：新增 C7(管理番号+正则)、删除 E9、改名 C22、参照参数表');

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
    ok(/no-cli-pager/.test(warns) && /--output/.test(warns) && /交互/.test(warns), 'lint：缺 --no-cli-pager / --output、交互式 less → 警告');
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
    ok(/有 \d+ 项不符合规则/.test(await page.textContent('#inStat')), '未填写时显示错误统计');
    const inId = c => `#inTable [data-in="構築結果!${c}"]`;
    await page.fill(inId('C3'), 'サンプル基盤構築');
    await page.fill(inId('C4'), '2026/13/40');
    await page.fill(inId('C5'), '山田 太郎');
    await page.fill(inId('C6'), '佐藤 花子');
    await page.fill(inId('C7'), 'ABC-1');
    ok(await page.locator(inId('C4') + '.invalid').count() === 1, '日期格式错误 → 红色');
    ok(await page.locator(inId('C7') + '.invalid').count() === 1, '自定义正则 MNG-[0-9]{4} 不符 → 红色');
    ok(await page.locator(inId('D9') + '.invalid').count() === 1, '必填下拉未选 → 红色');
    ok(await page.locator('#roTable .invalid').count() === 0, '来自参数表的 11 个值全部通过规则检查');
    await shot(); await page.screenshot({ path: path.join(SHOT, '03-inputs-validation.png') });
    await page.fill(inId('C4'), '2026/10/03');
    await page.fill(inId('C7'), 'MNG-0042');
    for (let r = 9; r <= 19; r++) await page.selectOption(inId('D' + r), 'OK');
    await page.selectOption(inId('C21'), '合格');
    ok(await page.locator('#inTable .invalid').count() === 0 && /全部 \d+ 项通过/.test(await page.textContent('#inStat')), '修正后全部通过');
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
    ok((await page.textContent('#jobBody')).includes('将写入 28 个单元格'), '将写入 28 个单元格（参数 11 + 输入 17；可选的特记事项未填）');
    await shot(); await page.screenshot({ path: path.join(SHOT, '06-deliverable.png') });
    const dv = await dl('#dvExport', 'deliverable.xlsx');
    ok(/web01_\d{8}-\d{6}\.xlsx$/.test(dv.name), '交付物导出：' + dv.name);

    console.log('8) 手顺执行（v1 模块，进度存服务器）');
    await page.click('#jbProc');
    await page.waitForSelector('#sop-app #stepCount');
    ok(await page.textContent('#sop-app #stepCount') === '18', '从模板库打开手顺书：18 步（v1 解析器）');
    await page.fill('#sop-app input[data-bind=executor]', '山田 太郎');
    await page.click('#sop-app #btnStart');
    await page.waitForSelector('#sop-app #btnConfirm');
    ok(await page.isDisabled('#sop-app #btnConfirm'), '确认按钮在输入未填时禁用');
    const st0 = await page.evaluate(() => SopApp.state().steps[0]);
    for (const inp of st0.inputs) await page.fill('#in_' + inp.id, inp.type === 'time' ? '2026-10-03 09:00' : 'テスト');
    await page.click('#sop-app #btnConfirm');
    await page.click('#sop-app #btnConfirm');   // step 2 has no inputs
    await shot(); await page.screenshot({ path: path.join(SHOT, '07-sop-runner.png') });
    await page.evaluate(() => SopStore.flush());
    const files = fs.readdirSync(path.join(DATA, 'sop_sessions'));
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'sop_sessions', files[0]), 'utf8'));
    ok(files.length === 1 && Object.values(saved.results).filter(r => r.confirmedAt).length === 2, '进度已写入 data/sop_sessions/*.json（2 步已确认）');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('#nav [data-tab=sop]');
    await page.waitForSelector('#sop-app #sessions');
    ok((await page.textContent('#sop-app #sessions')).includes('2 / 18'), '清空 localStorage 并刷新后，从服务器恢复会话列表（2 / 18）');
    await page.click('#sop-app button[data-act=resume]');
    ok(await page.evaluate(() => SopApp.state().view) === 2, '继续执行：定位到第 3 步');

    console.log('9) 响应式布局：1024 / 1280 宽度下各视图无横向溢出、按钮完整可见');
    const views = [
      ['模板库', async () => { await page.click('#nav [data-tab=library]'); await page.waitForSelector('.lib-excel_template tr[data-id]'); }],
      ['模板编辑', async () => { await page.click('.lib-excel_template button[data-act=openItem]'); await page.waitForSelector('#itemTable'); }],
      ['参数表', async () => { await page.click('[data-act=backLib]'); await page.click('.lib-param_sheet button[data-act=openItem]'); await page.waitForSelector('#paramTable'); }],
      ['命令集编辑', async () => { await page.click('[data-act=backLib]'); await page.click('.lib-command_set button[data-act=openItem]'); await page.waitForSelector('#cePreview .cmdcard'); }],
      ['①输入', async () => { await page.click('[data-act=backLib]'); await page.click('#nav [data-tab=jobs]'); await page.click('[data-job]'); await page.click('[data-jt=inputs]'); await page.waitForSelector('#inTable'); }],
      ['②命令', async () => { await page.click('[data-jt=commands]'); await page.waitForSelector('#cmdList .cmdcard'); }],
      ['③比对', async () => { await page.click('[data-jt=compare]'); await page.waitForSelector('#cmpTable tr[data-key]'); }],
      ['④交付物', async () => { await page.click('[data-jt=deliver]'); await page.waitForSelector('#dvTable'); }],
      ['手顺执行', async () => { await page.click('#nav [data-tab=sop]'); await page.waitForSelector('#sop-app'); }],
    ];
    const layoutIssues = () => page.evaluate(() => {
      const W = document.documentElement.clientWidth, bad = [];
      if (document.documentElement.scrollWidth > W + 1) bad.push('page scrollWidth ' + document.documentElement.scrollWidth + ' > ' + W);
      document.querySelectorAll('.tab.on button, .tab:not(.hidden) button, header button').forEach(b => {
        const r = b.getBoundingClientRect(); if (!r.width || b.closest('.tscroll,.grid-prev,.hidden')) return;
        if (r.right > W + 1 || r.left < -1) bad.push('button "' + b.textContent.trim().slice(0, 20) + '" right=' + Math.round(r.right));
      });
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
