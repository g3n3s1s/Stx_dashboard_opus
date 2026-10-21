/* Trade ledger + Net worth comparison for the STX Framework dashboard.
 * Reads window.STX_STATE and writes trades through window.STX_API (both from app.js).
 * The ledger lives only in this browser (localStorage). Export a CSV backup regularly.
 */
(function () {
  'use strict';

  var SYS = ['S1', 'S2', 'S3', 'S4', 'RE', 'S0', 'Other'];
  var SYS_LABEL = { S1: 'S1 · Profit ladder', S2: 'S2 · Protection floor', S3: 'S3 · Earnings', S4: 'S4 · Full exit', RE: 'Re-entry', S0: 'S0 · Concentration glide', Other: 'Other / discretionary' };
  var MATCH_WINDOW = 3;            // sessions after the signal close to look for your trade
  var charts = {};

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&', '<': '<', '>': '>', '"': '"' }[c]; }); }
  function usd(x, d) { if (x == null || !isFinite(x)) return '—'; var neg = x < 0; return (neg ? '−' : '') + '\u0024' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 0 : d }); }
  function signedUsd(x) { return (x > 0 ? '+' : '') + usd(x); }
  function pct(x, d) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function num(x, d) { return x == null || !isFinite(x) ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d }); }
  function S() { return window.STX_STATE || {}; }
  function API() { return window.STX_API; }
  function idx(d) { var D = S().DATA; return D ? Engine.indexOnOrAfter(D, d) : -1; }
  function msg(t, cls) { var m = el('lgMsg'); if (m) { m.textContent = t; m.className = 'status ' + (cls || ''); } }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* =====================================================================
   * Ledger tab
   * ===================================================================== */
  function initLedger() {
    if (!el('lgAdd')) return;
    el('lgSys').innerHTML = SYS.map(function (s) { return '<option value="' + s + '">' + SYS_LABEL[s] + '</option>'; }).join('');
    el('lgSys').value = 'S2';

    el('lgAdd').addEventListener('click', function () {
      var t = {
        id: uid(), d: el('lgDate').value, side: el('lgSide').value,
        shares: +el('lgShares').value, price: el('lgPrice').value === '' ? null : +el('lgPrice').value,
        sys: el('lgSys').value, note: el('lgNote').value.trim()
      };
      if (!/^\d{4}-\d{2}-\d{2}/.test(t.d) || !(t.shares > 0)) { msg('Enter a trade date and a positive number of shares.', 'err'); return; }
      var L = API().getLedger(); L.push(t); API().setLedger(L);
      el('lgShares').value = ''; el('lgPrice').value = ''; el('lgNote').value = '';
      msg('✅ Trade added: ' + t.side + ' ' + t.shares + ' sh on ' + t.d + ' (' + t.sys + ')', 'ok');
    });

    // delete + "log it" buttons (event delegation)
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-del],[data-fill]') : null;
      if (!b) return;
      if (b.dataset.del) {
        if (!confirm('Delete this trade?')) return;
        API().setLedger(API().getLedger().filter(function (t) { return t.id !== b.dataset.del; }));
        msg('Trade deleted.', 'ok');
      } else if (b.dataset.fill) {
        var f = JSON.parse(b.dataset.fill);
        el('lgDate').value = f.d; el('lgSide').value = f.side; el('lgShares').value = f.shares;
        el('lgSys').value = f.sys; el('lgPrice').value = ''; el('lgNote').value = 'Signal ' + f.sig;
        el('lgShares').focus(); window.scrollTo({ top: el('lgForm').offsetTop - 80, behavior: 'smooth' });
        msg('Form pre-filled from the signal. Adjust the shares and price to what you actually traded, then press Add trade.', '');
      }
    });

    el('lgExport').addEventListener('click', function () {
      var rows = [['date', 'side', 'shares', 'price', 'system', 'note']].concat(API().getLedger().map(function (t) {
        return [t.d, t.side, t.shares, t.price == null ? '' : t.price, t.sys, '"' + String(t.note || '').replace(/"/g, '""') + '"'];
      }));
      var blob = new Blob([rows.map(function (r) { return r.join(','); }).join('\n')], { type: 'text/csv' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'stx-trade-ledger-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    });

    el('lgImport').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (text) {
        var lines = text.trim().split(/\r?\n/); var added = [];
        lines.forEach(function (line, n) {
          var p = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*(?![\s\S]))/).map(function (x) { return x.trim().replace(/^"|"(?![\s\S])/g, '').replace(/""/g, '"'); });
          if (n === 0 && /date/i.test(p[0])) return;
          var side = (p[1] || '').toLowerCase().indexOf('b') === 0 ? 'buy' : 'sell';
          var sh = +String(p[2] || '').replace(/,/g, '');
          if (!/^\d{4}-\d{2}-\d{2}/.test(p[0] || '') || !(sh > 0)) return;
          added.push({ id: uid(), d: p[0].slice(0, 10), side: side, shares: sh, price: p[3] === '' || p[3] == null ? null : +p[3],
            sys: SYS.indexOf(p[4]) >= 0 ? p[4] : 'Other', note: p[5] || '' });
        });
        var replace = API().getLedger().length && confirm('Replace the existing ledger with the imported file?\n\nOK = replace · Cancel = append');
        API().setLedger((replace ? [] : API().getLedger()).concat(added));
        msg('⬆ Imported ' + added.length + ' trade(s).', 'ok');
        e.target.value = '';
      });
    });

    el('lgClear').addEventListener('click', function () {
      if (!API().getLedger().length) return;
      if (confirm('Delete ALL trades from the ledger? Export a CSV backup first if unsure.')) { API().setLedger([]); msg('Ledger cleared.', 'ok'); }
    });
  }

  function priceOf(t) {
    var D = S().DATA; if (t.price != null && isFinite(t.price)) return { px: t.price, est: false };
    if (!D) return { px: null, est: true };
    var j = Engine.indexOnOrAfter(D, t.d); if (j >= D.length) j = D.length - 1;
    return { px: D[j].c, est: true };
  }

  function renderLedger() {
    if (!el('lgTable')) return;
    var st = S(), cfg = st.cfg || API().getCfg(), L = API().getLedger(), D = st.DATA;
    var S0 = +cfg.s0 || 0;
    if (el('lgDate') && !el('lgDate').value) el('lgDate').value = D ? D[D.length - 1].d : new Date().toISOString().slice(0, 10);

    // running position (trades before the start date are shown but ignored)
    var shares = S0, sold = 0, bought = 0, pre = 0, rows = '';
    L.forEach(function (t) {
      var before = t.d < cfg.startDate;
      var p = priceOf(t);
      if (before) pre++;
      else if (t.side === 'sell') { shares -= t.shares; sold += t.shares; }
      else { shares += t.shares; bought += t.shares; }
      rows += '<tr' + (before ? ' class="dim"' : '') + '><td>' + esc(t.d) + '</td>' +
        '<td><span class="badge ' + (t.side === 'sell' ? 'bad' : 'ok') + '">' + (t.side === 'sell' ? '🔻 SELL' : '🔺 BUY') + '</span></td>' +
        '<td>' + num(t.shares, 2) + '</td>' +
        '<td>' + usd(p.px, 2) + (p.est ? ' <span class="muted" title="No price entered: using that session close">(close)</span>' : '') + '</td>' +
        '<td>' + usd(p.px * t.shares) + '</td>' +
        '<td class="sys s-' + esc(t.sys) + '">' + esc(t.sys) + '</td>' +
        '<td>' + (S0 ? pct(t.shares / S0) : '—') + '</td>' +
        '<td>' + (before ? '<span class="muted">before start · ignored</span>' : num(shares, 2) + ' (' + (S0 ? pct(shares / S0) : '—') + ')') + '</td>' +
        '<td>' + esc(t.note) + '</td>' +
        '<td><button class="mini" data-del="' + esc(t.id) + '" title="Delete">✖</button></td></tr>';
    });
    el('lgTable').innerHTML = L.length
      ? '<thead><tr><th>Date</th><th>Action</th><th>Shares</th><th>Price</th><th>Value</th><th>System</th><th>% S0</th><th>Held after</th><th>Note</th><th></th></tr></thead><tbody>' + rows + '</tbody>'
      : '<tbody><tr><td class="muted">No trades yet. Add your first trade above, or import a CSV (columns: date, side, shares, price, system, note).</td></tr></tbody>';

    var q = Engine.quarterKey(new Date().toISOString().slice(0, 10));
    var qSold = L.filter(function (t) { return t.side === 'sell' && ['S1', 'S2', 'S3'].indexOf(t.sys) >= 0 && Engine.quarterKey(t.d) === q; })
      .reduce(function (a, t) { return a + t.shares; }, 0);
    var cards = [
      ['🎯 S0 (start)', num(S0), 'on ' + esc(cfg.startDate)],
      ['🔻 Sold since start', num(sold, 2) + ' sh', S0 ? pct(sold / S0) + ' of S0' : ''],
      ['🔺 Bought back', num(bought, 2) + ' sh', S0 ? pct(bought / S0) + ' of S0' : ''],
      ['📦 Held now (ledger)', num(shares, 2) + ' sh', S0 ? pct(shares / S0) + ' of S0' : ''],
      ['🗓️ S1–S3 sold this quarter', num(qSold, 2) + ' sh', 'feeds System 0 automatically'],
      ['🧭 Dashboard uses', cfg.posMode === 'ledger' ? '📒 Ledger' : '🤖 Rules', cfg.posMode === 'ledger' ? 'your actual position' : 'switch above to use your trades'],
    ];
    if (pre) cards.push(['⚠️ Ignored', pre + ' trade(s)', 'dated before the start date']);
    el('lgCards').innerHTML = cards.map(function (c) { return '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="s">' + c[2] + '</div></div>'; }).join('');

    renderCompliance();
  }

  /* ---------- signal compliance: did you act on each signal? ---------- */
  function compliance() {
    var st = S(), D = st.DATA, sim = st.SIM_A, cfg = st.cfg;
    if (!D || !sim) return null;
    var S0 = +cfg.s0 || 1, n = D.length;
    var trades = API().getLedger().filter(function (t) { return t.d >= cfg.startDate; })
      .map(function (t) { return Object.assign({ j: Engine.indexOnOrAfter(D, t.d), left: t.shares }, t); });
    var out = [];
    sim.events.filter(function (e) { return (e.type === 'sell' || e.type === 'buy') && e.pct; }).forEach(function (e) {
      var side = e.pct > 0 ? 'sell' : 'buy', want = Math.abs(e.pct) / 100 * S0, got = 0, used = [];
      [true, false].forEach(function (strict) {           // pass 1: same system tag · pass 2: untagged/Other
        trades.forEach(function (t) {
          if (got >= want - 1e-9 || t.left <= 0 || t.side !== side || t.j < e.i || t.j > e.i + MATCH_WINDOW) return;
          if (strict ? t.sys !== e.sys : t.sys !== 'Other') return;
          var take = Math.min(t.left, want - got); t.left -= take; got += take; used.push(t.d);
        });
      });
      var open = e.i + MATCH_WINDOW >= n - 1;
      var status = got >= want * 0.9 ? 'ACTED' : got > 0 ? 'PARTIAL' : open ? 'PENDING' : 'MISSED';
      out.push({ e: e, side: side, want: want, got: got, status: status, dates: used });
    });
    var extra = trades.filter(function (t) { return t.left > 1e-9; });
    return { rows: out, extra: extra };
  }

  function renderCompliance() {
    var c = compliance(), box = el('lgComp');
    if (!box) return;
    if (!c) { box.innerHTML = '<tbody><tr><td class="muted">Load price data to compare your trades with the signals.</td></tr></tbody>'; el('lgCompSum').innerHTML = ''; return; }
    var ICON = { ACTED: ['ok', '✅ Acted'], PARTIAL: ['warn', '🟠 Partial'], MISSED: ['bad', '❌ Missed'], PENDING: ['info', '⏳ Pending'] };
    var cnt = { ACTED: 0, PARTIAL: 0, MISSED: 0, PENDING: 0 };
    var rows = c.rows.slice().reverse().map(function (r) {
      cnt[r.status]++;
      var fill = (r.status === 'MISSED' || r.status === 'PENDING' || r.status === 'PARTIAL')
        ? ' <button class="mini" data-fill=\'' + esc(JSON.stringify({ d: r.e.execD && r.e.execD !== 'next open' ? r.e.execD : r.e.d, side: r.side, shares: Math.round(r.want - r.got), sys: r.e.sys, sig: r.e.d })) + '\'>✍️ Log it</button>' : '';
      return '<tr><td>' + esc(r.e.d) + '</td><td class="sys s-' + r.e.sys + '">' + r.e.sys + '</td>' +
        '<td>' + (r.side === 'sell' ? '🔻 Sell' : '🔺 Buy') + ' ' + num(r.want, 1) + ' sh</td>' +
        '<td>' + num(r.got, 1) + ' sh' + (r.dates.length ? ' <span class="muted">(' + esc(r.dates.join(', ')) + ')</span>' : '') + '</td>' +
        '<td><span class="badge ' + ICON[r.status][0] + '">' + ICON[r.status][1] + '</span>' + fill + '</td>' +
        '<td class="muted">' + esc(r.e.note) + '</td></tr>';
    }).join('');
    var extraRows = c.extra.map(function (t) {
      return '<tr><td>' + esc(t.d) + '</td><td class="sys s-' + esc(t.sys) + '">' + esc(t.sys) + '</td><td>—</td><td>' + (t.side === 'sell' ? '🔻 ' : '🔺 ') + num(t.left, 1) + ' sh</td>' +
        '<td><span class="badge muted">🎲 No matching signal</span></td><td class="muted">' + esc(t.note || 'Discretionary / outside the rules (or tagged to a different system)') + '</td></tr>';
    }).join('');
    box.innerHTML = (rows || extraRows)
      ? '<thead><tr><th>Signal close</th><th>System</th><th>Signal asked</th><th>You traded</th><th>Status</th><th>Signal detail</th></tr></thead><tbody>' + rows + extraRows + '</tbody>'
      : '<tbody><tr><td class="muted">No buy/sell signals since the start date.</td></tr></tbody>';
    var total = c.rows.length - cnt.PENDING;
    el('lgCompSum').innerHTML = '<span class="pill ok">✅ ' + cnt.ACTED + ' acted</span><span class="pill warn">🟠 ' + cnt.PARTIAL + ' partial</span>' +
      '<span class="pill bad">❌ ' + cnt.MISSED + ' missed</span><span class="pill info">⏳ ' + cnt.PENDING + ' pending</span>' +
      '<span class="pill muted">🎲 ' + c.extra.length + ' outside the rules</span>' +
      (total ? '<span class="pill">Discipline score: <b>' + Math.round((cnt.ACTED + 0.5 * cnt.PARTIAL) / total * 100) + '%</b></span>' : '');
  }

  /* =====================================================================
   * Net worth tab: rules (religious) vs actual (ledger) vs buy & hold
   * ===================================================================== */
  function netWorth() {
    var st = S(), D = st.DATA, simR = st.SIM_R, cfg = st.cfg;
    if (!D || !simR) return null;
    var S0 = +cfg.s0 || 0, s = simR.start, n = D.length;
    var daily = Math.pow(1 + (+cfg.cashRate || 0) / 100, 1 / 252);

    // rules: each signal is filled at the next session open
    var fills = {};
    simR.events.forEach(function (e) {
      if (!e.pct || e.i + 1 >= n) return;
      (fills[e.i + 1] = fills[e.i + 1] || []).push(-e.pct / 100 * S0);
    });
    // actual: your ledger trades on their dates (price blank → that session close)
    var trades = {};
    API().getLedger().forEach(function (t) {
      if (t.d < cfg.startDate) return;
      var j = Engine.indexOnOrAfter(D, t.d); if (j >= n) return;
      (trades[j] = trades[j] || []).push(t);
    });

    var R = { sh: S0, cash: 0 }, A = { sh: S0, cash: 0 };
    var out = { labels: [], rules: [], actual: [], hold: [], start: s, R: R, A: A };
    for (var j = s; j < n; j++) {
      if (j > s) { R.cash *= daily; A.cash *= daily; }
      (fills[j] || []).forEach(function (dSh) { var px = D[j].o || D[j].c; R.sh += dSh; R.cash -= dSh * px; });
      (trades[j] || []).forEach(function (t) {
        var px = t.price != null && isFinite(t.price) ? t.price : D[j].c;
        var dSh = t.side === 'sell' ? -t.shares : t.shares; A.sh += dSh; A.cash -= dSh * px;
      });
      out.labels.push(D[j].d);
      out.rules.push(R.sh * D[j].c + R.cash);
      out.actual.push(A.sh * D[j].c + A.cash);
      out.hold.push(S0 * D[j].c);
    }
    out.close = D[n - 1].c; out.base = S0 * D[s].c;
    return out;
  }

  function mk(id, config) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(el(id), config); }

  function renderNetWorth() {
    if (!el('nwCards')) return;
    var nw = netWorth(), st = S();
    if (!nw) { el('nwCards').innerHTML = '<p class="muted">Waiting for price data…</p>'; return; }
    var k = nw.labels.length - 1, rV = nw.rules[k], aV = nw.actual[k], hV = nw.hold[k];
    var hasLedger = API().getLedger().length > 0;
    var tone = function (x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; };
    var cards = [
      ['🤖 Followed the rules religiously', usd(rV), pct(rV / nw.base - 1) + ' since ' + nw.labels[0]],
      ['📒 What you actually did', usd(aV), hasLedger ? pct(aV / nw.base - 1) + ' since ' + nw.labels[0] : 'no trades logged = buy & hold'],
      ['💤 Buy & hold (never sold)', usd(hV), pct(hV / nw.base - 1) + ' since ' + nw.labels[0]],
      ['⚖️ Actual vs rules', '<span class="' + tone(aV - rV) + '">' + signedUsd(aV - rV) + '</span>', aV >= rV ? '🟢 you are ahead of the rules' : '🔴 discipline gap — rules would be ahead'],
      ['🧪 Rules vs buy & hold', '<span class="' + tone(rV - hV) + '">' + signedUsd(rV - hV) + '</span>', rV >= hV ? 'the framework added value so far' : 'the framework cost value so far'],
    ];
    el('nwCards').innerHTML = cards.map(function (c) { return '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="s">' + c[2] + '</div></div>'; }).join('');

    var px = nw.close;
    el('nwTable').innerHTML = '<thead><tr><th>Scenario</th><th>Shares now</th><th>% S0</th><th>Position value</th><th>Cash from sales</th><th>Total</th></tr></thead><tbody>' +
      [['🤖 Rules', nw.R], ['📒 Actual', nw.A], ['💤 Buy & hold', { sh: +st.cfg.s0, cash: 0 }]].map(function (r) {
        return '<tr><td>' + r[0] + '</td><td>' + num(r[1].sh, 2) + '</td><td>' + pct(r[1].sh / (+st.cfg.s0 || 1)) + '</td><td>' + usd(r[1].sh * px) + '</td><td>' + usd(r[1].cash) + '</td><td><b>' + usd(r[1].sh * px + r[1].cash) + '</b></td></tr>';
      }).join('') + '</tbody>';

    if (typeof Chart === 'undefined' || !el('p-nw').classList.contains('active')) return;
    var C = { text: '#8b949e', grid: 'rgba(255,255,255,.06)' };
    var opts = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: C.text, usePointStyle: true } },
        tooltip: { callbacks: { label: function (it) { return it.dataset.label + ': ' + usd(it.raw); } } } },
      scales: { x: { ticks: { color: C.text, maxTicksLimit: 10, maxRotation: 0 }, grid: { color: C.grid } },
        y: { ticks: { color: C.text, callback: function (v) { return usd(v); } }, grid: { color: C.grid } } } };
    var L = function (label, data, color, o) { return Object.assign({ type: 'line', label: label, data: data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0 }, o || {}); };
    mk('cNw', { data: { labels: nw.labels, datasets: [
      L('🤖 Rules (religious)', nw.rules, '#3fb950'),
      L('📒 Actual (ledger)', nw.actual, '#58a6ff'),
      L('💤 Buy & hold', nw.hold, '#8b949e', { borderDash: [5, 4], borderWidth: 1.5 })] }, options: opts });
    var gapA = nw.actual.map(function (v, i) { return v - nw.rules[i]; });
    var gapR = nw.rules.map(function (v, i) { return v - nw.hold[i]; });
    mk('cNwDiff', { data: { labels: nw.labels, datasets: [
      L('⚖️ Actual − Rules', gapA, '#58a6ff', { fill: { target: 'origin', above: 'rgba(63,185,80,.18)', below: 'rgba(248,81,73,.18)' } }),
      L('🧪 Rules − Buy & hold', gapR, '#d29922', { borderDash: [4, 3], borderWidth: 1.5 })] }, options: opts });
  }

  /* ---------- wire up ---------- */
  function renderAll() { renderLedger(); renderNetWorth(); }
  document.addEventListener('stx:update', renderAll);
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { if (t.dataset.panel === 'p-nw') setTimeout(renderNetWorth, 0); });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { initLedger(); renderAll(); });
  else { initLedger(); if (window.STX_API) renderAll(); }
})();
