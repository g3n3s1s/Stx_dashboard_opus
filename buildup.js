/* Signal build-up panel for the STX Framework dashboard.
 * Shows every signal that needs several sessions / conditions to fire
 * (T1, T2, momentum, magnitude, confirmation, re-entry, episode close,
 * System 4 review window, early warning) as a step-by-step progress track.
 * Reads window.STX_STATE (published by app.js). No dollar signs or backticks.
 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&', '<': '<', '>': '>', '"': '"' }[c]; }); }
  function usd(x) { return x == null || !isFinite(x) ? '—' : '\u0024' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(x, d) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function md(d) { return d ? d.slice(5) : ''; }

  /* ---------- building blocks ---------- */
  // one step: state = 'on' | 'off' | 'part' | 'used' ; tone = red | amber | green | blue
  function step(state, tone, top, bottom, tip, today) {
    return '<div class="bu-step ' + state + ' ' + tone + (today ? ' today' : '') + '" title="' + esc(tip || '') + '">' +
      '<div class="bu-top">' + (top || '') + '</div><div class="bu-box">' + (state === 'on' || state === 'used' ? '✓' : state === 'part' ? '◐' : '') + '</div>' +
      '<div class="bu-bot">' + (bottom || '') + '</div></div>';
  }
  function gate(ok, label, tip) {
    return '<span class="bu-gate ' + (ok ? 'ok' : 'no') + '" title="' + esc(tip || '') + '">' + (ok ? '🔓 ' : '🔒 ') + esc(label) + '</span>';
  }
  function row(o) {
    return '<div class="bu-row bu-' + o.tone + '">' +
      '<div class="bu-name"><span class="bu-ico">' + o.icon + '</span><div><b>' + esc(o.name) + '</b><div class="bu-rule">' + o.rule + '</div></div></div>' +
      '<div class="bu-track">' + o.track + (o.gates ? '<div class="bu-gates">' + o.gates + '</div>' : '') + '</div>' +
      '<div class="bu-status"><div class="bu-count">' + o.count + '</div><span class="bu-badge ' + o.tone + '">' + esc(o.badge) + '</span>' +
      (o.next ? '<div class="bu-next">' + o.next + '</div>' : '') + '</div></div>';
  }
  function minibars(vals) {
    var m = 0; vals.forEach(function (v) { if (v != null) m = Math.max(m, Math.abs(v)); });
    return '<div class="bu-mini">' + vals.map(function (v) {
      if (v == null) return '<span class="bu-mb"></span>';
      var h = m ? Math.max(6, Math.abs(v) / m * 100) : 6;
      return '<span class="bu-mb"><i class="' + (v >= 0 ? 'pos' : 'neg') + '" style="height:' + h.toFixed(0) + '%"></i></span>';
    }).join('') + '</div>';
  }

  /* ---------- main ---------- */
  function render() {
    var box = el('buildup'), S = window.STX_STATE;
    if (!box || !S || !S.IND || !S.DATA) return;
    var D = S.DATA, I = S.IND, sim = S.SIM, ep = sim ? sim.ep : null, cfg = S.cfg;
    var n = D.length, i = n - 1, c = I.c, s50 = I.sma50, s20 = I.sma20, v = I.v, av = I.avgVol, R = I.rsi;
    var below = function (j) { return s50[j] != null && c[j] < s50[j]; };
    var rows = [];

    var belowCnt = 0; for (var j = i; j >= 0 && below(j); j--) belowCnt++;
    var aboveCnt = 0; for (j = i; j >= 0 && s50[j] != null && c[j] > s50[j]; j--) aboveCnt++;

    /* 1. Early warning: 2 closes below 20-SMA */
    var b20 = 0; for (j = i; j >= 0 && s20[j] != null && c[j] < s20[j]; j--) b20++;
    var t = '';
    for (j = i - 1; j <= i; j++) {
      var on20 = s20[j] != null && c[j] < s20[j];
      t += step(on20 && j > i - b20 ? 'on' : 'off', 'amber', md(D[j].d), on20 ? 'below' : 'above', 'Close ' + usd(c[j]) + ' vs 20-SMA ' + usd(s20[j]), j === i);
    }
    rows.push({ icon: '⚠️', name: 'Early warning · 20-SMA', rule: '2 closes in a row below the 20-SMA', track: '<div class="bu-steps">' + t + '</div>',
      count: Math.min(b20, 2) + '/2', tone: b20 >= 2 ? 'amber' : 'green', badge: b20 >= 2 ? 'Warning on' : b20 === 1 ? 'Building' : 'Clear',
      next: b20 >= 2 ? b20 + ' sessions below' : '20-SMA ' + usd(s20[i]) });

    /* 2. Trend T1: 2 closes below 50-SMA, both on above-average volume, RSI >= 35 */
    var trendUsed = ep && ep.fam.trend != null;
    var t1met = 0; t = '';
    for (j = i - 1; j <= i; j++) {
      var bj = below(j), vj = av[j] != null && v[j] > av[j];
      if (bj) t1met++; if (vj) t1met++;
      t += step(trendUsed ? 'used' : bj ? 'on' : 'off', 'red', md(D[j].d), 'below 50', 'Close ' + usd(c[j]) + ' vs 50-SMA ' + usd(s50[j]), j === i);
      t += step(trendUsed ? 'used' : vj ? 'on' : 'off', 'red', '', 'vol ' + (av[j] ? (v[j] / av[j]).toFixed(1) + '×' : '—'), 'Volume ' + (v[j] / 1e6).toFixed(2) + 'M vs prior-50 avg ' + (av[j] ? (av[j] / 1e6).toFixed(2) + 'M' : '—'), j === i);
      if (j === i - 1) t += '<span class="bu-sep"></span>';
    }
    var rsiOk = R[i] == null || R[i] >= 35;
    var t1Fire = t1met === 4 && rsiOk;
    rows.push({ icon: '📉', name: 'Trend T1 · fast', rule: '2 closes below 50-SMA, <b>both</b> on above-average volume',
      track: '<div class="bu-steps">' + t + '</div>', gates: gate(rsiOk, 'RSI ' + (R[i] != null ? R[i].toFixed(0) : '—') + (rsiOk ? ' ≥ 35' : ' < 35 · T1 suppressed'), 'T1 is blocked when RSI(14) is below 35 (already oversold)'),
      count: trendUsed ? '—' : t1met + '/4', tone: trendUsed ? 'grey' : t1Fire ? 'red' : t1met >= 3 ? 'amber' : t1met === 4 ? 'blue' : 'green',
      badge: trendUsed ? 'Used ' + md(D[ep.fam.trend].d) : t1Fire ? 'FIRES · sell 5%' : t1met === 4 ? 'Suppressed' : t1met >= 2 ? 'Building' : 'Clear',
      next: trendUsed ? 'Trend family already fired this episode' : 'Sell 5% S0 when all 4 are ✓' });

    /* 3. Trend T2: 5 closes in a row below 50-SMA */
    t = '';
    for (j = i - 4; j <= i; j++) {
      var inStreak = j > i - belowCnt, bj2 = below(j);
      t += step(trendUsed ? 'used' : inStreak ? 'on' : bj2 ? 'part' : 'off', 'red', md(D[j].d), pct(c[j] / s50[j] - 1, 1),
        'Close ' + usd(c[j]) + ' vs 50-SMA ' + usd(s50[j]) + (bj2 && !inStreak ? ' (below, but streak broken later)' : ''), j === i);
    }
    var k2 = Math.min(belowCnt, 5);
    rows.push({ icon: '📉', name: 'Trend T2 · slow', rule: '5 closes in a row below 50-SMA (any volume)', track: '<div class="bu-steps">' + t + '</div>',
      count: trendUsed ? '—' : k2 + '/5', tone: trendUsed ? 'grey' : k2 >= 5 ? 'red' : k2 >= 3 ? 'amber' : 'green',
      badge: trendUsed ? 'Used ' + md(D[ep.fam.trend].d) : k2 >= 5 ? 'FIRES · sell 5%' : k2 > 0 ? (5 - k2) + ' more close(s)' : 'Clear',
      next: 'Reset by any close above ' + usd(s50[i]) });

    /* 4. Momentum: weekly MACD histogram shrinking toward a cross */
    var W = I.weeks, wl = W.length - 1, h = I.wHist, hs = [];
    for (j = Math.max(0, wl - 7); j <= wl; j++) hs.push(h[j]);
    var falling = 0; for (j = wl; j > 0 && h[j] != null && h[j - 1] != null && h[j] < h[j - 1]; j--) falling++;
    var momUsed = ep && ep.fam.mom != null, hNow = h[wl];
    var momTone = momUsed ? 'grey' : hNow == null ? 'grey' : hNow < 0 ? 'amber' : falling >= 2 ? 'amber' : 'green';
    rows.push({ icon: '📊', name: 'Momentum · weekly MACD', rule: 'MACD crosses below its signal line at the <b>weekly</b> close',
      track: minibars(hs) + '<div class="bu-mini-lbl">last ' + hs.length + ' weeks · bars = MACD − signal' + (W[wl].complete ? '' : ' · ⏳ this week not closed') + '</div>',
      count: hNow == null ? '—' : (hNow >= 0 ? '+' : '') + hNow.toFixed(2), tone: momTone,
      badge: momUsed ? 'Used ' + md(D[ep.fam.mom].d) : hNow == null ? 'No data' : hNow < 0 ? 'Below signal' : falling >= 2 ? 'Converging ' + falling + 'w' : 'Clear',
      next: hNow != null && hNow > 0 && falling ? 'Shrinking for ' + falling + ' week(s) → cross when bar turns red' : '' });

    /* 5. Magnitude tiers */
    var dd = I.dd[i], p2 = I.p2[i], isBelow = below(i); t = '';
    [20, 30, 40].forEach(function (tier) {
      var hit = dd >= tier / 100, used = ep && ep.tiers[tier];
      t += step(used ? 'used' : hit && isBelow ? 'on' : hit ? 'part' : 'off', 'red', '−' + tier + '%', usd(p2 * (1 - tier / 100)),
        hit ? (isBelow ? 'Reached and below 50-SMA' : 'Reached, but close is above the 50-SMA (gate closed)') : 'Needs close ≤ ' + usd(p2 * (1 - tier / 100)), false);
    });
    var nextTier = [20, 30, 40].filter(function (x) { return !(ep && ep.tiers[x]) && dd < x / 100; })[0];
    var magFire = [20, 30, 40].some(function (x) { return dd >= x / 100 && isBelow && !(ep && ep.tiers[x]); });
    rows.push({ icon: '🕳️', name: 'Magnitude · drawdown', rule: 'Close ≥ 20 / 30 / 40% below P2 ' + usd(p2) + ' <b>and</b> below 50-SMA',
      track: '<div class="bu-steps">' + t + '</div>', gates: gate(isBelow, isBelow ? 'Below 50-SMA' : 'Above 50-SMA · tiers wait', 'Each tier only fires while the close is below the 50-SMA'),
      count: '−' + pct(dd), tone: magFire ? 'red' : nextTier && dd >= nextTier / 100 - 0.05 ? 'amber' : 'green',
      badge: magFire ? 'FIRES · sell 5%' : nextTier ? 'Next −' + nextTier + '%' : 'All tiers used',
      next: nextTier ? 'Needs a further ' + pct(1 - (1 - nextTier / 100) * p2 / c[i]) + ' fall to ' + usd(p2 * (1 - nextTier / 100)) : '' });

    /* 6. Confirmation top-up: 2 different families within 15 sessions */
    if (ep) {
      var fam = ep.fam, fired = ['trend', 'mom', 'mag'].filter(function (f) { return fam[f] != null; });
      var first = fired.length ? Math.min.apply(null, fired.map(function (f) { return fam[f]; })) : i;
      var elapsed = Math.min(15, i - first);
      t = '';
      ['trend', 'mom', 'mag'].forEach(function (f) {
        var lab = { trend: '📉 Trend', mom: '📊 Mom', mag: '🕳️ Mag' }[f];
        t += step(fam[f] != null ? 'on' : 'off', 'red', lab, fam[f] != null ? md(D[fam[f]].d) : '—', '', false);
      });
      var win = '<div class="bu-pips">';
      for (j = 0; j < 15; j++) win += '<span class="bu-pip ' + (j < elapsed ? 'on' : '') + '"></span>';
      win += '</div><div class="bu-mini-lbl">15-session window: ' + elapsed + ' used, ' + Math.max(0, 15 - elapsed) + ' left</div>';
      rows.push({ icon: '🤝', name: 'Confirmation top-up', rule: '2 <b>different</b> families fire within 15 sessions → top up to 20% S0',
        track: '<div class="bu-steps">' + t + '</div>' + win, count: fired.length + '/2',
        tone: ep.confirm ? 'grey' : fired.length >= 2 ? 'red' : 'amber', badge: ep.confirm ? 'Done' : fired.length >= 2 ? 'FIRES' : 'Waiting 2nd family',
        next: ep.confirm ? 'Top-up already applied' : '' });
    }

    /* 7. Re-entry */
    if (ep && ep.recSold > 0) {
      var volOk = (v[i] > av[i]) || (v[i - 1] > av[i - 1]);
      var slope = s50[i - 5] != null && s50[i] >= s50[i - 5];
      var parts = [
        [ep.rsiDip, 'RSI < 45', 'dipped'], [R[i] > R[i - 1], 'RSI ↑', R[i] != null ? R[i].toFixed(0) : '—'],
        [false, md(D[i - 1].d), 'above 50'], [false, md(D[i].d), 'above 50'],
        [volOk, 'Volume', 'above avg'], [slope, '50-SMA', 'not falling'], [!!cfg.fundamentalsOk, 'Fundam.', 'OK']
      ];
      parts[2][0] = s50[i - 1] != null && c[i - 1] > s50[i - 1]; parts[3][0] = s50[i] != null && c[i] > s50[i];
      var met = parts.filter(function (p) { return p[0]; }).length;
      t = parts.map(function (p) { return step(p[0] ? 'on' : 'off', 'green', p[1], p[2], '', false); }).join('');
      rows.push({ icon: '🔁', name: 'Re-entry', rule: 'All on the <b>same close</b> → buy back up to ' + ep.sold.toFixed(1) + '% S0',
        track: '<div class="bu-steps">' + t + '</div>', count: met + '/' + parts.length,
        tone: met === parts.length ? 'green' : met >= 5 ? 'amber' : 'grey', badge: met === parts.length ? 'BUY BACK' : met >= 5 ? 'Close' : 'Not yet', next: '' });
    }

    /* 8. Episode close: 10 closes in a row above 50-SMA */
    if (ep) {
      var a = Math.min(ep.above || 0, 10); t = '<div class="bu-pips big">';
      for (j = 0; j < 10; j++) t += '<span class="bu-pip green ' + (j < a ? 'on' : '') + '"></span>';
      t += '</div>';
      rows.push({ icon: '🏁', name: 'Episode close', rule: '10 closes in a row above the 50-SMA end the System 2 episode', track: t,
        count: a + '/10', tone: a >= 7 ? 'green' : a > 0 ? 'blue' : 'grey', badge: a > 0 ? (10 - a) + ' more' : 'Not started',
        next: 'Any close below ' + usd(s50[i]) + ' resets to 0' });
    }

    /* 9. Mandatory System 4 review window */
    if (ep && ep.severe) {
      var sv = ep.severe, el2 = Math.min(10, i - sv.i); t = '<div class="bu-pips big">';
      for (j = 0; j < 10; j++) t += '<span class="bu-pip ' + (sv.flagged ? 'red ' : 'amber ') + (j < el2 ? 'on' : '') + '"></span>';
      t += '</div><div class="bu-mini-lbl">Severe event ' + md(D[sv.i].d) + ' at ' + usd(c[sv.i]) + ' · trigger: close below ' + usd(sv.low) + '</div>';
      rows.push({ icon: sv.flagged ? '🚨' : '🧭', name: 'System 4 review window', rule: 'New post-sale low within 10 sessions of a severe event', track: t,
        count: el2 + '/10', tone: sv.flagged ? 'red' : el2 < 10 ? 'amber' : 'grey', badge: sv.flagged ? 'REVIEW NOW' : el2 < 10 ? 'Watching' : 'Window closed', next: '' });
    }

    box.innerHTML = '<h2>🧱 Signal build-up <span class="bu-legend"><span class="bu-step on red mini"><div class="bu-box">✓</div></span> met · ' +
      '<span class="bu-step part red mini"><div class="bu-box">◐</div></span> partly / gate closed · <span class="bu-step off mini"><div class="bu-box"></div></span> not yet · ' +
      '<span class="bu-step used mini"><div class="bu-box">✓</div></span> already used this episode · outlined = latest close</span></h2>' + rows.map(row).join('');
  }

  document.addEventListener('stx:update', render);
  if (window.STX_STATE) render();
})();
