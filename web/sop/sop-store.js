/* v1 SOP Runner 的存储适配层：会话保存到本机服务器（data/sop_sessions/*.json），localStorage 作为备份。 */
(function () {
  'use strict';
  var cache = {}, chains = {};
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  window.SopStore = {
    init: function () {
      return Api.get('/api/sop/sessions').then(function (r) {
        cache = {}; r.items.forEach(function (s) { cache[s.key] = s; });
      }).catch(function () {
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('sopRunner:v1:') === 0) { try { cache[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { } } }
      });
    },
    save: function (S) {
      var c = copy(S), key = S.key;
      cache[key] = c;
      try { localStorage.setItem(key, JSON.stringify(c)); } catch (e) { }
      chains[key] = (chains[key] || Promise.resolve()).then(function () {   // 按顺序写入，避免并发乱序
        return Api.put('/api/sop/sessions/' + encodeURIComponent(key), c);
      }).catch(function (e) { if (window.toast) toast('进度保存到服务器失败：' + e.message); });
    },
    load: function (key) { return cache[key] ? copy(cache[key]) : null; },
    list: function () { return Object.keys(cache).map(function (k) { return copy(cache[k]); }); },
    remove: function (key) { delete cache[key]; try { localStorage.removeItem(key); } catch (e) { } Api.del('/api/sop/sessions/' + encodeURIComponent(key)); },
    flush: function () { return Promise.all(Object.keys(chains).map(function (k) { return chains[k]; })); }
  };
})();
