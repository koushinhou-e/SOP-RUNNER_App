/* 「作業入力値一覧」の印刷用ページ（フォールバック）：印刷ボタン */
(function () {
  var b = document.getElementById('printBtn');
  if (b) b.addEventListener('click', function () { window.print(); });
})();
