/* System 1 backtest: "Current" ladder vs "Arm then sell on weakness" vs buy and hold.
 * Part 1: single run from a start date to the latest close.
 * Part 2: fixed-horizon RISK test - every monthly start date measured over the same
 *         window length (e.g. 12 or 24 months), so windows that ended in a fall count.
 * Runs in the browser on the real daily prices loaded by app.js (window.STX_STATE.DATA).
 * Adds its own "🧪 Backtest" tab. System 1 only, fills at next session open, before tax and fees.
 * No dollar signs or backticks in this file.
 */
(function () {
  'use strict';

  var LSB = 'stxfw.rev10.backtest';
  var opt = Object.assign({ start: '', step: 0.15, floor: 50, armExit: 'sma20', usePe: false, cashRate: 0, horizon: 252, ddLimit: 30 },
    JSON.parse(localStorage.getItem(LSB) || '{}'));
  var chart = null, chartH = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&', '<': '<', '>': '>', '"': '"' }[c]; }); }
  function usd(x, d) { if (x == null || !isFinite(x)) return '—'; return (x < 0 ? '−' : '') + '\u0024' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function pct(x, d) { return x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function pctAbs(x, d) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function save() { localStorage.setItem(LSB, JSON.stringify(opt)); }
  function quant(arr, q) { var a = arr.slice().sort(function (x, y) { return x - y; }); if (!a.length) return null; var p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo] + (a[hi] - a[lo]) * (p - lo); }

  function sma(a, n) {
    var out = new Array(a.length).fill(null), s = 0;
    for (var i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }
  function prepare(D) { var c = D.map(function (b) { return b.c; }); return { c: c, s20: sma(c, 20), s50: sma(c, 50) }; }

  /* ------------------------------------------------------------------
   * System 1 from start index s to end index e (inclusive).
   * mode 'current' : sell on the close that reaches a rung (fill next open)
   * mode 'arm'     : rung reached -> armed; sell all armed size on the first
   *                  later close below the exit line (20-SMA or 50-SMA)
   * mode 'hold'    : never sell
   * Values are per starting share (S0 = 1). Cash earns o.cashRate % p.a.
   * ------------------------------------------------------------------ */
  function run(D, ind, s, e, mode, o) {
    var c = ind.c, s50 = ind.s50, exitLine = o.armExit === 'sma50' ? ind.s50 : ind.s20;
    var held = 1, cash = 0, A1 = 0, k = 1, dormant = false, armed = 0, armedSince = null, lastPeQ = null;
    var daily = Math.pow(1 + (+o.cashRate || 0) / 100, 1 / 252);
    for (var j = Math.max(0, s - 251); j <= s; j++) A1 = Math.max(A1, c[j]);
    var floor = o.floor / 100, sales = [], value = [], pending = null;

    function fillNext(i, frac, why) {
      if (i + 1 > e) { pending = { frac: frac, why: why, d: D[i].d }; return; }
      var px = D[i + 1].o || c[i + 1];
      held -= frac; cash += frac * px;
      sales.push({ sig: D[i].d, d: D[i + 1].d, px: px, frac: frac, why: why });
    }
    function qKey(d) { return d.slice(0, 4) + 'Q' + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1); }

    for (var i = s; i <= e; i++) {
      if (i > s) cash *= daily;
      var cl = c[i];
      value.push(held * cl + cash);
      if (mode === 'hold' || s50[i] == null) continue;
      var room = Math.max(0, held - floor);

      if (!dormant && cl <= 0.65 * A1) { dormant = true; armed = 0; armedSince = null; continue; }
      if (dormant) { if (cl > s50[i]) { A1 = cl; k = 1; dormant = false; } continue; }

      var pe = o.usePe && o.fwdEps > 0 ? cl / o.fwdEps : null;
      var accel = pe != null && pe >= o.peCompress;
      var stp = accel ? 0.08 : o.step;
      if (pe != null && pe >= o.peSell && lastPeQ !== qKey(D[i].d) && room > 0) {
        lastPeQ = qKey(D[i].d);
        fillNext(i, Math.min(0.10, room), 'P/E ' + pe.toFixed(0) + '×');
        A1 = cl; k = 1; armed = 0; armedSince = null; continue;
      }

      var add = 0, hits = 0;
      while (cl >= A1 * Math.pow(1 + stp, k)) {
        var ext = cl / s50[i] - 1;
        add += (accel ? 0.08 : ext <= 0.25 ? 0.08 : ext <= 0.5 ? 0.05 : 0.03);
        k++; hits++;
      }

      if (mode === 'current') {
        if (add > 0 && room > 0) fillNext(i, Math.min(add, room), 'rung k=' + (k - hits) + (hits > 1 ? '–' + (k - 1) : ''));
      } else {
        if (add > 0 && room > 0) { armed = Math.min(armed + add, room); if (!armedSince) armedSince = D[i].d; }
        if (armed > 0 && exitLine[i] != null && cl < exitLine[i] && room > 0) {
          fillNext(i, Math.min(armed, room), 'armed since ' + armedSince + ', close < ' + (o.armExit === 'sma50' ? '50' : '20') + '-SMA');
          armed = 0; armedSince = null;
        }
      }
    }
    var sold = sales.reduce(function (a, x) { return a + x.frac; }, 0);
    var proceeds = sales.reduce(function (a, x) { return a + x.frac * x.px; }, 0);
    var peak = -Infinity, mdd = 0;
    value.forEach(function (v) { peak = Math.max(peak, v); mdd = Math.max(mdd, 1 - v / peak); });
    var fin = value[value.length - 1];
    return { mode: mode, sales: sales, value: value, final: fin, held: held, cash: cash, sold: sold,
      avgPx: sold ? proceeds / sold : null, mdd: mdd, endOffPeak: 1 - fin / peak,
      atFloor: held <= floor + 1e-9, armedLeft: mode === 'arm' ? armed : 0, pending: pending };
  }

  /* ------------------------------------------------------------------
   * Fixed-horizon risk test: every monthly start date, measured over H sessions.
   * ------------------------------------------------------------------ */
  function horizon(D, ind, o) {
    var H = +o.horizon || 252, n = D.length, rows = [], seen = {};
    for (var s = 252; s + H <= n - 1; s++) {
      var m = D[s].d.slice(0, 7); if (seen[m]) continue; seen[m] = 1;
      var e = s + H, p0 = D[s].c, r = { d: D[s].d, end: D[e].d };
      ['hold', 'current', 'arm'].forEach(function (mode) {
        var x = run(D, ind, s, e, mode, o);
        r[mode] = { ret: x.final / p0 - 1, mdd: x.mdd, off: x.endOffPeak, sold: x.sold };
      });
      r.holdBigFall = r.hold.mdd >= o.ddLimit / 100;
      rows.push(r);
    }
    return rows;
  }

  function summarise(rows, mode, ddLimit) {
    var ret = rows.map(function (r) { return r[mode].ret; }), mdd = rows.map(function (r) { return r[mode].mdd; });
    var off = rows.map(function (r) { return r[mode].off; });
    var big = rows.filter(function (r) { return r.holdBigFall; });
    return {
      medRet: quant(ret, 0.5), p10Ret: quant(ret, 0.10), worstRet: Math.min.apply(null, ret), bestRet: Math.max.apply(null, ret),
      loss: ret.filter(function (x) { return x < 0; }).length / rows.length,
      medMdd: quant(mdd, 0.5), worstMdd: Math.max.apply(null, mdd),
      endOff: off.filter(function (x) { return x >= ddLimit / 100; }).length / rows.length,
      bigFallRet: big.length ? quant(big.map(function (r) { return r[mode].ret; }), 0.5) : null,
      bigFallMdd: big.length ? quant(big.map(function (r) { return r[mode].mdd; }), 0.5) : null,
      bigN: big.length
    };
  }

  /* ------------------------------------------------------------------ UI */
  function injectTab() {
    if (el('p-bt')) return;
    var nav = document.querySelector('nav'), main = document.querySelector('main');
    if (!nav || !main) return;
    var btn = document.createElement('button');
    btn.className = 'tab'; btn.dataset.panel = 'p-bt'; btn.textContent = '🧪 Backtest';
    nav.insertBefore(btn, nav.querySelector('[data-panel="p-s0"]') || null);
    var sec = document.createElement('section');
    sec.className = 'panel'; sec.id = 'p-bt';
    sec.innerHTML =
      '<div class="box"><h2>🧪 System 1 backtest — Current ladder vs Arm-then-sell vs Buy & hold</h2>' +
      '<div class="form">' +
      '<label class="f">Single-run start date (blank = earliest)<input type="date" id="btStart"></label>' +
      '<label class="f">Ladder step<select id="btStep"><option value="0.15">15%</option><option value="0.10">10%</option><option value="0.20">20%</option><option value="0.25">25%</option></select></label>' +
      '<label class="f">System 1 floor (% of S0 kept)<input type="number" id="btFloor" min="0" max="100" step="5"></label>' +
      '<label class="f">Arm mode sells when close falls below<select id="btExit"><option value="sma20">20-SMA (faster)</option><option value="sma50">50-SMA (slower)</option></select></label>' +
      '<label class="f">Cash yield on sale proceeds (% p.a.)<input type="number" id="btCash" step="0.25" min="0"></label>' +
      '<label class="f">Include P/E rules (uses today\'s forward EPS for all history)<select id="btPe"><option value="0">No (recommended)</option><option value="1">Yes</option></select></label>' +
      '<label class="f">Risk test horizon<select id="btHor"><option value="126">6 months</option><option value="252">12 months</option><option value="504">24 months</option><option value="756">36 months</option></select></label>' +
      '<label class="f">"Big fall" threshold (% below peak)<input type="number" id="btDd" min="5" max="80" step="5"></label>' +
      '</div><button class="primary" id="btRun">▶ Run backtest</button> <span class="status" id="btMsg"></span>' +
      '<p class="note">System 1 only, starting with 1 share (S0 = 1). A1 = highest close of the 252 sessions before each start. Signals on the close, filled at the next session open. Dormant / re-base rule included. No System 2/3/4, tax or fees.</p></div>' +

      '<div class="box"><h2>🛡️ Fixed-horizon risk test</h2><div id="btRiskHead" class="note"></div>' +
      '<div class="cards" id="btVerdict"></div><table id="btRisk"></table>' +
      '<p class="note">Each row is one monthly start date measured over the same horizon, so periods that ended in a fall count as much as periods that ended at a high. ' +
      '<b>Return</b> = value at the end of the window ÷ price at the start, including cash from sales. <b>Max drawdown</b> = largest fall in value from a peak inside the window. ' +
      '<b>Big-fall windows</b> = windows where the share price itself fell at least the threshold from its peak — the situations System 1 is meant to protect against.</p></div>' +
      '<div class="box"><h2>Return of each window (sorted)</h2><div class="chart"><canvas id="btHorChart"></canvas></div></div>' +

      '<div class="box"><h2>📅 Single run to the latest close</h2><div class="cards" id="btCards"></div>' +
      '<div class="chart tall"><canvas id="btChart"></canvas></div></div>' +
      '<div class="grid2"><div class="box"><h2>🪜 Current ladder — sales</h2><table id="btSalesA"></table></div>' +
      '<div class="box"><h2>🎯 Arm-then-sell — sales</h2><table id="btSalesB"></table></div></div>';
    main.insertBefore(sec, main.querySelector('.disclaimer'));
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === btn); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'p-bt'); });
      render();
    });
    el('btStart').value = opt.start; el('btStep').value = String(opt.step); el('btFloor').value = opt.floor;
    el('btExit').value = opt.armExit; el('btPe').value = opt.usePe ? '1' : '0'; el('btCash').value = opt.cashRate;
    el('btHor').value = String(opt.horizon); el('btDd').value = opt.ddLimit;
    el('btRun').addEventListener('click', function () {
      opt.start = el('btStart').value; opt.step = +el('btStep').value; opt.floor = +el('btFloor').value;
      opt.armExit = el('btExit').value; opt.usePe = el('btPe').value === '1'; opt.cashRate = +el('btCash').value || 0;
      opt.horizon = +el('btHor').value; opt.ddLimit = +el('btDd').value || 30; save(); render();
    });
  }

  function salesTable(r) {
    var foot = '';
    if (r.atFloor) foot = '<tfoot><tr><td colspan="5" class="muted">🧱 System 1 floor reached — no further System 1 sales possible.</td></tr></tfoot>';
    else if (r.armedLeft > 0) foot = '<tfoot><tr><td colspan="5" class="muted">⏳ ' + pctAbs(r.armedLeft, 0) + ' of S0 is armed, waiting for a close below the exit line.</td></tr></tfoot>';
    if (r.pending) foot += '<tfoot><tr><td colspan="5" class="muted">⏳ Signal on ' + r.pending.d + ' to sell ' + pctAbs(r.pending.frac, 0) + ' at the next open.</td></tr></tfoot>';
    if (!r.sales.length) return '<tbody><tr><td class="muted">No sales in this period.</td></tr></tbody>' + foot;
    return '<thead><tr><th>Signal close</th><th>Filled</th><th>Price</th><th>% of S0</th><th>Why</th></tr></thead><tbody>' +
      r.sales.map(function (x) {
        return '<tr><td>' + x.sig + '</td><td>' + x.d + '</td><td>' + usd(x.px) + '</td><td>' + pctAbs(x.frac, 0) + '</td><td class="muted">' + esc(x.why) + '</td></tr>';
      }).join('') + '</tbody>' + foot;
  }

  function renderRisk(D, ind, o) {
    var rows = horizon(D, ind, o);
    var Hm = Math.round(o.horizon / 21);
    if (rows.length < 3) {
      el('btRiskHead').textContent = 'Not enough data for a ' + Hm + '-month horizon. Choose a shorter horizon.';
      el('btRisk').innerHTML = ''; el('btVerdict').innerHTML = ''; return;
    }
    var S = { hold: summarise(rows, 'hold', o.ddLimit), current: summarise(rows, 'current', o.ddLimit), arm: summarise(rows, 'arm', o.ddLimit) };
    el('btRiskHead').innerHTML = '<b>' + rows.length + '</b> windows of ' + Hm + ' months · first start ' + rows[0].d + ' · last start ' + rows[rows.length - 1].d +
      ' · <b>' + S.hold.bigN + '</b> big-fall windows (price fell ≥ ' + o.ddLimit + '% from its peak)';

    // better/worse colouring vs buy & hold (higher is better for returns, lower for risk)
    function cell(v, base, higherBetter, f) {
      if (v == null) return '<td>—</td>';
      var cls = base == null || Math.abs(v - base) < 0.005 ? '' : ((v > base) === higherBetter ? 'up' : 'down');
      return '<td class="' + cls + '">' + f(v) + '</td>';
    }
    var lines = [
      ['Median return', 'medRet', true, pct], ['Bad case (10th percentile) return', 'p10Ret', true, pct],
      ['Worst window return', 'worstRet', true, pct], ['Best window return', 'bestRet', true, pct],
      ['Windows with a loss', 'loss', false, function (x) { return pctAbs(x, 0); }],
      ['Median max drawdown', 'medMdd', false, function (x) { return pctAbs(x, 0); }],
      ['Worst max drawdown', 'worstMdd', false, function (x) { return pctAbs(x, 0); }],
      ['Windows ending ≥ ' + o.ddLimit + '% below their peak', 'endOff', false, function (x) { return pctAbs(x, 0); }],
      ['Big-fall windows: median return', 'bigFallRet', true, pct],
      ['Big-fall windows: median max drawdown', 'bigFallMdd', false, function (x) { return pctAbs(x, 0); }],
    ];
    el('btRisk').innerHTML = '<thead><tr><th>Measure (' + Hm + '-month windows)</th><th>💤 Buy & hold</th><th>🪜 Current ladder</th><th>🎯 Arm-then-sell</th></tr></thead><tbody>' +
      lines.map(function (L) {
        var name = L[0], key = L[1], up = L[2], fmt = L[3];
        var b = S.hold[key];
        var holdTxt = b == null ? '—' : fmt(b);
        return '<tr><td>' + name + '</td><td>' + holdTxt + '</td>' + cell(S.current[key], b, up, fmt) + cell(S.arm[key], b, up, fmt) + '</tr>';
      }).join('') + '</tbody>';

    // plain-language verdict
    function score(m) {
      var s = 0;
      if (S[m].p10Ret > S.hold.p10Ret + 0.005) s++;
      if (S[m].worstRet > S.hold.worstRet + 0.005) s++;
      if (S[m].medMdd < S.hold.medMdd - 0.005) s++;
      if (S[m].endOff < S.hold.endOff) s++;
      if (S[m].bigFallRet != null && S[m].bigFallRet > S.hold.bigFallRet + 0.005) s++;
      return s;
    }
    var cost = function (m) { return S[m].medRet - S.hold.medRet; };
    var v = [
      ['🪜 Current: risk measures improved', score('current') + ' / 5', 'Median return ' + pct(cost('current')) + ' vs buy & hold'],
      ['🎯 Arm: risk measures improved', score('arm') + ' / 5', 'Median return ' + pct(cost('arm')) + ' vs buy & hold'],
      ['🛡️ Big-fall windows', S.hold.bigN ? pct(S.arm.bigFallRet) + ' vs ' + pct(S.hold.bigFallRet) : 'none', S.hold.bigN ? 'Arm vs buy & hold, median return' : 'No windows with a big fall in this data'],
    ];
    el('btVerdict').innerHTML = v.map(function (c) { return '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="s">' + c[2] + '</div></div>'; }).join('');

    if (typeof Chart === 'undefined') return;
    var sorted = function (m) { return rows.map(function (r) { return r[m].ret * 100; }).sort(function (a, b) { return a - b; }); };
    var labs = rows.map(function (_, i) { return Math.round(i / (rows.length - 1) * 100) + '%'; });
    if (chartH) chartH.destroy();
    chartH = new Chart(el('btHorChart'), { type: 'line', data: { labels: labs, datasets: [
      { label: '💤 Buy & hold', data: sorted('hold'), borderColor: '#8b949e', backgroundColor: '#8b949e', borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 },
      { label: '🪜 Current ladder', data: sorted('current'), borderColor: '#f0883e', backgroundColor: '#f0883e', pointRadius: 0, borderWidth: 2 },
      { label: '🎯 Arm-then-sell', data: sorted('arm'), borderColor: '#58a6ff', backgroundColor: '#58a6ff', pointRadius: 0, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8b949e', usePointStyle: true } }, tooltip: { callbacks: { label: function (it) { return it.dataset.label + ': ' + it.raw.toFixed(1) + '%'; } } } },
        scales: { x: { title: { display: true, text: 'Windows sorted from worst to best', color: '#8b949e' }, ticks: { color: '#8b949e', maxTicksLimit: 11 }, grid: { color: 'rgba(255,255,255,.06)' } },
          y: { title: { display: true, text: 'Return over the window (%)', color: '#8b949e' }, ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,.06)' } } } } });
  }

  function renderSingle(D, ind, o) {
    var n = D.length, s = 252;
    if (o.start) { var j = 0; while (j < n && D[j].d < o.start) j++; s = Math.max(252, j); }
    if (s >= n - 20) { el('btCards').innerHTML = '<p class="muted">Start date is too close to the end of the data.</p>'; return; }
    var A = run(D, ind, s, n - 1, 'current', o), B = run(D, ind, s, n - 1, 'arm', o), Hh = run(D, ind, s, n - 1, 'hold', o);
    var base = D[s].c, diff = B.final - A.final;
    var cards = [
      ['🪜 Current ladder', usd(A.final), pct(A.final / base - 1) + ' · ' + A.sales.length + ' sales · avg ' + usd(A.avgPx)],
      ['🎯 Arm-then-sell', usd(B.final), pct(B.final / base - 1) + ' · ' + B.sales.length + ' sales · avg ' + usd(B.avgPx)],
      ['💤 Buy & hold', usd(Hh.final), pct(Hh.final / base - 1) + ' · never sold'],
      ['⚖️ Arm vs Current', '<span class="' + (diff >= 0 ? 'up' : 'down') + '">' + (diff >= 0 ? '+' : '') + usd(diff) + '</span>', pct(B.final / A.final - 1) + ' per starting share'],
      ['📦 Still held', pctAbs(A.held, 0) + ' vs ' + pctAbs(B.held, 0), 'Current vs Arm (of S0)'],
      ['📉 Worst drawdown', pctAbs(A.mdd, 0) + ' / ' + pctAbs(B.mdd, 0) + ' / ' + pctAbs(Hh.mdd, 0), 'Current / Arm / Hold'],
    ];
    el('btCards').innerHTML = '<p class="note" style="grid-column:1/-1">' + D[s].d + ' → ' + D[n - 1].d + ' (' + (n - s) + ' sessions)</p>' +
      cards.map(function (c) { return '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="s">' + c[2] + '</div></div>'; }).join('');
    el('btSalesA').innerHTML = salesTable(A);
    el('btSalesB').innerHTML = salesTable(B);

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
      L('💤 Buy & hold', Hh.value, '#8b949e', { borderDash: [5, 4], borderWidth: 1.5 }),
      mk(A, '#f0883e', '▼ Current sale'), mk(B, '#58a6ff', '▼ Arm sale')] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8b949e', usePointStyle: true } }, tooltip: { filter: function (it) { return it.raw != null; }, callbacks: { label: function (it) { return it.dataset.label + ': ' + usd(it.raw); } } } },
        scales: { x: { ticks: { color: '#8b949e', maxTicksLimit: 10, maxRotation: 0 }, grid: { color: 'rgba(255,255,255,.06)' } },
          y: { ticks: { color: '#8b949e', callback: function (v) { return usd(v, 0); } }, grid: { color: 'rgba(255,255,255,.06)' } } } } });
  }

  function render() {
    var S = window.STX_STATE;
    if (!el('p-bt')) return;
    if (!S || !S.DATA || S.DATA.length < 320) { el('btMsg').textContent = 'Waiting for at least ~15 months of price data…'; return; }
    if (!el('p-bt').classList.contains('active')) return;
    var D = S.DATA, ind = prepare(D), cfg = S.cfg || {};
    var o = Object.assign({}, opt, { fwdEps: +cfg.fwdEps || 0, peCompress: +cfg.peCompress || 30, peSell: +cfg.peSell || 40 });
    el('btMsg').textContent = 'Data ' + D[0].d + ' → ' + D[D.length - 1].d + ' (' + D.length + ' sessions)';
    renderRisk(D, ind, o);
    renderSingle(D, ind, o);
  }

  window.STX_BT = { run: run, prepare: prepare, horizon: horizon, summarise: summarise };
  function boot() { injectTab(); render(); }
  document.addEventListener('stx:update', render);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
