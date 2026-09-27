/* Low latency Global Carbon Budget — interactive charts.
 *
 * Dependency-free SVG charts. Data come from the page's <script id="chart-data" type="application/json">,
 * written by build.py. Conventions: sinks positive; GtC per year unless stated.
 *
 * Chart spec (shared with the site's data-viz guidelines):
 *   bars <= 24px with 4px rounded data-ends and 2px surface gaps between stacked segments;
 *   2px lines; >= 8px markers with a 2px surface ring; hairline solid gridlines;
 *   a legend for >= 2 series; hover/focus tooltips that list every series; a table view for every chart.
 * Labels are inserted with textContent only.
 */
(function () {
  'use strict';

  var holder = document.getElementById('chart-data');
  if (!holder) return;
  var DATA = JSON.parse(holder.textContent);
  var NS = 'http://www.w3.org/2000/svg';
  var PPM_TO_GTC = 2.124;

  // Colours come from CSS custom properties so the palette lives in one place (site.css).
  var C = {};
  ['fossil', 'ocean', 'land', 'atm', 'imb', 'bu', 'td', 'comb', 'temp', 'ink', 'ink2', 'muted', 'grid', 'axis', 'surface']
    .forEach(function (k) {
      C[k] = getComputedStyle(document.documentElement).getPropertyValue('--c-' + k).trim() || '#555';
    });

  // ------------------------------------------------------------------ helpers
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    });
    if (parent) parent.appendChild(e);
    return e;
  }
  function html(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d) {
    if (!isNum(v)) return '–';
    var s = Math.abs(v).toFixed(d === undefined ? 2 : d);
    return (v < 0 && Number(s) !== 0 ? '−' : '') + s;
  }
  function pm(v, sd, d) { return isNum(sd) ? fmt(v, d) + ' ± ' + fmt(sd, d) : fmt(v, d); }
  function sum(a) { return a.reduce(function (s, x) { return s + x.v; }, 0); }
  function niceStep(span, target) {
    var raw = span / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }
  function niceDomain(lo, hi, target) {
    if (lo === hi) { lo -= 1; hi += 1; }
    var st = niceStep(hi - lo, target || 5);
    return { lo: Math.floor(lo / st + 1e-9) * st, hi: Math.ceil(hi / st - 1e-9) * st, step: st };
  }
  function tickValues(dom) {
    var out = [], n = Math.round((dom.hi - dom.lo) / dom.step);
    for (var i = 0; i <= n; i++) out.push(Number((dom.lo + i * dom.step).toFixed(10)));
    return out;
  }
  function tickFmt(v, step) {
    var d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return fmt(v, d);
  }
  function linear(d0, d1, r0, r1) {
    return function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // Rect path with the outer end rounded (dir +1 rounds the top, -1 the bottom).
  function barPath(x, y, w, h, dir, rounded) {
    var r = rounded ? Math.min(4, h, w / 2) : 0;
    if (r <= 0) return 'M' + x + ',' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z';
    if (dir > 0) {
      return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
    }
    return 'M' + x + ',' + y + 'H' + (x + w) + 'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' +
      (x + w - r) + ',' + (y + h) + 'H' + (x + r) + 'Q' + x + ',' + (y + h) + ' ' + x + ',' + (y + h - r) + 'Z';
  }

  // ------------------------------------------------------------------ shared parts
  function Tip(container) {
    this.c = container;
    this.el = html('div', 'viz-tip', container);
    this.el.hidden = true;
  }
  Tip.prototype.show = function (ax, ay, title, rows, note) {
    var el = this.el;
    clear(el);
    html('div', 'viz-tip-title', el, title);
    rows.forEach(function (r) {
      var row = html('div', 'viz-tip-row', el);
      var key = html('span', 'viz-key viz-key-' + (r.key || 'line'), row);
      key.style.setProperty('--c', r.color);
      html('span', 'viz-tip-val', row, r.value);
      html('span', 'viz-tip-lab', row, r.label);
    });
    if (note) html('div', 'viz-tip-note', el, note);
    el.hidden = false;
    var cw = this.c.clientWidth, ch = this.c.clientHeight, tw = el.offsetWidth, th = el.offsetHeight;
    var x = ax + 16;
    if (x + tw > cw - 2) x = ax - 16 - tw;
    if (x < 2) x = Math.max(2, Math.min(cw - tw - 2, ax - tw / 2));
    var y = Math.max(2, Math.min(ch - th - 2, ay - th / 2));
    el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  };
  Tip.prototype.hide = function () { this.el.hidden = true; };

  function legend(fig, items) {
    var ul = fig.querySelector('.viz-legend');
    if (!ul) return;
    clear(ul);
    items.forEach(function (it) {
      var li = html('li', '', ul);
      var sw = html('span', 'viz-key viz-key-' + (it.key || 'rect'), li);
      sw.style.setProperty('--c', it.color);
      html('span', '', li, it.label);
    });
  }

  function table(box, caption, head, rows) {
    clear(box);
    var t = html('table', 'viz-tbl', box);
    if (caption) html('caption', '', t, caption);
    var tr = html('tr', '', html('thead', '', t));
    head.forEach(function (h) { html('th', '', tr, h).setAttribute('scope', 'col'); });
    var tb = html('tbody', '', t);
    rows.forEach(function (r) {
      var row = html('tr', '', tb);
      r.forEach(function (v, i) {
        var cell = html(i === 0 ? 'th' : 'td', '', row, v);
        if (i === 0) cell.setAttribute('scope', 'row');
      });
    });
  }

  function wireTable(fig, build) {
    var btn = fig.querySelector('.viz-table-toggle'), box = fig.querySelector('.viz-table');
    if (!btn || !box) return function () {};
    btn.addEventListener('click', function () {
      var open = box.hidden;
      if (open) build(box);
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Hide table' : 'Show table';
    });
    return function () { if (!box.hidden) build(box); };
  }

  function yAxis(g, dom, y, x0, x1) {
    tickValues(dom).forEach(function (v) {
      var yy = Math.round(y(v)) + 0.5;
      svg('line', { x1: x0, x2: x1, y1: yy, y2: yy, stroke: v === 0 ? C.axis : C.grid, 'stroke-width': 1,
        'shape-rendering': 'crispEdges' }, g);
      svg('text', { x: x0 - 8, y: yy, 'text-anchor': 'end', 'dominant-baseline': 'middle', 'class': 'viz-tick' }, g)
        .textContent = tickFmt(v, dom.step);
    });
  }

  function onResize(el, fn) {
    var w = el.clientWidth, t;
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', fn); return; }
    new ResizeObserver(function () {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      clearTimeout(t);
      t = setTimeout(fn, 60);
    }).observe(el);
  }

  // ------------------------------------------------------------------ budget (stacked bars)
  var BUDGET_KEYS = [
    { k: 'fossil', label: 'Fossil CO₂ emissions' },
    { k: 'atm', label: 'Atmospheric growth' },
    { k: 'ocean', label: 'Ocean sink' },
    { k: 'land', label: 'Net land sink (source when above zero)' },
    { k: 'imb', label: 'Budget imbalance' }
  ];

  function budgetChart(fig) {
    var plot = fig.querySelector('.viz-plot');
    var tip = new Tip(plot);
    var state = { mode: 'bu' };
    var buttons = fig.querySelectorAll('[data-mode]');
    legend(fig, BUDGET_KEYS.map(function (k) { return { label: k.label, color: C[k.k], key: 'rect' }; }));

    function rowsFor(d) {
      return d.years.map(function (yr, i) {
        var L = d.land_sink[i], R = d.imbalance[i];
        var pos = [{ k: 'fossil', v: d.fossil[i] }], neg = [{ k: 'ocean', v: d.ocean_sink[i] }];
        if (L < 0) pos.push({ k: 'land', v: -L }); else neg.push({ k: 'land', v: L });
        neg.push({ k: 'atm', v: d.atm_growth[i] });
        if (R < 0) pos.push({ k: 'imb', v: -R }); else neg.push({ k: 'imb', v: R });
        return { year: yr, i: i, pos: pos, neg: neg, top: sum(pos), bot: -sum(neg) };
      });
    }

    function tipRows(d, i) {
      var L = d.land_sink[i];
      return [
        { color: C.fossil, key: 'rect', value: fmt(d.fossil[i]), label: 'Fossil CO₂ emissions' },
        { color: C.atm, key: 'rect', value: fmt(d.atm_growth[i]), label: 'Atmospheric growth (' + fmt(d.atm_growth[i] / PPM_TO_GTC) + ' ppm)' },
        { color: C.ocean, key: 'rect', value: pm(d.ocean_sink[i], d.ocean_sd[i]), label: 'Ocean sink' },
        { color: C.land, key: 'rect', value: pm(Math.abs(L), d.land_sd[i]), label: L >= 0 ? 'Net land sink' : 'Net land source' },
        { color: C.imb, key: 'rect', value: pm(d.imbalance[i], d.imbalance_sd[i]),
          label: state.mode === 'bu' ? 'Budget imbalance' : 'Budget closure' }
      ];
    }

    function draw() {
      var d = DATA.budget[state.mode], R = rowsFor(d);
      Array.prototype.slice.call(plot.querySelectorAll('svg')).forEach(function (n) { n.remove(); });
      tip.hide();
      var W = Math.max(300, plot.clientWidth), H = Math.round(Math.min(460, Math.max(300, W * 0.5)));
      var m = { t: 18, r: 8, b: 30, l: 46 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var lo = Math.min.apply(null, R.map(function (r) { return r.bot; }));
      var hi = Math.max.apply(null, R.map(function (r) { return r.top; }));
      var dom = niceDomain(lo, hi, 8);
      var y = linear(dom.lo, dom.hi, m.t + ih, m.t);
      // Keep the x-axis identical in both modes so bars do not jump when switching.
      var allYears = DATA.budget.bu.years;
      var n = allYears.length, band = iw / n, bw = Math.min(24, band * 0.62);
      var s = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'class': 'viz-svg', role: 'img',
        'aria-label': 'Stacked bar chart of the ' + (state.mode === 'bu' ? 'bottom-up' : 'top-down') +
          ' global CO₂ budget by year. Use the table view for all values.' });
      plot.insertBefore(s, plot.firstChild);
      yAxis(svg('g', null, s), dom, y, m.l, W - m.r);
      svg('text', { x: m.l + 6, y: y(dom.hi) + 12, 'class': 'viz-axis-label' }, s).textContent = 'Sources ↑';
      svg('text', { x: m.l + 6, y: y(dom.lo) - 6, 'class': 'viz-axis-label' }, s).textContent = 'Sinks ↓';

      var every = band < 30 ? (band < 18 ? 5 : 2) : 1;
      allYears.forEach(function (yr, j) {
        if ((j % every === 0 && n - 1 - j >= every) || j === n - 1) {
          svg('text', { x: m.l + band * (j + 0.5), y: H - m.b + 18, 'text-anchor': 'middle', 'class': 'viz-tick' }, s)
            .textContent = every > 1 ? String(yr) : (band < 40 ? "'" + String(yr).slice(2) : String(yr));
        }
      });

      var missing = allYears.filter(function (yr) { return d.years.indexOf(yr) < 0; });
      if (missing.length > 1) {
        var j0 = allYears.indexOf(missing[0]), j1 = allYears.indexOf(missing[missing.length - 1]);
        svg('text', { x: m.l + band * (j0 + j1 + 1) / 2, y: y(0) - 10, 'text-anchor': 'middle', 'class': 'viz-axis-label' }, s)
          .textContent = 'OCO-2 inversions start in 2015';
      }
      var cols = svg('g', { 'class': 'viz-cols' }, s);
      R.forEach(function (r) {
        var j = allYears.indexOf(r.year);
        var cx = m.l + band * (j + 0.5), x0 = cx - bw / 2;
        var g = svg('g', { 'class': 'viz-col' }, cols);
        stack(g, r.pos, x0, bw, y, 1);
        stack(g, r.neg, x0, bw, y, -1);
        var hit = svg('rect', { x: m.l + band * j, y: m.t, width: band, height: ih, fill: 'transparent',
          'class': 'viz-hit', tabindex: 0, role: 'img', 'aria-label': ariaFor(d, r.i) }, g);
        function on() {
          cols.classList.add('has-active');
          g.classList.add('is-active');
          var note = (state.mode === 'bu' && d.imbalance_lo) ?
            'Imbalance 95% interval: ' + fmt(d.imbalance_lo[r.i]) + ' to ' + fmt(d.imbalance_hi[r.i]) :
            (state.mode === 'td' ? 'Atmospheric growth implied by the inversions' : null);
          tip.show(cx + bw / 2, (y(r.top) + y(r.bot)) / 2, r.year + ' · GtC yr⁻¹', tipRows(d, r.i), note);
        }
        function off() { cols.classList.remove('has-active'); g.classList.remove('is-active'); tip.hide(); }
        hit.addEventListener('pointerenter', on);
        hit.addEventListener('pointerleave', off);
        hit.addEventListener('focus', on);
        hit.addEventListener('blur', off);
      });
    }

    function stack(g, segs, x0, bw, y, dir) {
      var acc = 0;
      segs.forEach(function (sg, idx) {
        if (!(sg.v > 0)) return;
        var a = acc, b = acc + sg.v;
        acc = b;
        var ya = y(dir * a), yb = y(dir * b);
        var top = Math.min(ya, yb), bot = Math.max(ya, yb);
        var outer = idx === segs.length - 1;
        // 1px inset on each inner edge -> 2px surface gap between neighbours (and across the zero line).
        if (dir > 0) { bot -= 1; if (!outer) top += 1; } else { top += 1; if (!outer) bot -= 1; }
        if (bot - top < 0.6) return;
        svg('path', { d: barPath(x0, top, bw, bot - top, dir, outer), fill: C[sg.k], 'class': 'viz-seg' }, g);
      });
    }

    function ariaFor(d, i) {
      var L = d.land_sink[i];
      return d.years[i] + ': fossil emissions ' + fmt(d.fossil[i]) + ', atmospheric growth ' + fmt(d.atm_growth[i]) +
        ', ocean sink ' + fmt(d.ocean_sink[i]) + ', net land ' + (L >= 0 ? 'sink ' : 'source ') + fmt(Math.abs(L)) +
        ', imbalance ' + fmt(d.imbalance[i]) + ' gigatonnes of carbon per year';
    }

    var refreshTable = wireTable(fig, function (box) {
      var d = DATA.budget[state.mode];
      table(box, (state.mode === 'bu' ? 'Bottom-up' : 'Top-down') + ' budget, GtC yr⁻¹ (sinks positive)',
        ['Year', 'Fossil', 'Atmosphere', 'Ocean', '±1σ', 'Land', '±1σ', state.mode === 'bu' ? 'Imbalance' : 'Closure', '±1σ'],
        d.years.map(function (yr, i) {
          return [String(yr), fmt(d.fossil[i]), fmt(d.atm_growth[i]), fmt(d.ocean_sink[i]), fmt(d.ocean_sd[i]),
            fmt(d.land_sink[i]), fmt(d.land_sd[i]), fmt(d.imbalance[i]), fmt(d.imbalance_sd[i])];
        }));
    });

    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function () {
        state.mode = b.getAttribute('data-mode');
        Array.prototype.forEach.call(buttons, function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        draw();
        refreshTable();
      });
    });
    draw();
    onResize(plot, draw);
  }

  // ------------------------------------------------------------------ line chart with bands (by method)
  function approachChart(fig) {
    var comp = fig.getAttribute('data-component');
    var src = DATA.approach[comp];
    var plot = fig.querySelector('.viz-plot');
    var tip = new Tip(plot);
    var series = [
      { k: 'bu', label: (comp === 'land' ? 'DGVMs' : 'Emulators') + ' · bottom-up', short: comp === 'land' ? 'DGVMs' : 'Emulators', color: C.bu, band: true },
      { k: 'td', label: 'Inversions · top-down', short: 'Inversions', color: C.td, band: true },
      { k: 'comb', label: 'Mean of both', short: 'Mean', color: C.comb, band: false }
    ];
    legend(fig, series.map(function (s) { return { label: s.label, color: s.color, key: 'line' }; }));
    var years = src.bu.years.slice();
    [src.td, src.comb].forEach(function (o) { o.years.forEach(function (yr) { if (years.indexOf(yr) < 0) years.push(yr); }); });
    years.sort();

    function val(sk, yr) {
      var o = src[sk], i = o.years.indexOf(yr);
      return i < 0 ? null : { m: o.mean[i], sd: o.sd[i] };
    }

    function draw() {
      Array.prototype.slice.call(plot.querySelectorAll('svg')).forEach(function (n) { n.remove(); });
      tip.hide();
      var W = Math.max(280, plot.clientWidth), H = Math.round(Math.min(340, Math.max(240, W * 0.62)));
      var m = { t: 12, r: 12, b: 28, l: 40 };
      var ih = H - m.t - m.b;
      var lo = Infinity, hi = -Infinity;
      series.forEach(function (s) {
        var o = src[s.k];
        o.mean.forEach(function (v, i) {
          var sd = s.band ? (o.sd[i] || 0) : 0;
          lo = Math.min(lo, v - sd); hi = Math.max(hi, v + sd);
        });
      });
      if (comp === 'land') lo = Math.min(lo, 0);
      var dom = niceDomain(lo, hi, 5);
      var y = linear(dom.lo, dom.hi, m.t + ih, m.t);
      // Direct end labels only when they do not collide; the legend always carries identity.
      var endY = series.map(function (sr) { var o = src[sr.k]; return y(o.mean[o.mean.length - 1]); }).sort(function (a, b) { return a - b; });
      var labelled = !endY.some(function (v, i) { return i > 0 && v - endY[i - 1] < 16; });
      if (labelled) m.r = 78;
      var iw = W - m.l - m.r;
      var x = linear(years[0], years[years.length - 1], m.l, m.l + iw);
      var s = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'class': 'viz-svg', role: 'img',
        'aria-label': (comp === 'land' ? 'Net land sink' : 'Ocean sink') + ' by method, ' + years[0] + '–' +
          years[years.length - 1] + '. Use the table view for all values.' });
      plot.insertBefore(s, plot.firstChild);
      yAxis(svg('g', null, s), dom, y, m.l, m.l + iw);
      var step = iw / (years.length - 1) < 34 ? 5 : 2;
      years.forEach(function (yr, i) {
        if ((yr % step === 0 && years[years.length - 1] - yr >= step) || i === years.length - 1) {
          svg('text', { x: x(yr), y: H - m.b + 18, 'text-anchor': 'middle', 'class': 'viz-tick' }, s).textContent = String(yr);
        }
      });
      var ends = [];
      series.forEach(function (sr) {
        var o = src[sr.k];
        if (sr.band) {
          var up = o.years.map(function (yr, i) { return x(yr) + ',' + y(o.mean[i] + o.sd[i]); });
          var dn = o.years.map(function (yr, i) { return x(yr) + ',' + y(o.mean[i] - o.sd[i]); }).reverse();
          svg('path', { d: 'M' + up.join('L') + 'L' + dn.join('L') + 'Z', fill: sr.color, 'fill-opacity': 0.1 }, s);
        }
        svg('path', { d: 'M' + o.years.map(function (yr, i) { return x(yr) + ',' + y(o.mean[i]); }).join('L'),
          fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
        var li = o.years.length - 1;
        ends.push({ sr: sr, x: x(o.years[li]), y: y(o.mean[li]) });
      });
      ends.forEach(function (e) {
        svg('circle', { cx: e.x, cy: e.y, r: 4, fill: e.sr.color, stroke: C.surface, 'stroke-width': 2 }, s);
      });
      if (labelled) {
        ends.forEach(function (e) {
          svg('text', { x: e.x + 9, y: e.y, 'dominant-baseline': 'middle', 'class': 'viz-direct' }, s).textContent = e.sr.short;
        });
      }

      // Crosshair + one tooltip listing every series at the hovered year.
      var cross = svg('line', { y1: m.t, y2: m.t + ih, 'class': 'viz-crosshair', visibility: 'hidden' }, s);
      var overlay = svg('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', tabindex: 0,
        'class': 'viz-hit', 'aria-label': 'Chart area. Use left and right arrow keys to move between years.' }, s);
      var cur = years.length - 1;
      function show(i) {
        cur = Math.max(0, Math.min(years.length - 1, i));
        var yr = years[cur], xx = Math.round(x(yr)) + 0.5;
        cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
        var rows = [];
        series.forEach(function (sr) {
          var v = val(sr.k, yr);
          if (v) rows.push({ color: sr.color, key: 'line', value: pm(v.m, v.sd), label: sr.short });
        });
        var ys = series.map(function (sr) { var v = val(sr.k, yr); return v ? y(v.m) : null; }).filter(isNum);
        tip.show(xx, ys.length ? ys.reduce(function (a, b) { return a + b; }) / ys.length : m.t + ih / 2,
          yr + ' · GtC yr⁻¹', rows, cur === years.length - 1 && comp === 'land' ? 'Negative = net source' : null);
      }
      function hide() { cross.setAttribute('visibility', 'hidden'); tip.hide(); }
      overlay.addEventListener('pointermove', function (ev) {
        var r = s.getBoundingClientRect();
        var px = (ev.clientX - r.left) * (W / r.width);
        var best = 0, bd = Infinity;
        years.forEach(function (yr, i) { var dd = Math.abs(x(yr) - px); if (dd < bd) { bd = dd; best = i; } });
        show(best);
      });
      overlay.addEventListener('pointerleave', hide);
      overlay.addEventListener('focus', function () { show(cur); });
      overlay.addEventListener('blur', hide);
      overlay.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowLeft') { show(cur - 1); ev.preventDefault(); }
        if (ev.key === 'ArrowRight') { show(cur + 1); ev.preventDefault(); }
      });
    }

    wireTable(fig, function (box) {
      table(box, (comp === 'land' ? 'Net land sink' : 'Ocean sink') + ', GtC yr⁻¹ (mean ± 1σ)',
        ['Year'].concat(series.map(function (s) { return s.short; })),
        years.map(function (yr) {
          return [String(yr)].concat(series.map(function (sr) { var v = val(sr.k, yr); return v ? pm(v.m, v.sd) : '–'; }));
        }));
    });
    draw();
    onResize(plot, draw);
  }

  // ------------------------------------------------------------------ growth rate (bars + markers)
  function growthChart(fig) {
    var d = DATA.growth;
    var plot = fig.querySelector('.viz-plot');
    var tip = new Tip(plot);
    legend(fig, [
      { label: 'NOAA marine boundary layer', color: C.atm, key: 'rect' },
      { label: 'OCO-2 inversions', color: C.td, key: 'dot' },
      { label: 'GRESO (OCO-2 and GOSAT)', color: C.ink, key: 'diamond' },
      { label: d.ref_label + ' (' + fmt(d.ref_mean) + ')', color: C.ink2, key: 'line' }
    ]);

    function draw() {
      Array.prototype.slice.call(plot.querySelectorAll('svg')).forEach(function (n) { n.remove(); });
      tip.hide();
      var W = Math.max(280, plot.clientWidth), H = Math.round(Math.min(340, Math.max(240, W * 0.62)));
      var m = { t: 14, r: 8, b: 28, l: 36 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var hi = 0;
      d.years.forEach(function (yr, i) {
        [d.mbl[i] + (d.mbl_unc[i] || 0), d.greso[i], d.inv[i]].forEach(function (v) { if (isNum(v)) hi = Math.max(hi, v); });
      });
      var dom = niceDomain(0, hi, 5);
      var n = d.years.length, band = iw / n, bw = Math.min(24, band * 0.6);
      var y = linear(dom.lo, dom.hi, m.t + ih, m.t);
      var s = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'class': 'viz-svg', role: 'img',
        'aria-label': 'Annual atmospheric CO₂ growth rate, ' + d.years[0] + '–' + d.years[n - 1] + '. Use the table view for all values.' });
      plot.insertBefore(s, plot.firstChild);
      yAxis(svg('g', null, s), dom, y, m.l, W - m.r);
      if (isNum(d.ref_mean)) {
        var ry = Math.round(y(d.ref_mean)) + 0.5;
        svg('line', { x1: m.l, x2: W - m.r, y1: ry, y2: ry, stroke: C.ink2, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, s);
      }
      var cols = svg('g', { 'class': 'viz-cols' }, s);
      if (s.lastChild && s.lastChild.tagName === 'line') s.appendChild(s.lastChild);
      d.years.forEach(function (yr, i) {
        var cx = m.l + band * (i + 0.5), x0 = cx - bw / 2;
        var g = svg('g', { 'class': 'viz-col' }, cols);
        var top = y(d.mbl[i]), base = y(0);
        svg('path', { d: barPath(x0, top, bw, base - top, 1, true), fill: C.atm, 'class': 'viz-seg' }, g);
        if (isNum(d.mbl_unc[i])) {
          svg('line', { x1: cx, x2: cx, y1: y(d.mbl[i] - d.mbl_unc[i]), y2: y(d.mbl[i] + d.mbl_unc[i]),
            stroke: C.ink2, 'stroke-width': 1, 'class': 'viz-mark' }, g);
        }
        if (isNum(d.inv[i])) {
          svg('circle', { cx: cx - bw * 0.2, cy: y(d.inv[i]), r: 4, fill: C.td, stroke: C.surface, 'stroke-width': 2, 'class': 'viz-mark' }, g);
        }
        if (isNum(d.greso[i])) {
          var gy = y(d.greso[i]), gx = cx + bw * 0.2;
          svg('path', { d: 'M' + gx + ',' + (gy - 5) + 'L' + (gx + 5) + ',' + gy + 'L' + gx + ',' + (gy + 5) + 'L' + (gx - 5) + ',' + gy + 'Z',
            fill: C.surface, stroke: C.ink, 'stroke-width': 1.6, 'class': 'viz-mark' }, g);
        }
        if (band >= 30 || i % 2 === 0 || i === n - 1) {
          svg('text', { x: cx, y: H - m.b + 18, 'text-anchor': 'middle', 'class': 'viz-tick' }, s)
            .textContent = band < 40 ? "'" + String(yr).slice(2) : String(yr);
        }
        var hit = svg('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent', 'class': 'viz-hit',
          tabindex: 0, role: 'img', 'aria-label': yr + ': marine boundary layer ' + fmt(d.mbl[i]) + ' ppm per year' }, g);
        function on() {
          cols.classList.add('has-active'); g.classList.add('is-active');
          tip.show(cx + bw / 2, top, yr + ' · ppm yr⁻¹', [
            { color: C.atm, key: 'rect', value: pm(d.mbl[i], d.mbl_unc[i]), label: 'Marine boundary layer' },
            { color: C.td, key: 'dot', value: fmt(d.inv[i]), label: 'OCO-2 inversions' },
            { color: C.ink, key: 'diamond', value: fmt(d.greso[i]), label: 'GRESO' },
            { color: C.muted, key: 'line', value: pm(d.mlo[i], d.mlo_unc[i]), label: 'Mauna Loa' }
          ]);
        }
        function off() { cols.classList.remove('has-active'); g.classList.remove('is-active'); tip.hide(); }
        hit.addEventListener('pointerenter', on); hit.addEventListener('pointerleave', off);
        hit.addEventListener('focus', on); hit.addEventListener('blur', off);
      });
    }
    wireTable(fig, function (box) {
      table(box, 'Atmospheric CO₂ growth rate, ppm yr⁻¹', ['Year', 'MBL', '±1σ', 'Mauna Loa', 'GRESO', 'OCO-2 inversions'],
        d.years.map(function (yr, i) {
          return [String(yr), fmt(d.mbl[i]), fmt(d.mbl_unc[i]), fmt(d.mlo[i]), fmt(d.greso[i]), fmt(d.inv[i])];
        }));
    });
    draw();
    onResize(plot, draw);
  }

  // ------------------------------------------------------------------ monthly small multiples, shared crosshair
  function monthlyChart(fig) {
    var d = DATA.monthly;
    var plot = fig.querySelector('.viz-plot');
    var tip = new Tip(plot);
    var panels = [
      { k: 'growth', label: 'CO₂ growth rate', unit: 'ppm month⁻¹', color: C.atm, zero: false, d: 3 },
      { k: 'oni', label: 'Oceanic Niño Index', unit: '°C', color: C.ink, zero: true, d: 2, bands: [0.5, -0.5] },
      { k: 'temp', label: 'Global temperature anomaly', unit: '°C', color: C.temp, zero: false, d: 2 }
    ];
    function draw() {
      Array.prototype.slice.call(plot.querySelectorAll('svg')).forEach(function (n) { n.remove(); });
      tip.hide();
      var W = Math.max(300, plot.clientWidth);
      var ph = 104, gap = 30, m = { t: 22, r: 10, b: 28, l: 46 };
      var H = m.t + panels.length * ph + (panels.length - 1) * gap + m.b;
      var iw = W - m.l - m.r;
      var t0 = d.t[0], t1 = d.t[d.t.length - 1];
      var x = linear(t0, t1, m.l, m.l + iw);
      var s = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'class': 'viz-svg', role: 'img',
        'aria-label': 'Monthly CO₂ growth rate, Oceanic Niño Index and global temperature anomaly. Use the table view for all values.' });
      plot.insertBefore(s, plot.firstChild);
      var scales = [];
      panels.forEach(function (p, pi) {
        var top = m.t + pi * (ph + gap);
        var vals = d[p.k].filter(isNum);
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        if (p.zero) { lo = Math.min(lo, -0.6); hi = Math.max(hi, 0.6); }
        var dom = niceDomain(lo, hi, 3);
        var y = linear(dom.lo, dom.hi, top + ph, top);
        scales.push(y);
        svg('text', { x: m.l, y: top - 8, 'class': 'viz-direct' }, s).textContent = p.label + ' (' + p.unit + ')';
        yAxis(svg('g', null, s), dom, y, m.l, m.l + iw);
        if (p.bands) {
          p.bands.forEach(function (b) {
            var by = Math.round(y(b)) + 0.5;
            svg('line', { x1: m.l, x2: m.l + iw, y1: by, y2: by, stroke: C.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, s);
          });
        }
        var pts = [];
        d.t.forEach(function (tt, i) { if (isNum(d[p.k][i])) pts.push(x(tt) + ',' + y(d[p.k][i])); });
        svg('path', { d: 'M' + pts.join('L'), fill: 'none', stroke: p.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, s);
      });
      var y0 = Math.floor(t0), y1 = Math.floor(t1);
      for (var yr = y0 + (t0 > y0 ? 1 : 0); yr <= y1; yr++) {
        if (iw < 520 && yr % 2) continue;
        svg('text', { x: x(yr), y: H - m.b + 18, 'text-anchor': 'middle', 'class': 'viz-tick' }, s).textContent = String(yr);
      }
      var cross = svg('line', { y1: m.t, y2: H - m.b, 'class': 'viz-crosshair', visibility: 'hidden' }, s);
      var overlay = svg('rect', { x: m.l, y: m.t, width: iw, height: H - m.t - m.b, fill: 'transparent', tabindex: 0,
        'class': 'viz-hit', 'aria-label': 'Chart area. Use left and right arrow keys to move between months.' }, s);
      var cur = d.t.length - 1;
      function show(i) {
        cur = Math.max(0, Math.min(d.t.length - 1, i));
        var xx = Math.round(x(d.t[cur])) + 0.5;
        cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
        tip.show(xx, m.t + 60, d.date[cur], panels.map(function (p) {
          return { color: p.color, key: 'line', value: fmt(d[p.k][cur], p.d) + ' ' + p.unit, label: p.label };
        }));
      }
      function hide() { cross.setAttribute('visibility', 'hidden'); tip.hide(); }
      overlay.addEventListener('pointermove', function (ev) {
        var r = s.getBoundingClientRect();
        var tt = t0 + ((ev.clientX - r.left) * (W / r.width) - m.l) / iw * (t1 - t0);
        var best = 0, bd = Infinity;
        d.t.forEach(function (v, i) { var dd = Math.abs(v - tt); if (dd < bd) { bd = dd; best = i; } });
        show(best);
      });
      overlay.addEventListener('pointerleave', hide);
      overlay.addEventListener('focus', function () { show(cur); });
      overlay.addEventListener('blur', hide);
      overlay.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowLeft') { show(cur - 1); ev.preventDefault(); }
        if (ev.key === 'ArrowRight') { show(cur + 1); ev.preventDefault(); }
      });
    }
    wireTable(fig, function (box) {
      table(box, 'Monthly values', ['Month', 'CO₂ growth (ppm month⁻¹)', 'ONI (°C)', 'Temperature anomaly (°C)'],
        d.t.map(function (tt, i) { return [d.date[i], fmt(d.growth[i], 3), fmt(d.oni[i]), fmt(d.temp[i])]; }));
    });
    draw();
    onResize(plot, draw);
  }

  var builders = { budget: budgetChart, approach: approachChart, growth: growthChart, monthly: monthlyChart };
  Array.prototype.forEach.call(document.querySelectorAll('[data-chart]'), function (fig) {
    var b = builders[fig.getAttribute('data-chart')];
    if (b) {
      try { b(fig); } catch (err) { if (window.console) console.error('Chart failed:', err); }
    }
  });
})();
