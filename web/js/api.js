/* 本机 API 调用（带启动时生成的 token）。只访问同源 127.0.0.1。 */
(function () {
  'use strict';
  var TOKEN = (document.querySelector('meta[name=ba-token]') || {}).content || '';
  // fetch 自体の失敗（TypeError: Failed to fetch）＝ サーバから応答が無い。原因の分かる文言に置き換える
  var MSG_OFFLINE = 'ローカルサーバに接続できません。黒い画面（サーバ）が閉じられていないか確認し、停止していれば start.bat で起動し直してからページを再読み込みしてください。';
  var MSG_TOKEN = 'サーバが再起動されたため、この画面は古くなっています。ページを再読み込み（F5）してください。';
  function netError(e) { if (e instanceof TypeError) { var x = new Error(MSG_OFFLINE); x.offline = true; throw x; } throw e; }
  function httpError(r, j) { return new Error(r.status === 403 && j.error === 'invalid token' ? MSG_TOKEN : (j.error || ('HTTP ' + r.status))); }
  function req(method, url, body, headers) {
    var h = { 'X-Token': TOKEN };
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    return fetch(url, { method: method, headers: h, body: body, cache: 'no-store', credentials: 'same-origin' }).catch(netError).then(function (r) {
      return r.text().then(function (t) {
        var j; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { error: t }; }
        if (!r.ok) throw httpError(r, j);
        return j;
      });
    });
  }
  window.Api = {
    token: TOKEN,
    get: function (u) { return req('GET', u); },
    post: function (u, b) { return req('POST', u, b === undefined ? {} : b); },
    put: function (u, b) { return req('PUT', u, b); },
    del: function (u) { return req('DELETE', u); },
    upload: function (type, file) { return req('POST', '/api/library/upload?type=' + encodeURIComponent(type), file, { 'X-Filename': encodeURIComponent(file.name) }); },
    blob: function (u) { return fetch(u, { headers: { 'X-Token': TOKEN } }).catch(netError).then(function (r) { if (!r.ok) throw httpError(r, {}); return r.blob(); }); },
    dl: function (u) { return u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + encodeURIComponent(TOKEN); }
  };
})();
