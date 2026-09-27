/* Low latency Global Carbon Budget: navigation toggle, site search overlay and back-to-top button. */
(function () {
  'use strict';
  var root = document.body.getAttribute('data-root') || './';

  // Mobile navigation
  var nav = document.querySelector('.menu-1');
  var toggle = document.querySelector('.menu-toggle');
  if (nav && toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('toggled');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Back to top
  var topBtn = document.getElementById('top');
  if (topBtn) {
    var onScroll = function () { topBtn.classList.toggle('show', window.scrollY > 20); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    topBtn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  // Search overlay (index built at build time in static/search-index.js)
  var overlay = document.getElementById('search');
  var openBtn = document.querySelector('.search-icon');
  if (!overlay || !openBtn) return;
  var input = overlay.querySelector('input');
  var list = overlay.querySelector('.results');
  var closeBtn = overlay.querySelector('.closebtn');
  function open() {
    overlay.classList.add('open');
    input.value = '';
    render('');
    setTimeout(function () { input.focus(); }, 30);
  }
  function close() {
    overlay.classList.remove('open');
    openBtn.focus();
  }
  function render(q) {
    while (list.firstChild) list.removeChild(list.firstChild);
    q = q.trim().toLowerCase();
    if (q.length < 2) return;
    var index = window.SEARCH_INDEX || [];
    var words = q.split(/\s+/);
    var hits = index.map(function (p) {
      var hay = (p.title + ' ' + p.text).toLowerCase();
      var score = words.reduce(function (s, w) { return s + (hay.indexOf(w) >= 0 ? 1 : 0) + (p.title.toLowerCase().indexOf(w) >= 0 ? 2 : 0); }, 0);
      return { p: p, score: score, all: words.every(function (w) { return hay.indexOf(w) >= 0; }) };
    }).filter(function (h) { return h.all; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
    if (!hits.length) {
      var li0 = document.createElement('li');
      li0.textContent = 'No pages found.';
      list.appendChild(li0);
      return;
    }
    hits.forEach(function (h) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = root + h.p.url;
      a.textContent = h.p.title;
      var span = document.createElement('span');
      var t = h.p.text, i = t.toLowerCase().indexOf(words[0]);
      span.textContent = (i > 60 ? '…' : '') + t.slice(Math.max(0, i - 60), Math.max(0, i - 60) + 180) + '…';
      li.appendChild(a);
      li.appendChild(span);
      list.appendChild(li);
    });
  }
  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  input.addEventListener('input', function () { render(input.value); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && overlay.classList.contains('open')) close();
  });
})();
