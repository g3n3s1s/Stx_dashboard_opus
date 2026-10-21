/* Visual signal board for the STX Framework dashboard.
 * Reads window.STX_STATE (published by app.js) and draws icon tiles.
 */
(function () {
  'use strict';

  var TONE = {
    FIRED: 'red', TRIGGER: 'red', TRIGGERED: 'red', REVIEW: 'red', 'CAP HIT': 'red',
    NEAR: 'amber', WARN: 'amber', ARMED: 'amber', ACTIVE: 'amber', BELOW: 'amber', WATCH: 'amber',
    'T1 SUPPRESSED': 'blue', PAUSED: 'blue', DORMANT: 'blue',
    OK: 'green', MET: 'green', USED: 'grey', 'NOT MET': 'grey', 'N/A': 'grey'
  };
  var RANK = { red: 4, amber: 3, blue: 2, green: 1, grey: 0 };
  var LABEL = { red: 'Action', amber: 'Watch', blue: 'Paused', green: 'Clear', grey: 'Inactive' };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&', '<': '<', '>': '>', '"': '"' }[c]; }); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function usd(x) { return x == null || !isFinite(x) ? '—' : '\u0024' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(x, d) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function toneOf(status) { return TONE[status] || 'grey'; }
  function worst(tones) { var t = 'grey'; tones.forEach(function (x) { if (RANK[x] > RANK[t]) t = x; }); return t; }

  function findRow(E, prefix) {
    for (var i = 0; i < E.rows.length; i++) if (E.rows[i].rule.indexOf(prefix) === 0) return E.rows[i];
    return null;
  }

  /* ---------- mini visual widgets ---------- */
  function pips(filled, total, tone) {
    var h = '<div class="pips">';
    for (var i = 0; i < total; i++) h += '<span class="pip' + (i < filled ? ' on ' + tone : '') + '"></span>';
    return h + '</div>';
  }
  // value 0..1 along a bar, with optional tick marks [{at:0..1,label}]
  function bar(value, tone, marks) {
    var h = '<div class="vbar"><div class="vfill ' + tone + '" style="width:' + (clamp(value, 0, 1) * 100).toFixed(1) + '%"></div>';
    (marks || []).forEach(function (m) {
      h += '<span class="vmark" style="left:' + (m.at * 100).toFixed(1) + '%"><i>' + esc(m.label) + '</i></span>';
    });
    return h + '</div>';
  }

  function tile(o) {
    return '<div class="tile t-' + o.tone + '" title="' + esc(o.tip || '') + '">' +
      '<div class="t-head"><span class="t-ico">' + o.icon + '</span>' +
      '<span class="t-title">' + esc(o.title) + '</span>' +
      '<span class="t-state ' + o.tone + '">' + esc(o.state || LABEL[o.tone]) + '</span></div>' +
      '<div class="t-big">' + o.big + '</div>' +
      (o.viz || '') +
      '<div class="t-sub">' + o.sub + '</div></div>';
  }

  /* ---------- build tiles ---------- */
  function render() {
    var S = window.STX_STATE; if (!S || !S.EVAL) return;
    var E = S.EVAL, I = S.IND, M = S.SIM, cfg = S.cfg, D = S.DATA;
    var i = D.length - 1, close = D[i].c;
    var tiles = [];

    // 1. Profit ladder
    var rLad = findRow(E, 'Next ladder rung');
    if (rLad && M) {
      var rung = M.A1 * Math.pow(1 + M.step, M.k);
      var tL = toneOf(rLad.status);
      tiles.push({ icon: '🪜', title: 'Profit Ladder', tone: tL, state: rLad.status,
        big: usd(rung), viz: bar(close / rung, tL === 'grey' ? 'green' : tL),
        sub: M.dormant ? 'Dormant until close > 50-SMA' : 'Rung k=' + M.k + ' · needs <b>+' + pct(rung / close - 1) + '</b>',
        tip: rLad.reading + ' | ' + rLad.threshold });
    }

    // 2. Valuation
    var rVal = findRow(E, 'Valuation Accelerator');
    if (rVal) {
      var pe = E.pe, tV = toneOf(rVal.status);
      tiles.push({ icon: '💎', title: 'Valuation (fwd P/E)', tone: tV, state: rVal.status,
        big: pe ? pe.toFixed(1) + '×' : '—',
        viz: pe ? bar(pe / (cfg.peSell * 1.25), tV, [{ at: cfg.peCompress / (cfg.peSell * 1.25), label: cfg.peCompress + '×' }, { at: 0.8, label: cfg.peSell + '×' }]) : '',
        sub: 'Accelerator ' + cfg.peCompress + '× · sell ' + cfg.peSell + '×', tip: rVal.action });
    }

    // 3. Trend family
    var rTr = findRow(E, 'Trend T1');
    if (rTr) {
      var tT = toneOf(rTr.status);
      tiles.push({ icon: '📉', title: 'Trend (50-SMA)', tone: tT, state: rTr.status,
        big: E.belowCnt + ' <small>close(s) below</small>',
        viz: pips(Math.min(E.belowCnt, 5), 5, tT === 'grey' ? 'red' : tT),
        sub: '50-SMA ' + usd(I.sma50[i]) + ' · 5 = T2 trigger', tip: rTr.reading });
    }

    // 4. Momentum family
    var rMo = findRow(E, 'Momentum');
    if (rMo) {
      var wl = I.weeks.length - 1, m = I.wMacd[wl], s = I.wSig[wl], tM = toneOf(rMo.status);
      var above = m != null && s != null && m >= s;
      tiles.push({ icon: '📊', title: 'Momentum (weekly MACD)', tone: tM, state: rMo.status,
        big: m == null ? '—' : (above ? '<span class="up">▲ above</span>' : '<span class="down">▼ below</span>') + ' <small>signal</small>',
        sub: (I.weeks[wl].complete ? 'Week closed' : '⏳ Week in progress') + ' · ' + esc(rMo.action), tip: rMo.reading });
    }

    // 5. Magnitude family (3 tiers)
    var tiers = [20, 30, 40].map(function (t) { return findRow(E, 'Magnitude −' + t); }).filter(Boolean);
    if (tiers.length) {
      var dd = I.dd[i], tG = worst(tiers.map(function (r) { return toneOf(r.status); }));
      var used = tiers.filter(function (r) { return r.status === 'USED' || r.status === 'FIRED'; }).length;
      tiles.push({ icon: '🕳️', title: 'Magnitude (drawdown)', tone: tG,
        state: used ? used + '/3 used' : LABEL[tG],
        big: '−' + pct(dd),
        viz: bar(dd / 0.5, tG === 'grey' ? 'amber' : tG, [{ at: 0.4, label: '20' }, { at: 0.6, label: '30' }, { at: 0.8, label: '40' }]),
        sub: 'From P2 ' + usd(I.p2[i]), tip: tiers.map(function (r) { return r.rule + ': ' + r.status; }).join(' | ') });
    }

    // 6. Episode / position
    var rEp = findRow(E, 'Episode cap');
    if (rEp && M) {
      var sold = M.ep ? M.ep.sold : 0, tE = M.ep ? (sold >= 35 ? 'red' : 'amber') : 'green';
      tiles.push({ icon: '🛡️', title: 'Position & episode', tone: tE, state: M.ep ? 'Episode open' : 'No episode',
        big: M.held.toFixed(0) + '% <small>of S0 held</small>',
        viz: bar(M.held / 100, 'blue', [{ at: 0.25, label: 'floor' }, { at: 0.5, label: 'S1' }]),
        sub: M.ep ? 'Episode used <b>' + sold.toFixed(0) + '%</b> of 35% cap' : 'Protection floor idle', tip: rEp.reading });
    }

    // 7. Mandatory System 4 review
    var rS4 = findRow(E, 'Mandatory System 4');
    if (rS4) {
      var t4 = toneOf(rS4.status);
      tiles.push({ icon: t4 === 'red' ? '🚨' : '🧭', title: 'System 4 review', tone: t4, state: rS4.status,
        big: t4 === 'red' ? 'Review now' : t4 === 'amber' ? 'Watching' : 'None',
        sub: esc(rS4.action === '—' ? 'No severe event open' : rS4.action), tip: rS4.reading });
    }

    // 8. Re-entry
    var re = E.rows.filter(function (r) { return r.sys === 'RE'; });
    if (re.length) {
      var na = re.length === 1, met = re.filter(function (r) { return r.status === 'MET'; }).length;
      var tR = na ? 'grey' : met === re.length ? 'red' : met >= 2 ? 'amber' : 'grey';
      tiles.push({ icon: '🔁', title: 'Re-entry', tone: tR, state: na ? 'N/A' : met + '/' + re.length + ' met',
        big: na ? '—' : met === re.length ? 'Buy back' : 'Not yet',
        viz: na ? '' : pips(met, re.length, met === re.length ? 'green' : 'amber'),
        sub: na ? 'Only after a System 2 sale' : 'RSI turn · 2 closes > 50-SMA · slope · fundamentals',
        tip: re.map(function (r) { return r.rule + ': ' + r.status; }).join(' | ') });
    }

    // 9. Early warnings / RSI gauge
    var w1 = findRow(E, 'Early warning: below 20'), w2 = findRow(E, 'Early warning: RSI');
    if (w1 && w2) {
      var rsi = I.rsi[i], tW = worst([toneOf(w1.status), toneOf(w2.status)]);
      var rTone = rsi > 70 ? 'red' : rsi < 35 ? 'blue' : rsi < 45 ? 'amber' : 'green';
      tiles.push({ icon: '⚠️', title: 'Early warnings', tone: tW,
        big: 'RSI ' + (rsi == null ? '—' : rsi.toFixed(0)),
        viz: bar((rsi || 0) / 100, rTone, [{ at: 0.35, label: '35' }, { at: 0.45, label: '45' }, { at: 0.7, label: '70' }]),
        sub: (w1.status === 'WARN' ? '🟠 ' : '🟢 ') + 'Below 20-SMA: ' + esc(w1.reading.split(' ')[0]) + ' session(s)', tip: w1.reading + ' | RSI ' + w2.reading });
    }

    // 10. Earnings countdown
    if (cfg.earningsDate) {
      var days = Math.ceil((new Date(cfg.earningsDate + 'T00:00:00Z') - Date.now()) / 864e5);
      var tD = days < -1 ? 'grey' : days <= 1 ? 'red' : days <= 14 ? 'amber' : 'green';
      tiles.push({ icon: '📅', title: 'Earnings (System 3)', tone: tD,
        state: days < -1 ? 'Set next date' : days <= 1 ? 'Event' : days <= 14 ? 'Soon' : 'Clear',
        big: days < -1 ? '—' : days < 0 ? 'Reported' : days + ' <small>day(s)</small>',
        sub: esc(cfg.earningsDate) + ' · check blackout window' });
    }

    el('board').innerHTML = tiles.map(tile).join('');
    renderVerdict(E, tiles);
  }

  function renderVerdict(E, tiles) {
    var acts = (E.firedToday || []).filter(function (e) { return e.type === 'sell' || e.type === 'buy' || e.type === 'review'; });
    var reds = tiles.filter(function (t) { return t.tone === 'red'; }).map(function (t) { return t.icon + ' ' + t.title; });
    var ambers = tiles.filter(function (t) { return t.tone === 'amber'; }).map(function (t) { return t.icon + ' ' + t.title; });
    var cls, icon, head, body;
    if (acts.length) {
      cls = 'red'; icon = '🔴'; head = 'Action on today’s close';
      body = acts.map(function (e) {
        return '<b>' + e.sys + '</b> ' + (e.pct > 0 ? 'sell ' + e.pct.toFixed(1) + '% S0' : e.pct < 0 ? 'buy back ' + (-e.pct).toFixed(1) + '% S0' : 'review') + (e.limit ? ' · limit ' + usd(e.limit) : '');
      }).join('  |  ');
    } else if (reds.length) {
      cls = 'red'; icon = '🔴'; head = 'Condition active'; body = reds.join(' · ');
    } else if (ambers.length) {
      cls = 'amber'; icon = '🟠'; head = 'Watch'; body = ambers.join(' · ');
    } else {
      cls = 'green'; icon = '🟢'; head = 'All clear'; body = 'No trigger on the latest close.';
    }
    el('verdict').innerHTML = '<div class="verdict v-' + cls + '"><span class="v-ico">' + icon + '</span><div><div class="v-head">' + head + '</div><div class="v-body">' + body + '</div></div></div>';
  }

  document.addEventListener('stx:update', render);
  if (window.STX_STATE) render();
})();
