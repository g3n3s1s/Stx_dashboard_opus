/* STX Position Management Framework Rev. 10 — trigger dashboard
 * Engine (pure functions) + UI. All signals use daily CLOSING prices.
 * For analysis only — not financial advice. Public market data only.
 */
'use strict';

/* =========================================================================
 * 1. ENGINE
 * ========================================================================= */
const Engine = (() => {
  const FAM = { trend: 'Trend', mom: 'Momentum', mag: 'Magnitude' };

  function sma(a, n) {
    const out = new Array(a.length).fill(null); let s = 0;
    for (let i = 0; i < a.length; i++) {
      s += a[i]; if (i >= n) s -= a[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }

  // EMA seeded with SMA of first n valid values; tolerates leading nulls
  function ema(a, n) {
    const out = new Array(a.length).fill(null); const k = 2 / (n + 1);
    let first = a.findIndex(x => x != null); if (first < 0) return out;
    if (first + n - 1 >= a.length) return out;
    let s = 0; for (let i = first; i < first + n; i++) s += a[i];
    let e = s / n; out[first + n - 1] = e;
    for (let i = first + n; i < a.length; i++) { e = a[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }

  // Wilder RSI
  function rsi(c, n = 14) {
    const out = new Array(c.length).fill(null);
    if (c.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
    let ag = g / n, al = l / n;
    out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  const dUTC = s => new Date(s + 'T00:00:00Z');
  function mondayKey(s) {
    const d = dUTC(s); const wd = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10);
  }
  const weekday = s => dUTC(s).getUTCDay();
  const quarterKey = s => s.slice(0, 4) + 'Q' + (Math.floor((+s.slice(5, 7) - 1) / 3) + 1);

  function computeIndicators(bars) {
    const n = bars.length;
    const c = bars.map(b => b.c), v = bars.map(b => b.v || 0);
    const sma20 = sma(c, 20), sma50 = sma(c, 50), r = rsi(c, 14);
    // average volume of the PRIOR 50 sessions
    const avgVol = new Array(n).fill(null); let s = 0;
    for (let i = 0; i < n; i++) {
      if (i >= 50) avgVol[i] = s / 50;
      s += v[i]; if (i >= 50) s -= v[i - 50];
    }
    // P2 = highest close of trailing 252 sessions (inclusive)
    const p2 = new Array(n), p2Date = new Array(n), dd = new Array(n);
    for (let i = 0; i < n; i++) {
      let m = -Infinity, md = null;
      for (let j = Math.max(0, i - 251); j <= i; j++) if (c[j] >= m) { m = c[j]; md = bars[j].d; }
      p2[i] = m; p2Date[i] = md; dd[i] = 1 - c[i] / m;
    }
    // Weekly MACD 12/26/9 on weekly closes
    const weeks = []; const weekOf = new Array(n);
    for (let i = 0; i < n; i++) {
      const k = mondayKey(bars[i].d);
      if (!weeks.length || weeks[weeks.length - 1].key !== k) weeks.push({ key: k, first: i, last: i });
      weeks[weeks.length - 1].last = i; weekOf[i] = weeks.length - 1;
    }
    const wc = weeks.map(w => c[w.last]);
    const e12 = ema(wc, 12), e26 = ema(wc, 26);
    const macd = wc.map((_, i) => (e12[i] != null && e26[i] != null) ? e12[i] - e26[i] : null);
    const sig = ema(macd, 9);
    const hist = macd.map((m, i) => (m != null && sig[i] != null) ? m - sig[i] : null);
    const lastBarIsFriday = n ? weekday(bars[n - 1].d) === 5 : false;
    weeks.forEach((w, i) => { w.complete = i < weeks.length - 1 || lastBarIsFriday; w.d = bars[w.last].d; });
    const macdCrossDown = new Array(n).fill(false), macdCrossUp = new Array(n).fill(false);
    for (let w = 1; w < weeks.length; w++) {
      if ([macd[w - 1], sig[w - 1], macd[w], sig[w]].some(x => x == null) || !weeks[w].complete) continue;
      if (macd[w - 1] >= sig[w - 1] && macd[w] < sig[w]) macdCrossDown[weeks[w].last] = true;
      if (macd[w - 1] <= sig[w - 1] && macd[w] > sig[w]) macdCrossUp[weeks[w].last] = true;
    }
    return { c, v, sma20, sma50, rsi: r, avgVol, p2, p2Date, dd, weeks, weekOf,
      wMacd: macd, wSig: sig, wHist: hist, macdCrossDown, macdCrossUp };
  }

  /* Simulate Systems 1 + 2 + re-entry from the start date, exactly as written.
   * Position expressed as % of S0. Decisions on close; fills at next open. */
  function simulate(bars, ind, cfg) {
    const n = bars.length; const { c, v, sma50, rsi: R, avgVol, p2, dd } = ind;
    let start = bars.findIndex((b, i) => b.d >= cfg.startDate && sma50[i] != null && i >= 1);
    if (start < 0) return null;
    const events = []; const heldS = new Array(n).fill(null);
    const a1S = new Array(n).fill(null), rungS = new Array(n).fill(null);
    let held = 100;
    let A1 = +cfg.a1Override > 0 ? +cfg.a1Override : Math.max(...c.slice(Math.max(0, start - 251), start + 1));
    let k = 1, dormant = false, lastPeQuarter = null;
    let ep = null; const reentries = []; const s2Sales = [];
    const fresh = () => ({ sold: 0, startI: null, fam: { trend: null, mom: null, mag: null },
      tiers: { 20: false, 30: false, 40: false }, confirm: false, above: 0, lastSaleI: null,
      rsiDip: false, reentries: 0, severe: null, reviews: [] });
    const fill = i => (i + 1 < n ? { px: bars[i + 1].o || c[i + 1], d: bars[i + 1].d } : { px: null, d: 'next open' });
    const log = (i, sys, type, pct, note) => {
      const f = fill(i);
      events.push({ i, d: bars[i].d, sys, type, pct, close: c[i], execPx: pct ? f.px : null, execD: pct ? f.d : null,
        limit: pct ? c[i] * 0.97 : null, note, held: +held.toFixed(4) });
    };

    for (let i = start; i < n; i++) {
      const cl = c[i], s50 = sma50[i]; const below = cl < s50;
      let soldToday = 0;

      // ---- episode bookkeeping
      if (ep) {
        ep.above = cl > s50 ? ep.above + 1 : 0;
        if (R[i] != null && R[i] < 45) ep.rsiDip = true;
        if (ep.above >= 10) { log(i, 'S2', 'info', 0, 'Episode closed (10 consecutive closes above 50-SMA)'); ep = null; }
      }

      // ---- System 2 Protection Floor
      if (sma50[i - 1] != null) {
        const st = ep || fresh(); const sig = [];
        const prevBelow = c[i - 1] < sma50[i - 1];
        const t1 = below && prevBelow && v[i] > (avgVol[i] || Infinity) && v[i - 1] > (avgVol[i - 1] || Infinity);
        const t1Supp = R[i] != null && R[i] < 35;
        let t2 = i >= 4; for (let j = i - 4; j <= i && t2; j++) t2 = sma50[j] != null && c[j] < sma50[j];
        if (st.fam.trend == null && ((t1 && !t1Supp) || t2)) sig.push({ f: 'trend', pct: 5, note: t2 ? 'Trend T2: 5 closes below 50-SMA' : 'Trend T1: 2 closes below 50-SMA on above-avg volume' });
        if (st.fam.mom == null && ind.macdCrossDown[i]) sig.push({ f: 'mom', pct: 5, note: 'Momentum: weekly MACD crossed below signal' });
        for (const t of [20, 30, 40]) if (below && dd[i] >= t / 100 && !st.tiers[t]) sig.push({ f: 'mag', tier: t, pct: 5, note: ("Magnitude −" + (t) + "% from P2") });

        if (sig.length) {
          if (!ep) { ep = st; ep.startI = i; }
          sig.forEach(s => { ep.fam[s.f] = i; if (s.tier) ep.tiers[s.tier] = true; });
          let want = sig.reduce((a, s) => a + s.pct, 0); let topUp = 0;
          const fired = Object.values(ep.fam).filter(x => x != null);
          let pair = false;
          for (let a = 0; a < fired.length; a++) for (let b = a + 1; b < fired.length; b++) if (Math.abs(fired[a] - fired[b]) <= 15) pair = true;
          if (!ep.confirm && pair) { ep.confirm = true; topUp = Math.max(0, 20 - (ep.sold + want)); }
          // caps: episode 35%, rolling 10-session S2+S3 35%, core floor 25%
          const roll = s2Sales.filter(s => i - s.i < 10).reduce((a, s) => a + s.pct, 0);
          const allowed = Math.max(0, Math.min(35 - ep.sold, 35 - roll, held - 25));
          const pct = Math.min(want + topUp, allowed);
          const note = sig.map(s => s.note).join(' + ') + (topUp ? (" + Confirmation top-up to 20% (" + (topUp) + "%)") : '') +
            (pct < want + topUp ? (" (capped: " + (pct.toFixed(1)) + "%)") : '');
          held -= pct; ep.sold += pct; soldToday = pct;
          if (pct > 0) { ep.lastSaleI = i; ep.rsiDip = R[i] != null && R[i] < 45; s2Sales.push({ i, pct }); }
          if (pct > 0 && (topUp || sig.some(s => s.tier === 40))) ep.severe = { i, low: cl, flagged: false };
          log(i, 'S2', pct > 0 ? 'sell' : 'blocked', pct, note);
        }
      }

      // ---- Mandatory System 4 review (new post-sale low within 10 sessions of severe event)
      if (ep && ep.severe && !soldToday) {
        const sv = ep.severe;
        if (i - sv.i <= 10 && cl < sv.low) {
          if (!sv.flagged) { sv.flagged = true; log(i, 'S4', 'review', 0, 'MANDATORY System 4 review: new post-sale low within 10 sessions of severe event'); }
          sv.low = cl;
        } else if (cl < sv.low) sv.low = cl;
      }

      // ---- Re-entry
      if (ep && ep.sold > 0 && !soldToday && ep.reentries < 1 &&
          reentries.filter(x => i - x < 126).length < 2 && i >= 5) {
        const c1 = ep.rsiDip && R[i] > R[i - 1];
        const c2 = cl > s50 && c[i - 1] > sma50[i - 1] && (v[i] > avgVol[i] || v[i - 1] > avgVol[i - 1]);
        const c3 = sma50[i - 5] != null && s50 >= sma50[i - 5];
        if (c1 && c2 && c3 && cfg.fundamentalsOk) {
          const buy = Math.min(ep.sold, 100 - held);
          held += buy; reentries.push(i);
          log(i, 'RE', 'buy', -buy, ("Re-entry: buy back " + (buy.toFixed(1)) + "% S0 (episode closed)"));
          ep = null;
        }
      }

      // ---- System 1 Profit Ladder
      if (!dormant && cl <= 0.65 * A1) { dormant = true; log(i, 'S1', 'info', 0, ("Ladder dormant (close ≤ 65% of A1 \u0024" + (A1.toFixed(2)) + ")")); }
      else if (dormant && cl > s50) { A1 = cl; k = 1; dormant = false; log(i, 'S1', 'info', 0, ("Deep-drawdown re-base: A1 = \u0024" + (cl.toFixed(2)) + ", k = 1")); }
      else if (!dormant && !ep && !soldToday) {
        const pe = cfg.fwdEps > 0 ? cl / cfg.fwdEps : null;
        const accel = pe != null && pe >= cfg.peCompress; const step = accel ? 0.08 : 0.15;
        const q = quarterKey(bars[i].d);
        if (pe != null && pe >= cfg.peSell && lastPeQuarter !== q) {
          const pct = Math.max(0, Math.min(10, held - 50)); held -= pct; lastPeQuarter = q;
          log(i, 'S1', pct ? 'sell' : 'blocked', pct, ("Valuation: forward P/E " + (pe.toFixed(1)) + "× ≥ " + (cfg.peSell) + "× → 10% S0, re-anchor A1"));
          A1 = cl; k = 1;
        } else if (cl >= A1 * Math.pow(1 + step, k)) {
          const ext = cl / s50 - 1;
          let pct = accel ? 8 : ext <= 0.25 ? 8 : ext <= 0.5 ? 5 : 3;
          pct = Math.max(0, Math.min(pct, held - 50));
          const kFrom = k; while (cl >= A1 * Math.pow(1 + step, k)) k++;
          held -= pct;
          log(i, 'S1', pct ? 'sell' : 'blocked', pct, ("Ladder rung k=" + (kFrom) + (k - 1 > kFrom ? '–' + (k - 1) : '') + " (\u0024" + ((A1 * Math.pow(1 + step, kFrom)).toFixed(2)) + "), ext " + ((ext * 100).toFixed(0)) + "% over 50-SMA" + (accel ? ', accelerator ON' : '') + (pct ? '' : ' (50% floor)')));
        }
      }
      heldS[i] = held; a1S[i] = A1;
      const pe = cfg.fwdEps > 0 ? cl / cfg.fwdEps : 0;
      rungS[i] = dormant ? null : A1 * Math.pow(1 + (pe >= cfg.peCompress ? 0.08 : 0.15), k);
    }
    const peNow = cfg.fwdEps > 0 ? c[n - 1] / cfg.fwdEps : null;
    return { start, events, heldS, a1S, rungS, held, A1, k, dormant, ep, reentries, s2Sales,
      step: peNow != null && peNow >= cfg.peCompress ? 0.08 : 0.15, lastPeQuarter };
  }

  /* Current-state trigger evaluation for the latest close */
  function evaluate(bars, ind, sim, cfg) {
    const n = bars.length, i = n - 1, cl = ind.c[i];
    const s20 = ind.sma20[i], s50 = ind.sma50[i], R = ind.rsi[i], Rp = ind.rsi[i - 1];
    const ep = sim ? sim.ep : null;
    const rows = [];
    const add = (sys, rule, reading, threshold, status, action) => rows.push({ sys, rule, reading, threshold, status, action });
    const usd = x => x == null || !isFinite(x) ? '—' : '\u0024' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = x => x == null || !isFinite(x) ? '—' : (x * 100).toFixed(1) + '%';
    let belowCnt = 0; for (let j = i; j >= 0 && ind.sma50[j] != null && ind.c[j] < ind.sma50[j]; j--) belowCnt++;
    let below20 = 0; for (let j = i; j >= 0 && ind.sma20[j] != null && ind.c[j] < ind.sma20[j]; j--) below20++;
    let aboveCnt = 0; for (let j = i; j >= 0 && ind.sma50[j] != null && ind.c[j] > ind.sma50[j]; j--) aboveCnt++;
    const aboveVol = ind.v[i] > ind.avgVol[i];
    const slopeUp = ind.sma50[i - 5] != null && s50 >= ind.sma50[i - 5];
    const pe = cfg.fwdEps > 0 ? cl / cfg.fwdEps : null;
    const firedToday = sim ? sim.events.filter(e => e.i === i) : [];
    const firedSys = s => firedToday.some(e => e.sys === s && (e.type === 'sell' || e.type === 'buy' || e.type === 'review'));

    // ---------- System 1
    if (sim) {
      const rung = sim.A1 * Math.pow(1 + sim.step, sim.k);
      add('S1', 'Next ladder rung', ("Close " + (usd(cl))), ("Rung k=" + (sim.k) + ": " + (usd(rung)) + " (A1 " + (usd(sim.A1)) + ", step " + ((sim.step * 100).toFixed(0)) + "%)"),
        firedSys('S1') ? 'FIRED' : sim.dormant ? 'DORMANT' : ep ? 'PAUSED' : cl >= rung * 0.95 ? 'NEAR' : 'OK',
        sim.dormant ? 'Ladder dormant: re-base on first close above 50-SMA' : ep ? 'Paused while a System 2 episode is open' : ("Needs +" + (pct(rung / cl - 1)) + " to fire"));
      add('S1', 'Deep-drawdown re-base', ("Close " + (usd(cl)) + " vs 65% A1 " + (usd(0.65 * sim.A1))), sim.dormant ? ("Re-base trigger: close > 50-SMA " + (usd(s50))) : 'Close ≤ 65% of A1 → dormant',
        sim.dormant ? 'DORMANT' : 'OK', sim.dormant ? ("Re-base A1 when close > " + (usd(s50))) : '—');
    }
    add('S1', 'Valuation Accelerator (fwd P/E)', pe ? pe.toFixed(1) + '×' : 'Set forward EPS', ("≥ " + (cfg.peCompress) + "× compress · ≥ " + (cfg.peSell) + "× sell 10%/qtr"),
      pe == null ? 'N/A' : pe >= cfg.peSell ? 'TRIGGERED' : pe >= cfg.peCompress ? 'ACTIVE' : 'OK',
      pe == null ? '—' : ("P/E " + (cfg.peCompress) + "× at " + (usd(cfg.fwdEps * cfg.peCompress)) + " · " + (cfg.peSell) + "× at " + (usd(cfg.fwdEps * cfg.peSell))));

    // ---------- System 2 early warnings
    add('S2', 'Early warning: below 20-SMA 2+ sessions', ("" + (below20) + " session(s) below " + (usd(s20))), '≥ 2 sessions', below20 >= 2 ? 'WARN' : 'OK', below20 >= 2 ? 'Tighten monitoring' : '—');
    add('S2', 'Early warning: RSI(14) > 70', R != null ? R.toFixed(1) : '—', '> 70', R > 70 ? 'WARN' : 'OK', R > 70 ? 'Overbought — do not add' : '—');
    // Trend
    const t1Now = belowCnt >= 2 && aboveVol && ind.v[i - 1] > ind.avgVol[i - 1];
    const t1Supp = R != null && R < 35;
    const trendFired = ep && ep.fam.trend != null;
    add('S2', 'Trend T1 / T2', ("" + (belowCnt) + " close(s) below 50-SMA " + (usd(s50)) + "; vol " + ((ind.v[i] / ind.avgVol[i]).toFixed(2)) + "× avg"),
      'T1: 2 closes below + above-avg vol · T2: 5 closes below',
      trendFired ? (ep.fam.trend === i ? 'FIRED' : 'USED') : (belowCnt >= 5 ? 'TRIGGER' : t1Now && !t1Supp ? 'TRIGGER' : t1Supp && belowCnt >= 2 ? 'T1 SUPPRESSED' : belowCnt > 0 ? 'ARMED' : 'OK'),
      trendFired ? ("Fired " + (bars[ep.fam.trend].d) + " (once per episode)") : ("Sell 5% S0 · T2 needs " + (Math.max(0, 5 - belowCnt)) + " more close(s) below"));
    // Momentum
    const wl = ind.weeks.length - 1; const wm = ind.wMacd[wl], ws = ind.wSig[wl];
    const lastCross = (() => { for (let j = i; j >= 0; j--) if (ind.macdCrossDown[j]) return bars[j].d; return null; })();
    const momFired = ep && ep.fam.mom != null;
    add('S2', 'Momentum: weekly MACD', wm != null ? ("MACD " + (wm.toFixed(2)) + " vs signal " + (ws.toFixed(2)) + (ind.weeks[wl].complete ? '' : ' (week in progress)')) : 'Insufficient weekly history (~35 weeks)',
      'MACD crosses below signal at weekly close',
      wm == null ? 'N/A' : momFired ? (ep.fam.mom === i ? 'FIRED' : 'USED') : ind.macdCrossDown[i] ? 'TRIGGER' : wm < ws ? 'BELOW' : 'OK',
      momFired ? ("Fired " + (bars[ep.fam.mom].d)) : ("Last confirmed cross-down: " + (lastCross || 'none')));
    // Magnitude tiers
    for (const t of [20, 30, 40]) {
      const lvl = ind.p2[i] * (1 - t / 100); const done = ep && ep.tiers[t];
      add('S2', ("Magnitude −" + (t) + "%"), ("Drawdown " + (pct(ind.dd[i])) + " from P2 " + (usd(ind.p2[i])) + " (" + (ind.p2Date[i]) + ")"), ("Close < 50-SMA and ≤ " + (usd(lvl))),
        done ? (ep.fam.mag === i ? 'FIRED' : 'USED') : (cl < s50 && ind.dd[i] >= t / 100) ? 'TRIGGER' : ind.dd[i] >= t / 100 - 0.05 ? 'NEAR' : 'OK',
        done ? 'Tier used this episode' : 'Sell 5% S0');
    }
    if (sim) {
      add('S2', 'Confirmation top-up', ep ? ("Families fired: " + (Object.entries(ep.fam).filter(([, x]) => x != null).map(([f, x]) => FAM[f] + ' ' + bars[x].d).join(', ') || 'none')) : 'No open episode',
        '2 different families within 15 sessions', ep && ep.confirm ? 'USED' : 'OK', 'Top up episode total to 20% S0');
      add('S2', 'Episode cap / core floor', ep ? ("Episode sold " + (ep.sold.toFixed(1)) + "% S0 · held " + (sim.held.toFixed(1)) + "% S0") : ("No open episode · held " + (sim.held.toFixed(1)) + "% S0"),
        'Episode ≤ 35% S0 · S1–3 floor 25% S0', ep && ep.sold >= 35 ? 'CAP HIT' : 'OK', ep ? ("Room left: " + (Math.max(0, Math.min(35 - ep.sold, sim.held - 25)).toFixed(1)) + "% S0") : '—');
      const rv = ep && ep.severe;
      add('S4', 'Mandatory System 4 review', rv ? ("Severe event " + (bars[rv.i].d) + " at " + (usd(ind.c[rv.i])) + "; lowest since " + (usd(rv.low))) : 'No severe event in open episode',
        'New post-sale low within 10 sessions', rv && rv.flagged ? 'REVIEW' : rv && i - rv.i <= 10 ? 'WATCH' : 'OK',
        rv && i - rv.i <= 10 ? ("Window ends after " + (10 - (i - rv.i)) + " more session(s); trigger close < " + (usd(rv.low))) : '—');
      // Re-entry
      if (ep && ep.sold > 0) {
        const c1 = ep.rsiDip && R > Rp, c2 = cl > s50 && ind.c[i - 1] > ind.sma50[i - 1] && (aboveVol || ind.v[i - 1] > ind.avgVol[i - 1]);
        add('RE', 'RSI dipped < 45 since sale, now turning up', ("RSI " + (R?.toFixed(1)) + " (prev " + (Rp?.toFixed(1)) + "); dipped: " + (ep.rsiDip ? 'yes' : 'no')), 'Dip < 45 then up', c1 ? 'MET' : 'NOT MET', '');
        add('RE', '2 closes above 50-SMA, one on above-avg vol', ("" + (aboveCnt) + " close(s) above " + (usd(s50))), '≥ 2', c2 ? 'MET' : 'NOT MET', '');
        add('RE', '50-SMA not falling', ("" + (usd(s50)) + " vs 5 sessions ago " + (usd(ind.sma50[i - 5]))), 'today ≥ 5 sessions ago', slopeUp ? 'MET' : 'NOT MET', '');
        add('RE', 'Fundamental check / window / no lockout', cfg.fundamentalsOk ? 'Marked OK in settings' : 'Not confirmed', 'Manual', cfg.fundamentalsOk ? 'MET' : 'NOT MET',
          (c1 && c2 && slopeUp && cfg.fundamentalsOk) ? ("RE-ENTRY: buy back up to " + (ep.sold.toFixed(1)) + "% S0") : 'All conditions needed on the same close');
      } else add('RE', 'Re-entry', 'No System 2 sale in an open episode', '—', 'N/A', '—');
    }
    // key levels
    const levels = [
      { k: '50-SMA (Trend / re-entry line)', v: s50 }, { k: '20-SMA (early warning)', v: s20 },
      { k: 'Magnitude −20% (P2 × 0.80)', v: ind.p2[i] * 0.8 }, { k: 'Magnitude −30% (P2 × 0.70)', v: ind.p2[i] * 0.7 },
      { k: 'Magnitude −40% (P2 × 0.60)', v: ind.p2[i] * 0.6 },
    ];
    if (sim) { levels.push({ k: ("Next ladder rung (k=" + (sim.k) + ")"), v: sim.A1 * Math.pow(1 + sim.step, sim.k) }, { k: 'Ladder dormant (65% × A1)', v: 0.65 * sim.A1 }); }
    if (cfg.fwdEps > 0) levels.push({ k: ("Fwd P/E " + (cfg.peCompress) + "× (accelerator)"), v: cfg.fwdEps * cfg.peCompress }, { k: ("Fwd P/E " + (cfg.peSell) + "× (sell 10%)"), v: cfg.fwdEps * cfg.peSell });
    levels.forEach(l => l.dist = l.v / cl - 1);
    levels.sort((a, b) => b.v - a.v);
    return { rows, levels, belowCnt, aboveCnt, pe, firedToday };
  }

  function system3(x) {
    const f = k => x[k] === '' || x[k] == null ? null : +x[k];
    const ra = f('revAct'), rc = f('revCons'), ea = f('epsAct'), ec = f('epsCons'), gm = f('guideMid'), gc = f('guideCons');
    if ([ra, rc, ea, ec, gm, gc].some(v => v == null || isNaN(v)) || !rc || !ec || !gc) return null;
    const miss = ra < rc * 0.98 || ea < ec - Math.abs(ec) * 0.02;
    const beat = ra > rc && ea > ec;
    const result = miss ? 'Miss' : beat ? 'Beat' : 'In-line';
    const gd = gm / gc - 1; const guide = gd > 0.02 ? 'Raised' : gd < -0.02 ? 'Cut' : 'Maintained';
    const M = { Raised: { Beat: 'Hold + reset', 'In-line': 'Hold', Miss: 'Sell 5% S0' },
      Maintained: { Beat: 'Sell 5% S0', 'In-line': 'Sell 5% S0', Miss: 'Sell 15% S0' },
      Cut: { Beat: 'Sell 10% S0 + System 4 review', 'In-line': 'Sell 15% S0 + System 4 review', Miss: 'Sell 25% S0 + System 4 review (overrides cap)' } };
    return { result, guide, action: M[guide][result], M, revSurp: ra / rc - 1, epsSurp: ea / ec - 1, guideDiff: gd };
  }

  return { computeIndicators, simulate, evaluate, system3, sma, ema, rsi };
})();

if (typeof module !== 'undefined') module.exports = Engine;

/* =========================================================================
 * 2. UI
 * ========================================================================= */
if (typeof document !== 'undefined') (() => {
  const LS = 'stxfw.rev10.cfg';
  const DEFAULTS = {
    dataUrl: 'data/stx.json', symbol: 'STX', startDate: '2026-07-30', s0: 1000, a1Override: '',
    fwdEps: 36.34, peCompress: 30, peSell: 40, earningsDate: '2026-10-27', fundamentalsOk: true,
    twelveKey: '', range: 'START',
    sharesHeld: '', unvested: '', netWorth: '', targetPct: 15, quartersLeft: 8, soldThisQtr: '',
    revAct: '', revCons: '', epsAct: '', epsCons: '', guideMid: '', guideCons: '',
    ssdGap: '', s4: {}, cat3Now: {}, cat3Prev: false,
  };
  let cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS) || '{}'));
  const save = () => localStorage.setItem(LS, JSON.stringify(cfg));
  let DATA = null, IND = null, SIM = null, EVAL = null; const charts = {};
  const byId = id => document.getElementById(id);
  const money = x => x == null || !isFinite(x) ? '—' : '\u0024' + (+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctf = (x, d = 1) => x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%';
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&', '<': '<', '>': '>', '"': '"' }[ch]));

  const STATUS_CLASS = {
    FIRED: 'bad', TRIGGER: 'bad', TRIGGERED: 'bad', REVIEW: 'bad', 'CAP HIT': 'bad',
    NEAR: 'warn', WARN: 'warn', ARMED: 'warn', ACTIVE: 'warn', BELOW: 'warn', WATCH: 'warn', 'T1 SUPPRESSED': 'info', PAUSED: 'info', DORMANT: 'info', USED: 'muted',
    OK: 'ok', MET: 'ok', 'NOT MET': 'muted', 'N/A': 'muted',
  };
  const badge = s => ("<span class=\"badge " + (STATUS_CLASS[s] || 'muted') + "\">" + (esc(s)) + "</span>");

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === t.dataset.panel));
    if (t.dataset.panel === 'p-charts') renderCharts();
  }));

  /* ---------- inputs bound to cfg ---------- */
  function bindInputs() {
    document.querySelectorAll('[data-cfg]').forEach(el => {
      const k = el.dataset.cfg;
      if (el.type === 'checkbox') el.checked = !!cfg[k]; else el.value = cfg[k] ?? '';
      el.addEventListener('change', () => {
        cfg[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' && el.value !== '' ? +el.value : el.value);
        save();
        if (['startDate', 'a1Override', 'fwdEps', 'peCompress', 'peSell', 'fundamentalsOk'].includes(k)) recompute();
        else renderSide();
      });
    });
    document.querySelectorAll('[data-s4]').forEach(el => {
      el.checked = !!cfg.s4[el.dataset.s4];
      el.addEventListener('change', () => { cfg.s4[el.dataset.s4] = el.checked; save(); renderS4(); });
    });
    document.querySelectorAll('[data-c3]').forEach(el => {
      el.checked = !!cfg.cat3Now[el.dataset.c3];
      el.addEventListener('change', () => { cfg.cat3Now[el.dataset.c3] = el.checked; save(); renderS4(); });
    });
  }

  /* ---------- data loading ---------- */
  function setStatus(msg, cls = '') { const s = byId('status'); s.textContent = msg; s.className = 'status ' + cls; }

  async function loadRepoData() {
    try {
      setStatus('Loading ' + cfg.dataUrl + ' …');
      const r = await fetch(cfg.dataUrl + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      useData(j.bars, ("" + (j.source || 'repo') + " · updated " + (j.updated_utc || '?')));
    } catch (e) {
      setStatus('Could not load ' + cfg.dataUrl + ' (' + e.message + '). Run the GitHub Action, use Live fetch, or upload a CSV.', 'err');
    }
  }

  async function liveFetch() {
    if (!cfg.twelveKey) { setStatus('Enter a free Twelve Data API key in Settings to fetch from the browser.', 'err'); return; }
    try {
      setStatus('Fetching live daily bars from Twelve Data …');
      const u = ("https://api.twelvedata.com/time\_series?symbol=" + (encodeURIComponent(cfg.symbol)) + "&interval=1day&outputsize=2500&apikey=" + (encodeURIComponent(cfg.twelveKey)));
      const j = await (await fetch(u)).json();
      if (!j.values) throw new Error(j.message || 'no values');
      const bars = j.values.map(x => ({ d: x.datetime.slice(0, 10), o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume })).reverse();
      const merged = new Map((DATA || []).map(b => [b.d, b])); bars.forEach(b => merged.set(b.d, b));
      useData([...merged.values()].sort((a, b) => a.d < b.d ? -1 : 1), 'Twelve Data (browser) · ' + new Date().toLocaleString());
    } catch (e) { setStatus('Live fetch failed: ' + e.message, 'err'); }
  }

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/); const h = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/"/g, ''));
    const ix = n => h.findIndex(x => x === n || x.startsWith(n));
    const iD = ix('date'), iO = ix('open'), iH = ix('high'), iL = ix('low'), iC = h.indexOf('close') >= 0 ? h.indexOf('close') : ix('price'), iV = ix('vol');
    const num = s => +String(s || '').replace(/["\x24,]/g, '').replace(/([\d.]+)M(?![\s\S])/i, (m, a) => a * 1e6);
    return lines.slice(1).map(l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*(?![\s\S]))/)).filter(p => p.length > iC).map(p => {
      let d = p[iD].replace(/"/g, '').trim(); const dt = new Date(d); if (!/^\d{4}-\d{2}-\d{2}(?![\s\S])/.test(d) && !isNaN(dt)) d = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const c = num(p[iC]); return { d, o: iO >= 0 ? num(p[iO]) : c, h: iH >= 0 ? num(p[iH]) : c, l: iL >= 0 ? num(p[iL]) : c, c, v: iV >= 0 ? num(p[iV]) : 0 };
    }).filter(b => b.d && isFinite(b.c)).sort((a, b) => a.d < b.d ? -1 : 1);
  }

  function useData(bars, srcText) {
    DATA = bars.filter(b => b && isFinite(b.c));
    byId('src').textContent = srcText;
    recompute();
    setStatus(("Loaded " + (DATA.length) + " sessions · last close " + (DATA[DATA.length - 1].d)), 'ok');
  }

  function recompute() {
    if (!DATA || DATA.length < 60) return;
    IND = Engine.computeIndicators(DATA);
    SIM = Engine.simulate(DATA, IND, cfg);
    EVAL = Engine.evaluate(DATA, IND, SIM, cfg);
    renderDashboard(); renderLog(); renderSide();
    if (byId('p-charts').classList.contains('active')) renderCharts();
  }

  /* ---------- dashboard ---------- */
  function usDstOn(date) { // US DST: 2nd Sun Mar → 1st Sun Nov
    const y = date.getUTCFullYear();
    const nth = (m, wk) => { const d = new Date(Date.UTC(y, m, 1)); const off = (7 - d.getUTCDay()) % 7; return Date.UTC(y, m, 1 + off + 7 * (wk - 1)); };
    const t = date.getTime(); return t >= nth(2, 2) && t < nth(10, 1);
  }

  function renderDashboard() {
    const n = DATA.length, i = n - 1, b = DATA[i], prev = DATA[i - 1];
    const chg = b.c / prev.c - 1;
    const s = IND;
    const cards = [
      ['Close ' + b.d, money(b.c), ("<span class=\"" + (chg >= 0 ? 'up' : 'down') + "\">" + (chg >= 0 ? '▲' : '▼') + " " + (pctf(Math.abs(chg), 2)) + "</span>")],
      ['20-SMA', money(s.sma20[i]), b.c < s.sma20[i] ? '<span class="down">price below</span>' : '<span class="up">price above</span>'],
      ['50-SMA', money(s.sma50[i]), (s.sma50[i] >= s.sma50[i - 5] ? '<span class="up">rising/flat</span>' : '<span class="down">falling</span>') + (" · " + (pctf(b.c / s.sma50[i] - 1)) + " ext")],
      ['RSI(14)', s.rsi[i]?.toFixed(1), s.rsi[i] > 70 ? 'overbought' : s.rsi[i] < 35 ? 'oversold (T1 suppressed)' : 'neutral'],
      ['Drawdown from P2', pctf(-s.dd[i]), ("P2 " + (money(s.p2[i])) + " (" + (s.p2Date[i]) + ")")],
      ['Volume vs 50d avg', (s.v[i] / s.avgVol[i]).toFixed(2) + '×', (s.v[i] / 1e6).toFixed(2) + 'M vs ' + (s.avgVol[i] / 1e6).toFixed(2) + 'M'],
      ['Forward P/E', EVAL.pe ? EVAL.pe.toFixed(1) + '×' : '—', ("fwd EPS \u0024" + (cfg.fwdEps))],
      ['Position (per rules)', SIM ? SIM.held.toFixed(1) + '% S0' : '—', SIM ? ("" + (Math.round(SIM.held / 100 * cfg.s0)) + " of " + (cfg.s0) + " sh · " + (SIM.ep ? 'episode OPEN (' + SIM.ep.sold.toFixed(0) + '% used)' : 'no episode')) : 'start date after data'],
    ];
    byId('cards').innerHTML = cards.map(c => ("<div class=\"card\"><div class=\"k\">" + (c[0]) + "</div><div class=\"v\">" + (c[1]) + "</div><div class=\"s\">" + (c[2]) + "</div></div>")).join('');

    // action banner
    const today = EVAL.firedToday.filter(e => e.type !== 'info');
    const nextOpen = usDstOn(new Date()) ? '21:30 SGT' : '22:30 SGT';
    let html = '';
    if (today.length) html = today.map(e => ("<div class=\"alert bad\"><b>" + (e.sys) + " " + (e.type.toUpperCase()) + " on " + (e.d) + " close:</b> " + (esc(e.note)) + (e.pct > 0 ? (" → sell <b>" + (e.pct.toFixed(1)) + "% S0</b> (" + (Math.round(e.pct / 100 * cfg.s0)) + " sh). Next session: marketable limit at <b>" + (money(e.limit)) + "</b> (close − 3%); if unfilled by 10:30 ET convert to MOC. US open " + (nextOpen) + ".") : '') + (e.pct < 0 ? (" → buy back " + ((-e.pct).toFixed(1)) + "% S0 (" + (Math.round(-e.pct / 100 * cfg.s0)) + " sh)") : '') + "</div>")).join('');
    else html = ("<div class=\"alert ok\">No System 1/2/re-entry trigger on the " + (b.d) + " close (per rules as simulated from " + (cfg.startDate) + ").</div>");
    const ed = new Date(cfg.earningsDate + 'T00:00:00Z'); const days = Math.ceil((ed - Date.now()) / 864e5);
    if (cfg.earningsDate && days >= -1 && days <= 30) html += ("<div class=\"alert warn\"><b>Earnings " + (cfg.earningsDate) + "</b> (" + (days >= 0 ? 'in ' + days + ' day(s)' : 'just reported') + ") → System 3 event. Check blackout / pre-clearance before any trade.</div>");
    const wk = IND.weeks[IND.weeks.length - 1];
    if (!wk.complete) html += ("<div class=\"alert info\">Weekly MACD for the week of " + (wk.key) + " is not confirmed until the weekly close.</div>");
    byId('banner').innerHTML = html;

    // trigger table
    const sysName = { S1: '1 · Profit Ladder', S2: '2 · Protection Floor', S4: '4 · Full Exit', RE: 'Re-entry' };
    byId('trig').innerHTML = ("<thead><tr><th>System</th><th>Rule</th><th>Current reading</th><th>Threshold</th><th>Status</th><th>Action / note</th></tr></thead><tbody>") +
      EVAL.rows.map(r => ("<tr><td class=\"sys s-" + (r.sys) + "\">" + (sysName[r.sys]) + "</td><td>" + (esc(r.rule)) + "</td><td>" + (esc(r.reading)) + "</td><td>" + (esc(r.threshold)) + "</td><td>" + (badge(r.status)) + "</td><td>" + (esc(r.action)) + "</td></tr>")).join('') + '</tbody>';

    // levels ladder
    byId('levels').innerHTML = ("<thead><tr><th>Level</th><th>Price</th><th>vs close</th></tr></thead><tbody>") +
      [...EVAL.levels, { k: '◆ Last close', v: b.c, dist: 0, cur: true }].sort((a, c) => c.v - a.v)
        .map(l => ("<tr class=\"" + (l.cur ? 'cur' : '') + "\"><td>" + (esc(l.k)) + "</td><td>" + (money(l.v)) + "</td><td class=\"" + (l.dist >= 0 ? 'up' : 'down') + "\">" + (l.cur ? '' : (l.dist >= 0 ? '+' : '') + pctf(l.dist)) + "</td></tr>")).join('') + '</tbody>';
  }

  function renderLog() {
    if (!SIM) { byId('log').innerHTML = '<tr><td>Start date is outside the data range.</td></tr>'; return; }
    byId('log').innerHTML = ("<thead><tr><th>Decision close</th><th>System</th><th>Type</th><th>Close</th><th>% S0</th><th>Shares</th><th>Fill (next open)</th><th>Held after</th><th>Detail</th></tr></thead><tbody>") +
      SIM.events.slice().reverse().map(e => ("<tr><td>" + (e.d) + "</td><td class=\"sys s-" + (e.sys) + "\">" + (e.sys) + "</td><td><span class=\"badge " + ({ sell: 'bad', buy: 'ok', review: 'bad', blocked: 'warn' }[e.type] || 'muted') + "\">" + (e.type.toUpperCase()) + "</span></td><td>" + (money(e.close)) + "</td><td>" + (e.pct ? (e.pct > 0 ? '−' : '+') + Math.abs(e.pct).toFixed(1) + '%' : '') + "</td><td>" + (e.pct ? Math.round(Math.abs(e.pct) / 100 * cfg.s0) : '') + "</td><td>" + (e.pct ? (e.execPx ? money(e.execPx) + ' (' + e.execD + ')' : 'pending') : '') + "</td><td>" + (e.held.toFixed(1)) + "%</td><td>" + (esc(e.note)) + "</td></tr>")).join('') + '</tbody>';
    const sells = SIM.events.filter(e => e.pct > 0), buys = SIM.events.filter(e => e.pct < 0);
    const i = DATA.length - 1, s0 = SIM.start;
    const valRules = SIM.held / 100 * DATA[i].c + sells.reduce((a, e) => a + e.pct / 100 * (e.execPx || DATA[i].c), 0) - buys.reduce((a, e) => a + (-e.pct) / 100 * (e.execPx || DATA[i].c), 0);
    byId('logsum').innerHTML = ("From <b>" + (DATA[s0].d) + "</b> (close " + (money(DATA[s0].c)) + ", A1 at start " + (money(SIM.a1S[s0])) + "): " + (sells.length) + " sale(s), " + (buys.length) + " buy-back(s). Held now <b>" + (SIM.held.toFixed(1)) + "% S0</b>. Value per 1 share of S0: rules " + (money(valRules)) + " vs buy-and-hold " + (money(DATA[i].c)) + " (" + (pctf(valRules / DATA[i].c - 1)) + "). No fees/taxes; cash at 0%.");
  }

  /* ---------- System 0 / 3 / 4 side panels ---------- */
  function renderSide() { renderS0(); renderS3(); renderS4(); }

  function renderS0() {
    const px = DATA ? DATA[DATA.length - 1].c : null; const out = byId('s0out');
    const held = +cfg.sharesHeld, unv = +cfg.unvested || 0, nw = +cfg.netWorth;
    if (!px || !held || !nw) { out.innerHTML = '<p class="muted">Enter shares held and investable net worth. Values stay in this browser only (localStorage) — nothing is uploaded.</p>'; return; }
    const expV = (held + unv) * px, expP = expV / nw, tgt = cfg.targetPct / 100;
    const excessSh = Math.max(0, (expV - tgt * nw) / px), q = Math.max(1, +cfg.quartersLeft || 8);
    const tranche = excessSh / q, credit = +cfg.soldThisQtr || 0;
    const maxSh = tgt * nw / px - unv;
    out.innerHTML = ("<table class=\"kv\">\n      <tr><td>Exposure (held + unvested) at " + (money(px)) + "</td><td><b>" + (money(expV)) + "</b></td></tr>\n      <tr><td>Exposure ÷ investable net worth</td><td><b class=\"" + (expP > tgt ? 'down' : 'up') + "\">" + (pctf(expP)) + "</b> vs target " + (pctf(tgt)) + " " + (badge(expP > tgt ? 'ARMED' : 'OK')) + "</td></tr>\n      <tr><td>Excess above target</td><td>" + (Math.round(excessSh).toLocaleString()) + " shares (" + (money(excessSh * px)) + ")</td></tr>\n      <tr><td>Glide tranche (excess ÷ " + (q) + " quarters)</td><td><b>" + (Math.round(tranche).toLocaleString()) + " shares</b> this quarter</td></tr>\n      <tr><td>Less S1–3 sales already this quarter</td><td>" + (credit.toLocaleString()) + " → <b>" + (Math.max(0, Math.round(tranche - credit)).toLocaleString()) + " shares</b> to sell in first week of open window</td></tr>\n      <tr><td>Re-entry ceiling (max owned shares at target)</td><td>" + (Math.max(0, Math.floor(maxSh)).toLocaleString()) + " shares</td></tr></table>");
  }

  function renderS3() {
    const r = Engine.system3(cfg); const out = byId('s3out');
    if (!r) { out.innerHTML = '<p class="muted">Enter reported and consensus revenue, non-GAAP EPS and next-quarter guidance midpoint vs consensus.</p>' + matrix(null); return; }
    out.innerHTML = ("<table class=\"kv\"><tr><td>Revenue surprise</td><td>" + (pctf(r.revSurp, 2)) + "</td></tr><tr><td>EPS surprise</td><td>" + (pctf(r.epsSurp, 2)) + "</td></tr>\n      <tr><td>Result</td><td><b>" + (r.result) + "</b></td></tr><tr><td>Guidance midpoint vs consensus</td><td>" + (pctf(r.guideDiff, 2)) + " → <b>" + (r.guide) + "</b></td></tr>\n      <tr><td>Action</td><td>" + (badge(r.action.startsWith('Hold') ? 'OK' : 'TRIGGER')) + " <b>" + (r.action) + "</b></td></tr></table>\n      " + (r.action === 'Hold + reset' && SIM ? ("<p class=\"note\">Reset: if the post-earnings close is above A1 (" + (money(SIM.A1)) + "), re-anchor A1 there and restart k; close any open System 2 episode. P2 unchanged.</p>") : '') + "\n      " + (r.action.startsWith('Sell') ? '<p class="note">No re-entry before the next earnings release after a System 3 sale.</p>' : '')) + matrix(r);
  }
  function matrix(r) {
    const M = { Raised: ['Hold + reset', 'Hold', 'Sell 5% S0'], Maintained: ['Sell 5% S0', 'Sell 5% S0', 'Sell 15% S0'], Cut: ['Sell 10% + S4 review', 'Sell 15% + S4 review', 'Sell 25% + S4 review'] };
    const cols = ['Beat', 'In-line', 'Miss'];
    return ("<table class=\"matrix\"><tr><th>Guidance ↓ / Result →</th>" + (cols.map(c => ("<th>" + (c) + "</th>")).join('')) + "</tr>") +
      Object.entries(M).map(([g, a]) => ("<tr><th>" + (g) + "</th>" + (a.map((x, j) => ("<td class=\"" + (r && r.guide === g && r.result === cols[j] ? 'hit' : '') + "\">" + (x) + "</td>")).join('')) + "</tr>")).join('') + '</table>';
  }

  function renderS4() {
    const out = byId('s4out'); const g = +cfg.ssdGap; const msgs = [];
    if (g) msgs.push(g > 4 ? ['OK', ("SSD/HDD gap " + (g) + "× → thesis intact")] : g > 3 ? ['WATCH', ("Gap " + (g) + "× → review at every earnings")] : g > 2 ? ['TRIGGER', ("Gap " + (g) + "× (amber) → sell 15% S0 once; re-entry blocked")] : ['TRIGGER', ("Gap " + (g) + "× → FULL EXIT")]);
    const c1 = Object.entries(cfg.s4).filter(([k, v]) => v && k.startsWith('c1')).length, c2 = Object.entries(cfg.s4).filter(([k, v]) => v && k.startsWith('c2')).length;
    if (c1) msgs.push(['TRIGGER', ("Category 1 event(s) ticked: " + (c1) + " → FULL EXIT, next open window")]);
    if (c2) msgs.push(['TRIGGER', ("Category 2 event(s) ticked: " + (c2) + " → FULL EXIT, next open window")]);
    const c3 = Object.values(cfg.cat3Now).filter(Boolean).length;
    if (c3) msgs.push(['TRIGGER', cfg.cat3Prev ? 'Category 3 SECOND confirmation → sell the rest' : 'Category 3 FIRST confirmation → sell 50% of current holding']);
    else if (cfg.cat3Prev) msgs.push(['OK', 'Category 3: clean report resets the count']);
    if (SIM && SIM.ep && SIM.ep.severe && SIM.ep.severe.flagged) msgs.push(['REVIEW', 'Mandatory System 4 review flagged by the price rules (see Dashboard)']);
    out.innerHTML = msgs.length ? msgs.map(([s, m]) => ("<div class=\"row\">" + (badge(s)) + " " + (esc(m)) + "</div>")).join('') : ("<div class=\"row\">" + (badge('OK')) + " No System 4 trigger ticked.</div>");
  }

  /* ---------- charts ---------- */
  function rangeStart() {
    const n = DATA.length; const r = cfg.range;
    const m = { '3M': 63, '6M': 126, '1Y': 252, '2Y': 504, '5Y': 1260 };
    if (r === 'ALL') return 0; if (r === 'START' && SIM) return Math.max(0, SIM.start - 40);
    return Math.max(0, n - (m[r] || 252));
  }
  function mk(id, config) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(byId(id), config); }
  const C = { close: '#e6edf3', s20: '#58a6ff', s50: '#f0883e', t20: '#d29922', t30: '#f85149', t40: '#da3633', rung: '#3fb950', grid: 'rgba(255,255,255,.06)', text: '#8b949e' };
  function baseOpts(extra = {}) {
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: C.text, boxWidth: 12, usePointStyle: true } },
        tooltip: { filter: it => it.raw != null, callbacks: { afterBody: items => { const nts = items.map(it => it.dataset.notes && it.dataset.notes[it.dataIndex]).filter(Boolean); return nts.length ? nts : ''; } } } },
      scales: { x: { ticks: { color: C.text, maxTicksLimit: 10, maxRotation: 0 }, grid: { color: C.grid } }, y: { ticks: { color: C.text }, grid: { color: C.grid } } },
    }, extra);
  }
  const line = (label, data, color, o = {}) => Object.assign({ type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0 }, o);
  const markers = (label, from, sel, color, style, rot, cnt) => {
    const data = new Array(cnt).fill(null), notes = new Array(cnt).fill(null);
    (SIM ? SIM.events : []).filter(sel).forEach(e => { const j = e.i - from; if (j >= 0 && j < cnt) { data[j] = e.close; notes[j] = (notes[j] ? notes[j] + ' | ' : '') + ("" + (e.sys) + ": " + (e.note)); } });
    return { type: 'line', label, data, notes, showLine: false, pointStyle: style, pointRotation: rot, pointRadius: 8, pointHoverRadius: 10, borderColor: color, backgroundColor: color };
  };

  function renderCharts() {
    if (!DATA || typeof Chart === 'undefined') return;
    const from = rangeStart(), n = DATA.length, cnt = n - from;
    const sl = a => a.slice(from); const labels = DATA.slice(from).map(b => b.d);
    const p2 = sl(IND.p2);
    mk('cPrice', { data: { labels, datasets: [
      line('Close', sl(IND.c), C.close, { borderWidth: 2 }),
      line('20-SMA', sl(IND.sma20), C.s20), line('50-SMA', sl(IND.sma50), C.s50),
      line('P2 −20%', p2.map(x => x * 0.8), C.t20, { borderDash: [4, 4], borderWidth: 1 }),
      line('P2 −30%', p2.map(x => x * 0.7), C.t30, { borderDash: [6, 4], borderWidth: 1 }),
      line('P2 −40%', p2.map(x => x * 0.6), C.t40, { borderDash: [2, 3], borderWidth: 1 }),
      line('Next ladder rung', SIM ? sl(SIM.rungS) : [], C.rung, { borderDash: [8, 4], borderWidth: 1, stepped: true, hidden: false }),
      markers('S2 sell', from, e => e.sys === 'S2' && e.type === 'sell', '#f85149', 'triangle', 180, cnt),
      markers('S1 sell', from, e => e.sys === 'S1' && e.type === 'sell', '#3fb950', 'triangle', 180, cnt),
      markers('Re-entry', from, e => e.sys === 'RE', '#58a6ff', 'triangle', 0, cnt),
      markers('S4 review', from, e => e.sys === 'S4', '#d2a8ff', 'star', 0, cnt),
      markers('Info', from, e => e.type === 'info' || e.type === 'blocked', '#8b949e', 'circle', 0, cnt),
    ] }, options: baseOpts({ scales: { x: baseOpts().scales.x, y: { type: cfg.logScale ? 'logarithmic' : 'linear', ticks: { color: C.text }, grid: { color: C.grid } } } }) });

    mk('cRsi', { data: { labels, datasets: [line('RSI(14)', sl(IND.rsi), '#d2a8ff', { borderWidth: 2 }),
      line('70 overbought', labels.map(() => 70), '#f85149', { borderDash: [4, 4], borderWidth: 1 }),
      line('45 re-entry', labels.map(() => 45), '#58a6ff', { borderDash: [4, 4], borderWidth: 1 }),
      line('35 T1 suppress', labels.map(() => 35), '#3fb950', { borderDash: [4, 4], borderWidth: 1 })] },
      options: baseOpts({ scales: { x: baseOpts().scales.x, y: { min: 0, max: 100, ticks: { color: C.text }, grid: { color: C.grid } } } }) });

    mk('cDd', { data: { labels, datasets: [line('Drawdown from P2 %', sl(IND.dd).map(x => -x * 100), '#f0883e', { borderWidth: 2, fill: { target: 'origin', above: 'rgba(0,0,0,0)', below: 'rgba(240,136,62,.12)' } }),
      ...[20, 30, 40].map((t, j) => line(("−" + (t) + "% tier"), labels.map(() => -t), [C.t20, C.t30, C.t40][j], { borderDash: [4, 4], borderWidth: 1 }))] }, options: baseOpts() });

    mk('cVol', { data: { labels, datasets: [
      { type: 'bar', label: 'Volume (M)', data: sl(IND.v).map(x => x / 1e6), backgroundColor: sl(IND.v).map((x, j) => x > IND.avgVol[from + j] ? 'rgba(248,81,73,.7)' : 'rgba(139,148,158,.45)') },
      line('Avg prior 50 (M)', sl(IND.avgVol).map(x => x == null ? null : x / 1e6), '#58a6ff', { borderWidth: 2 })] }, options: baseOpts() });

    const wFrom = IND.weekOf[from]; const W = IND.weeks.slice(wFrom);
    const wl = W.map(w => w.d + (w.complete ? '' : ' *'));
    const wx = a => a.slice(wFrom);
    const cross = W.map(w => IND.macdCrossDown[w.last] ? IND.wMacd[IND.weeks.indexOf(w)] : null);
    mk('cMacd', { data: { labels: wl, datasets: [
      { type: 'bar', label: 'Histogram', data: wx(IND.wHist), backgroundColor: wx(IND.wHist).map(h => h >= 0 ? 'rgba(63,185,80,.6)' : 'rgba(248,81,73,.6)') },
      line('MACD', wx(IND.wMacd), '#58a6ff', { borderWidth: 2 }), line('Signal', wx(IND.wSig), '#f0883e', { borderWidth: 2 }),
      { type: 'line', label: 'Confirmed cross-down', data: cross, showLine: false, pointStyle: 'triangle', pointRotation: 180, pointRadius: 8, borderColor: '#f85149', backgroundColor: '#f85149' }] },
      options: baseOpts() });

    mk('cHeld', { data: { labels, datasets: [line('Held % of S0 (per rules)', SIM ? sl(SIM.heldS) : [], '#3fb950', { borderWidth: 2, stepped: true, fill: { target: 'origin', above: 'rgba(63,185,80,.12)' } }),
      line('Core floor 25%', labels.map(() => 25), '#f85149', { borderDash: [4, 4], borderWidth: 1 }),
      line('S1 floor 50%', labels.map(() => 50), '#d29922', { borderDash: [4, 4], borderWidth: 1 })] },
      options: baseOpts({ scales: { x: baseOpts().scales.x, y: { min: 0, max: 105, ticks: { color: C.text }, grid: { color: C.grid } } } }) });
  }

  /* ---------- wire up ---------- */
  bindInputs();
  document.querySelectorAll('[data-range]').forEach(b => {
    b.classList.toggle('active', b.dataset.range === cfg.range);
    b.addEventListener('click', () => { cfg.range = b.dataset.range; save(); document.querySelectorAll('[data-range]').forEach(x => x.classList.toggle('active', x === b)); renderCharts(); });
  });
  byId('logScale').addEventListener('change', e => { cfg.logScale = e.target.checked; renderCharts(); });
  byId('btnReload').addEventListener('click', loadRepoData);
  byId('btnLive').addEventListener('click', liveFetch);
  byId('csv').addEventListener('change', async e => { const f = e.target.files[0]; if (f) useData(parseCSV(await f.text()), 'CSV upload: ' + f.name); });
  byId('btnReset').addEventListener('click', () => { if (confirm('Reset all settings and inputs?')) { localStorage.removeItem(LS); location.reload(); } });
  renderSide();
  loadRepoData();
})();
