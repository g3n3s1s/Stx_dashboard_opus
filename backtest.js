/* System 1 backtest: "Current" ladder vs "Arm then sell on weakness".
 * Runs in the browser on the real daily prices already loaded by app.js
 * (window.STX_STATE.DATA). Adds its own "🧪 Backtest" tab automatically.
 * System 1 only (no System 2/3/4), fills at next session open, before tax and fees.
 * No dollar signs or backticks in this file.
 */
(function () {
  'use strict';

  var LSB = 'stxfw.rev10.backtest';
  var opt = Object.assign({ start: '', years: 0, step: 0.15, floor: 50, armExit: 'sma20', usePe: false, peCompress: 30, peSell: 40 },
    JSON.parse(localStorage.getItem(LSB) || '{}'));
  var chart = null, lastKey = '';

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&', '<': '<', '>': '>', '"': '"' }[c]; }); }
  function usd(x, d) { if (x == null || !isFinite(x)) return '—'; return (x < 0 ? '−' : '') + '\u0024' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function pct(x, d) { return x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : '') + (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function pctAbs(x, d) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function save() { localStorage.setItem(LSB, JSON.stringify(opt)); }

  function sma(a, n) {
    var out = new Array(a.length).fill(null), s = 0;
    for (var i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }

  /* ------------------------------------------------------------------
   * Core simulation of System 1 for one start index.
   * mode 'current' : sell on the close that reaches a rung (fill next open)
   * mode 'arm'     : rung reached -> armed; sell all armed size on the first
   *                  later close below the exit line (20-SMA or 50-SMA)
   * Sizes are % of S0 (S0 = 1 share, so values are "per starting share").
   * ------------------------------------------------------------------ */
  function run(D, ind, s, mode, o) {
    var n = D.length, c = ind.c, s50 = ind.s50, exitLine = o.armExit === 'sma50' ? ind.s50 : ind.s20;
    var held = 1, cash = 0, A1 = 0, k = 1, dormant = false, armed = 0, armedSince = null, lastPeQ = null;
    for (var j = Math.max(0, s - 251); j <= s; j++) A1 = Math.max(A1, c[j]);
    var floor = o.floor / 100, sales = [], value = [], pending = null;

    function fillNext(i, frac, why) {
      if (i + 1 >= n) { pending = { frac: frac, why: why, d: D[i].d }; return; }
      var px = D[i + 1].o || c[i + 1];
      held -= frac; cash += frac * px;
      sales.push({ sig: D[i].d, d: D[i + 1].d, px: px, frac: frac, why: why });
    }
    function qKey(d) { return d.slice(0, 4) + 'Q' + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1); }

    for (var i = s; i < n; i++) {
      var cl = c[i];
      value.push(held * cl + cash);
      if (s50[i] == null) continue;
      var room = Math.max(0, held - floor);

      // dormant / re-base (same in both modes)
      if (!dormant && cl <= 0.65 * A1) { dormant = true; armed = 0; armedSince = null; continue; }
      if (dormant) { if (cl > s50[i]) { A1 = cl; k = 1; dormant = false; } continue; }

      // optional valuation rule (uses one forward EPS for the whole history)
      var pe = o.usePe && o.fwdEps > 0 ? cl / o.fwdEps : null;
      var accel = pe != null && pe >= o.peCompress;
      var stp = accel ? 0.08 : o.step;
      if (pe != null && pe >= o.peSell && lastPeQ !== qKey(D[i].d) && room > 0) {
        lastPeQ = qKey(D[i].d);
        fillNext(i, Math.min(0.10, room), 'P/E ' + pe.toFixed(0) + '×');
        A1 = cl; k = 1; armed = 0; armedSince = null; continue;
      }

      // rungs reached on this close
      var add = 0, hits = 0;
      while (cl >= A1 * Math.pow(1 + stp, k)) {
        var ext = cl / s50[i] - 1;
        add += (accel ? 0.08 : ext <= 0.25 ? 0.08 : ext <= 0.5 ? 0.05 : 0.03);
        k++; hits++;
      }

      if (mode === 'current') {
        if (add > 0 && room > 0) fillNext(i, Math.min(add, room), 'rung k=' + (k - hits) + (hits > 1 ? '–' + (k - 1) : ''));
      } else {
        if (add > 0) { armed += add; if (!armedSince) armedSince = D[i].d; }
        if (armed > 0 && exitLine[i] != null && cl < exitLine[i] && room > 0) {
          fillNext(i, Math.min(armed, room), 'armed since ' + armedSince + ', close < ' + (o.armExit === 'sma50' ? '50' : '20') + '-SMA');
          armed = 0; armedSince = null;
        }
      }
    }
    var last = c[n - 1];
    var sold = sales.reduce(function (a, x) { return a + x.frac; }, 0);
    var proceeds = sales.reduce(function (a, x) { return a + x.frac * x.px; }, 0);
    var peak = -Infinity, mdd = 0;
    value.forEach(function (v) { peak = Math.max(peak, v); mdd = Math.max(mdd, 1 - v / peak); });
    return { mode: mode, sales: sales, value: value, final: held * last + cash, held: held, cash: cash,
      sold: sold, avgPx: sold ? proceeds / sold : null, mdd: mdd, armedLeft: mode === 'arm' ? armed : 0, pending: pending };
  }

  function prepare(D) {
    var c = D.map(function (b) { return b.c; });
    return { c: c, s20: sma(c, 20), s50: sma(c, 50) };
  }

  /* Robustness: run both modes from many start dates (first session of each month) */
  function rolling(D, ind, o) {
    var out = [], seen = {}, minLeft = 252;
    for (var i = 252; i < D.length - minLeft; i++) {
      var m = D[i].d.slice(0, 7); if (seen[m]) continue; seen[m] = 1;
      var a = run(D, ind, i, 'current', o), b = run(D, ind, i, 'arm', o);
      out.push({ d: D[i].d, cur: a.final / D[i].c, arm: b.final / D[i].c, hold: D[D.length - 1].c / D[i].c });
    }
    return out;
  }

  /* ------------------------------------------------------------------ UI */
  function injectTab() {
    if (el('p-bt')) return;
    var nav = document.querySelector('nav');
    var main = document.querySelector('main');
    if (!nav || !main) return;
    var btn = document.createElement('button');
    btn.className = 'tab'; btn.dataset.panel = 'p-bt'; btn.textContent = '🧪 Backtest';
    var ref = nav.querySelector('[data-panel="p-s0"]'); nav.insertBefore(btn, ref || null);
    var sec = document.createElement('section');
    sec.className = 'panel'; sec.id = 'p-bt';
    sec.innerHTML =
      '<div class="box"><h2>🧪 System 1 backtest — Current ladder vs Arm-then-sell</h2>' +
      '<div class="form">' +
      '<label class="f">Backtest start date (blank = earliest possible)<input type="date" id="btStart"></label>' +
      '<label class="f">Ladder step (normal)<select id="btStep"><option value="0.15">15%</option><option value="0.10">10%</option><option value="0.20">20%</option></select></label>' +
      '<label class="f">System 1 floor (% of S0 kept)<input type="number" id="btFloor" min="0" max="100" step="5"></label>' +
      '<label class="f">Arm mode sells when close falls below<select id="btExit"><option value="sma20">20-SMA (faster)</option><option value="sma50">50-SMA (slower)</option></select></label>' +
      '<label class="f">Include P/E rules (uses today\'s forward EPS for all history)<select id="btPe"><option value="0">No (recommended)</option><option value="1">Yes</option></select></label>' +
      '</div><button class="primary" id="btRun">▶ Run backtest</button> <span class="status" id="btMsg"></span>' +
      '<p class="note">System 1 only, starting with 1 share (S0 = 1), so values are per starting share. A1 = highest close of the 252 sessions before the start. Signals on the close, filled at the next session open. Dormant / re-base rule included. No System 2/3/4, tax, fees or interest on cash.</p></div>' +
      '<div class="cards" id="btCards"></div>' +
      '<div class="box"><h2>Value per starting share</h2><div class="chart tall"><canvas id="btChart"></canvas></div></div>' +
      '<div class="box"><h2>Robustness — every monthly start date (≥ 1 year of data after it)</h2><div id="btRoll"></div></div>' +
      '<div class="grid2"><div class="box"><h2>🪜 Current ladder — sales</h2><table id="btSalesA"></table></div>' +
      '<div class="box"><h2>🎯 Arm-then-sell — sales</h2><table id="btSalesB"></table></div></div>';
    main.insertBefore(sec, main.querySelector('.disclaimer'));
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === btn); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'p-bt'); });
      render(true);
    });
    el('btStart').value = opt.start; el('btStep').value = String(opt.step); el('btFloor').value = opt.floor;
    el('btExit').value = opt.armExit; el('btPe').value = opt.usePe ? '1' : '0';
    el('btRun').addEventListener('click', function () {
      opt.start = el('btStart').value; opt.step = +el('btStep').value; opt.floor = +el('btFloor').value;
      opt.armExit = el('btExit').value; opt.usePe = el('btPe').value === '1'; save(); render(true);
    });
  }

  function salesTable(r) {
    if (!r.sales.length) return '<tbody><tr><td class="muted">No sales in this period.</td></tr></tbody>';
    return '<thead><tr><th>Signal close</th><th>Filled</th><th>Price</th><th>% of S0</th><th>Why</th></tr></thead><tbody>' +
      r.sales.map(function (x) {
        return '<tr><td>' + x.sig + '</td><td>' + x.d + '</td><td>' + usd(x.px) + '</td><td>' + pctAbs(x.frac, 0) + '</td><td class="muted">' + esc(x.why) + '</td></tr>';
      }).join('') + '</tbody>' +
      (r.armedLeft > 0 ? '<tfoot><tr><td colspan="5" class="muted">⏳ ' + pctAbs(r.armedLeft, 0) + ' of S0 is armed and waiting for a close below the exit line.</td></tr></tfoot>' : '') +
      (r.pending ? '<tfoot><tr><td colspan="5" class="muted">⏳ Signal on ' + r.pending.d + ' to sell ' + pctAbs(r.pending.frac, 0) + ' at the next open.</td></tr></tfoot>' : '');
  }

  function render(force) {
    var S = window.STX_STATE;
    if (!el('p-bt') || !S || !S.DATA || S.DATA.length < 320) {
      if (el('btMsg')) el('btMsg').textContent = 'Waiting for at least ~15 months of price data…';
      return;
    }
    if (!el('p-bt').classList.contains('active') && !force) return;
    var D = S.DATA, n = D.length, ind = prepare(D), cfg = S.cfg || {};
    var o = Object.assign({}, opt, { fwdEps: +cfg.fwdEps || 0, peCompress: +cfg.peCompress || 30, peSell: +cfg.peSell || 40 });
    var s = 252;
    if (o.start) { var j = 0; while (j < n && D[j].d < o.start) j++; s = Math.max(252, j); }
    if (s >= n - 20) { el('btMsg').textContent = 'Start date is too close to the end of the data.'; return; }
    var key = [D[n - 1].d, n, JSON.stringify(o)].join('|');
    if (!force && key === lastKey) return; lastKey = key;

    var A = run(D, ind, s, 'current', o), B = run(D, ind, s, 'arm', o);
    var H = D[n - 1].c, base = D[s].c;
    el('btMsg').textContent = 'Backtest ' + D[s].d + ' → ' + D[n - 1].d + ' (' + (n - s) + ' sessions)';
    var diff = B.final - A.final;
    var cards = [
      ['🪜 Current ladder', usd(A.final), pct(A.final / base - 1) + ' · ' + A.sales.length + ' sales · avg ' + usd(A.avgPx)],
      ['🎯 Arm-then-sell', usd(B.final), pct(B.final / base - 1) + ' · ' + B.sales.length + ' sales · avg ' + usd(B.avgPx)],
      ['💤 Buy & hold', usd(H), pct(H / base - 1) + ' · never sold'],
      ['⚖️ Arm vs Current', '<span class="' + (diff >= 0 ? 'up' : 'down') + '">' + (diff >= 0 ? '+' : '') + usd(diff) + '</span>', pct(B.final / A.final - 1) + ' per starting share'],
      ['📦 Still held', pctAbs(A.held, 0) + ' vs ' + pctAbs(B.held, 0), 'Current vs Arm (of S0)'],
      ['📉 Worst drawdown', pctAbs(A.mdd, 0) + ' vs ' + pctAbs(B.mdd, 0), 'Current vs Arm (value)'],
    ];
    el('btCards').innerHTML = cards.map(function (c) { return '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="s">' + c[2] + '</div></div>'; }).join('');
    el('btSalesA').innerHTML = salesTable(A);
    el('btSalesB').innerHTML = salesTable(B);

    var R = rolling(D, ind, o);
    if (R.length) {
      var wins = R.filter(function (r) { return r.arm > r.cur; }).length;
      var d = R.map(function (r) { return r.arm / r.cur - 1; }).sort(function (a, b) { return a - b; });
      var med = d[Math.floor(d.length / 2)], worst = d[0], best = d[d.length - 1];
      var beatHoldA = R.filter(function (r) { return r.cur > r.hold; }).length, beatHoldB = R.filter(function (r) { return r.arm > r.hold; }).length;
      el('btRoll').innerHTML =
        '<span class="pill ' + (wins / R.length >= 0.5 ? 'ok' : 'bad') + '">🎯 Arm beat Current in <b>' + wins + ' / ' + R.length + '</b> start dates (' + pctAbs(wins / R.length, 0) + ')</span>' +
        '<span class="pill">Median difference <b>' + pct(med) + '</b></span><span class="pill">Worst ' + pct(worst) + '</span><span class="pill">Best ' + pct(best) + '</span>' +
        '<span class="pill muted">Beat buy & hold: Current ' + beatHoldA + ' / ' + R.length + ' · Arm ' + beatHoldB + ' / ' + R.length + '</span>' +
        '<p class="note">Each start date runs to the latest close. The result is the final value relative to the start price, so different start dates are comparable.</p>';
    } else el('btRoll').innerHTML = '<p class="muted">Need at least 2 years of data for the robustness test.</p>';

    if (typeof Chart === 'undefined') return;
    var labels = D.slice(s).map(function (b) { return b.d; });
    var L = function (lab, data, col, extra) { return Object.assign({ type: 'line', label: lab, data: data, borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: 0 }, extra || {}); };
    var mk = function (r, col, lab) {
      var pts = new Array(labels.length).fill(null);
      r.sales.forEach(function (x) { var j = labels.indexOf(x.d); if (j >= 0) pts[j] = r.value[j]; });
      return { type: 'line', label: lab, data: pts, showLine: false, pointStyle: 'triangle', pointRotation: 180, pointRadius: 7, borderColor: col, backgroundColor: col };
    };
    if (chart) chart.destroy();
    chart = new Chart(el('btChart'), { data: { labels: labels, datasets: [
      L('🪜 Current ladder', A.value, '#f0883e'), L('🎯 Arm-then-sell', B.value, '#58a6ff'),
      L('💤 Buy & hold', D.slice(s).map(function (b) { return b.c; }), '#8b949e', { borderDash: [5, 4], borderWidth: 1.5 }),
      mk(A, '#f0883e', '▼ Current sale'), mk(B, '#58a6ff', '▼ Arm sale')] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8b949e', usePointStyle: true } }, tooltip: { filter: function (it) { return it.raw != null; }, callbacks: { label: function (it) { return it.dataset.label + ': ' + usd(it.raw); } } } },
        scales: { x: { ticks: { color: '#8b949e', maxTicksLimit: 10, maxRotation: 0 }, grid: { color: 'rgba(255,255,255,.06)' } },
          y: { ticks: { color: '#8b949e', callback: function (v) { return usd(v, 0); } }, grid: { color: 'rgba(255,255,255,.06)' } } } } });
  }

  window.STX_BT = { run: run, prepare: prepare, rolling: rolling };
  function boot() { injectTab(); render(false); }
  document.addEventListener('stx:update', function () { render(false); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
