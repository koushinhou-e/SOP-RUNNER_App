# -*- coding: utf-8 -*-
"""v1 sop-runner の UI 文言を日本語化するための置換表（tools/sync_from_v1.py が使用）。

各エントリは (ファイル, 置換前, 置換後, 想定件数)。置換前の文字列が想定件数だけ見つからない場合は
エラーにする（v1 側の変更を検知するため）。コメントと文書解析用の正規表現は対象外。
"""

FONT = '"Yu Gothic UI",Meiryo,"Hiragino Sans",sans-serif'

APP = [
    ("toast('请选择 .docx 文件（不支持旧版 .doc，请先在 Word 中另存为 .docx）')",
     "toast('.docx ファイルを選択してください（旧形式の .doc は非対応です。Word で .docx として保存し直してください）')", 1),
    ("confirm('发现此文档的已保存进度（'", "confirm('この文書の保存済みの進捗があります（'", 1),
    (r"' 步已确认）。\n确定 = 继续上次进度；取消 = 重新解析并覆盖。'",
     r"' 手順確認済み）。\nOK = 前回の続きから再開／キャンセル = 再解析して上書き'", 1),
    ("toast('已恢复进度')", "toast('進捗を復元しました')", 1),
    ("toast('没有识别到任何步骤')", "toast('手順を検出できませんでした')", 1),
    ("toast('解析完成：' + S.steps.length + ' 个步骤')", "toast('解析完了：' + S.steps.length + ' 手順')", 1),
    ("alert('解析失败：' + e.message)", "alert('解析に失敗しました：' + e.message)", 1),
    ("toast('请先填写执行者姓名')", "toast('先に実施者名を入力してください')", 2),
    ("exportRecordDocx(S, 'simple-table', S.exportLang || 'ja')", "(window.SopEvidence ? SopEvidence.exportDocx(S) : exportRecordDocx(S, 'simple-table', 'ja'))", 1),
    ("toast('已导出 Word 执行记录')", "toast('Word の実施記録を出力しました')", 1),
    ("'不是 SOP Runner 的 JSON 备份'", "'SOP Runner の JSON バックアップではありません'", 1),
    ("'本机已有此文档的进度，用备份覆盖？'", "'この文書の進捗が既にあります。バックアップで上書きしますか？'", 1),
    ("toast('已从 JSON 恢复')", "toast('JSON から復元しました')", 1),
    ("alert('导入失败：' + e.message)", "alert('読み込みに失敗しました：' + e.message)", 1),
    ("toast('已复制：'", "toast('コピーしました：'", 1),
    ('title="复制">⧉', 'title="コピー">⧉', 1),
    ('title="复制（已去掉提示符 $ / #）">复制</button>', 'title="コピー（プロンプト $ / # は除去済み）">コピー</button>', 1),
    ('title="本工具不发起任何网络请求">离线</span>', 'title="このツールはネットワーク通信を一切行いません">オフライン</span>', 1),
    ('>导出 JSON</button><button data-act="reset">重置进度</button>', '>JSON 出力</button><button data-act="reset">進捗リセット</button>', 1),
    ('>返回首页</button>', '>ホームへ戻る</button>', 1),
    ('Word 手顺书 → 逐步执行 + 证跡记录', 'Word 手順書 → 1 手順ずつ実行＋証跡記録', 1),
    ('<h2>拖入 Word 手顺书（.docx）</h2><p class="muted">或者</p><button class="primary" data-act="pick">选择 .docx 文件</button>',
     '<h2>Word 手順書（.docx）をここにドロップ</h2><p class="muted">または</p><button class="primary" data-act="pick">.docx ファイルを選択</button>', 1),
    ('文件只在本机浏览器内解析，不上传、不联网。进度自动保存在本机浏览器（localStorage）。',
     'ファイルはこの PC のブラウザ内だけで解析され、外部へは送信されません。進捗はアプリの data フォルダ（JSON）に自動保存されます（ブラウザにも予備保存）。', 1),
    ('<b>已保存的进度</b>', '<b>保存済みの進捗</b>', 1),
    ('>导入 JSON 备份</button>', '>JSON バックアップを読み込む</button>', 1),
    ('<p class="muted">暂无。</p>', '<p class="muted">まだありません。</p>', 1),
    ('<th>文档</th><th>状态</th><th>进度</th><th>最后更新</th>', '<th>文書</th><th>状態</th><th>進捗</th><th>最終更新</th>', 1),
    ("{ edit: '编辑中', run: '执行中', done: '已完成' }", "{ edit: '編集中', run: '実行中', done: '完了' }", 1),
    ('">继续</button>', '">再開</button>', 1),
    ('>删除</button>', '>削除</button>', 2),
    ('<b>识别规则简述：</b>标题 → 章节；编号/项目符号列表的每一项 → 一个步骤；含空单元格或"確認結果"列的表格 → 每行一个步骤；'
     '"期待結果/確認内容/expected" → 期待结果；等宽字体或以 $ / # 开头的行 → 命令（带复制按钮）；'
     '＿＿＿ / （　） / 【　】 / □ / "確認結果：" / "記入" / 空单元格 → 输入框。导入后可在编辑模式中修正。',
     '<b>検出ルール（概要）：</b>見出し → 章・節／番号付き・箇条書きリストの各項目 → 1 手順／空セルや「確認結果」列を含む表 → 1 行 = 1 手順／'
     '「期待結果・確認内容・expected」 → 期待結果／等幅フォントまたは $ / # で始まる行 → コマンド（コピーボタン付き）／'
     '＿＿＿ / （　） / 【　】 / □ / 「確認結果：」 / 「記入」 / 空セル → 入力欄。読み込み後に編集モードで修正できます。', 1),
    ("{ text: '文本', time: '时间', result: '结果(OK/NG)', check: '勾选' }", "{ text: 'テキスト', time: '日時', result: '結果(OK/NG)', check: 'チェック' }", 1),
    ('<b>编辑模式</b> <span class="muted">共 <b id="stepCount">', '<b>編集モード</b> <span class="muted">全 <b id="stepCount">', 1),
    ("'</b> 个步骤、<b id=\"inputCount\">'", "'</b> 手順・入力項目 <b id=\"inputCount\">'", 1),
    ("'</b> 个输入项。修正拆分错误后点击「开始执行」。</span></div>'", "'</b> 件。分割の誤りを修正してから「実行開始」をクリックしてください。</span></div>'", 1),
    ('执行者 <input', '実施者 <input', 2),
    ('placeholder="姓名（必填）"', 'placeholder="氏名（必須）"', 1),
    ('>开始执行 ▶</button>', '>実行開始 ▶</button>', 1),
    ('提示：操作内容中整行用 `反引号` 包住表示命令（带复制按钮）；行内 `xxx` 为行内代码。修改文本后可点「重新检测输入」。',
     'ヒント：作業内容で行全体を `バッククォート` で囲むとコマンド（コピーボタン付き）、行内の `xxx` はインラインコードになります。テキスト修正後は「入力を再検出」をクリックしてください。', 1),
    ('＋ 在开头插入步骤', '＋ 先頭に手順を挿入', 1),
    ('title="上移"', 'title="上へ移動"', 1),
    ('title="下移"', 'title="下へ移動"', 1),
    ('title="与下一步合并">合并↓', 'title="次の手順と結合">結合↓', 1),
    ('title="在「操作内容」光标位置拆分为两步">在光标处拆分', 'title="「作業内容」のカーソル位置で 2 つに分割">カーソル位置で分割', 1),
    ('>重新检测输入</button>', '>入力を再検出</button>', 1),
    ('<div class="lbl">章节</div>', '<div class="lbl">章・節</div>', 1),
    ('<div class="lbl">操作内容</div>', '<div class="lbl">作業内容</div>', 2),
    ('<div class="lbl">期待结果</div>', '<div class="lbl">期待結果</div>', 2),
    ('章节说明（只读显示）', '章・節の説明（参照のみ）', 1),
    ('<div class="lbl">输入项（', '<div class="lbl">入力項目（', 1),
    ('<th style="width:45%">标签</th><th>类型</th><th>单位</th><th>可选</th>', '<th style="width:45%">ラベル</th><th>種類</th><th>単位</th><th>任意</th>', 1),
    ('＋ 添加输入项', '＋ 入力項目を追加', 1),
    ('＋ 插入步骤', '＋ 手順を挿入', 1),
    ('<b>进度 <span id="prog">', '<b>進捗 <span id="prog">', 1),
    ('<span class="badge warn">异常</span>', '<span class="badge warn">異常</span>', 1),
    ("'<div class=\"done-banner\">✓ 已于 '", "'<div class=\"done-banner\">✓ '", 1),
    ("' 确认' + (r.anomaly ? ' <span class=\"anom\">（标记为异常）</span>'", "' に確認済み' + (r.anomaly ? ' <span class=\"anom\">（異常あり）</span>'", 1),
    ('<span class="muted">步骤 \' + (S.view + 1)', '<span class="muted">手順 \' + (S.view + 1)', 1),
    ('<span class="muted">（无）</span>', '<span class="muted">（なし）</span>', 1),
    ("'<div class=\"lbl\">记录（' + st.inputs.length + ' 项）</div>", "'<div class=\"lbl\">記録（' + st.inputs.length + ' 項目）</div>", 1),
    ("' <span class=\"muted\">(可选)</span>'", "' <span class=\"muted\">(任意)</span>'", 1),
    ("> 已完成</div>", "> 完了</div>", 1),
    ('>现在</button>', '>現在時刻</button>', 1),
    ('<div class="lbl">备注（可选）</div>', '<div class="lbl">備考（任意）</div>', 1),
    ('> 标记为异常</label>', '> 異常としてマーク</label>', 1),
    ('>确认 ✓</button>', '>確認 ✓</button>', 1),
    ("'还需填写 '", "'未入力 '", 2),
    ("' 项：'", "' 項目：'", 2),
    ("'可以确认'", "'確認できます'", 2),
    ('>撤销确认</button>', '>確認を取り消す</button>', 1),
    ("'前往当前步骤 →' : '查看完成页 →'", "'現在の手順へ →' : '完了ページへ →'", 1),
    ('<span>执行者：</span>', '<span>実施者：</span>', 1),
    ("<span>开始：'", "<span>開始：'", 1),
    ("🎉 全部 ' + R.total + ' 个步骤已确认</h2>", "🎉 全 ' + R.total + ' 手順の確認が完了しました</h2>", 1),
    ('<tr><td>文档</td>', '<tr><td>文書</td>', 1),
    ('<tr><td>开始</td>', '<tr><td>開始</td>', 1),
    ('<tr><td>结束</td>', '<tr><td>終了</td>', 1),
    ('<tr><td>异常</td>', '<tr><td>異常</td>', 1),
    ("' 个</span>'", "' 件</span>'", 1),
    ("      '<label>导出语言 <select data-bind=\"exportLang\"><option value=\"ja\"' + (S.exportLang !== 'zh' ? ' selected' : '') + '>日本語</option>"
     "<option value=\"zh\"' + (S.exportLang === 'zh' ? ' selected' : '') + '>中文</option></select></label>' +\n", "", 1),
    ('>导出 Word 执行记录</button><button data-act="exportJson">导出 JSON 备份</button><button data-act="view" data-i="0">回看步骤</button>',
     '>Word 実施記録を出力</button><button data-act="exportJson">JSON バックアップを出力</button><button data-act="view" data-i="0">手順を見返す</button>', 1),
    ('<th>#</th><th>步骤</th><th>记录值</th><th>确认时间</th><th>备注</th><th>异常</th>', '<th>#</th><th>手順</th><th>記録値</th><th>確認日時</th><th>備考</th><th>異常</th>', 1),
    ("confirm('删除这个进度？此操作不可恢复。')", "confirm('この進捗を削除しますか？元に戻せません。')", 1),
    ("confirm('重置进度？所有已填写的值、备注、确认时间将被清除（编辑过的步骤保留）。')",
     "confirm('進捗をリセットしますか？入力値・備考・確認日時がすべて消去されます（編集した手順は残ります）。')", 1),
    ("toast('进度已重置')", "toast('進捗をリセットしました')", 1),
    ("toast('没有步骤')", "toast('手順がありません')", 1),
    ("toast('已合并')", "toast('結合しました')", 1),
    ("toast('请先在「操作内容」中把光标放到要拆分的位置')", "toast('先に「作業内容」で分割したい位置にカーソルを置いてください')", 1),
    ("toast('已拆分为两步')", "toast('2 つの手順に分割しました')", 1),
    ("toast('检测到 ' + st.inputs.length + ' 个输入项')", "toast('入力項目を ' + st.inputs.length + ' 件検出しました')", 1),
    ("confirm('删除步骤「' + st.title + '」？')", "confirm('手順「' + st.title + '」を削除しますか？')", 1),
    ("title: '新步骤'", "title: '新しい手順'", 1),
    ("label: '记录', type: 'text'", "label: '記録', type: 'text'", 1),
    ("toast('请先确认前面的步骤')", "toast('先に前の手順を確認してください')", 1),
    ("toast('已确认')", "toast('確認しました')", 1),
]

PARSER = [
    ("fallbackLabel || '记录'", "fallbackLabel || '記録'", 2),
    ("'表格行'", "'表の行'", 1),
    ("('记录: '", "('記録: '", 1),
    ("(docTitle || '步骤')", "(docTitle || '手順')", 1),
    ("'不是有效的 Word .docx 文件（找不到 word/document.xml）'", "'有効な Word .docx ファイルではありません（word/document.xml が見つかりません）'", 1),
]

EXPORT = [
    ("name: '简单表格（横向 A4）'", "name: 'シンプル表形式（A4 横）'", 1),
]

CSS = [
    ('"Yu Gothic UI","Yu Gothic","Meiryo","Hiragino Sans","Noto Sans CJK JP","Microsoft YaHei","PingFang SC",sans-serif', FONT, 1),
]


def drop_zh_labels(code):
    """export.js の ExportLabels から zh（中国語）ラベルを削除する。出力ラベルは日本語のみ。"""
    lines = code.split("\n")
    idx = [i for i, l in enumerate(lines) if l.startswith("  zh: { title:")]
    if len(idx) != 1:
        raise SystemExit("export.js: zh labels line not found (v1 changed?)")
    del lines[idx[0]]
    prev = lines[idx[0] - 1]
    if not prev.startswith("  ja: {") or not prev.endswith("},"):
        raise SystemExit("export.js: unexpected ja labels line")
    lines[idx[0] - 1] = prev[:-1]
    return "\n".join(lines)
