/* 本机 API 调用（带启动时生成的 token）。只访问同源 127.0.0.1。 */
(function () {
  'use strict';
  var TOKEN = (document.querySelector('meta[name=ba-token]') || {}).content || '';
  function req(method, url, body, headers) {
    var h = { 'X-Token': TOKEN };
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    return fetch(url, { method: method, headers: h, body: body, cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      return r.text().then(function (t) {
        var j; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { error: t }; }
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
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
    blob: function (u) { return fetch(u, { headers: { 'X-Token': TOKEN } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); }); },
    dl: function (u) { return u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + encodeURIComponent(TOKEN); }
  };
})();
