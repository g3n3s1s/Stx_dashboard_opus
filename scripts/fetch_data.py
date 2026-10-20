#!/usr/bin/env python3
"""Fetch daily OHLCV for a ticker and write data/<symbol>.json for the dashboard.

Standard library only (runs on GitHub Actions without pip install).
Primary source: Yahoo Finance chart API. Fallback: Stooq CSV.
Uses the raw daily CLOSE (split-adjusted, not dividend-adjusted), matching
the framework's "all signals use closing prices" rule.
"""
import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.request

SYMBOL = os.environ.get("SYMBOL", "STX").upper()
RANGE = os.environ.get("RANGE", "10y")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", f"{SYMBOL.lower()}.json")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
MIN_BARS = 300


def http_get(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def from_yahoo():
    bars = []
    for host in ("query1", "query2"):
        try:
            url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{SYMBOL}"
                   f"?range={RANGE}&interval=1d&includePrePost=false&events=div%2Csplit")
            js = json.loads(http_get(url))
            res = js["chart"]["result"][0]
            off = res["meta"].get("gmtoffset", 0)
            ts = res["timestamp"]
            q = res["indicators"]["quote"][0]
            for i, t in enumerate(ts):
                c = q["close"][i]
                if c is None:
                    continue
                d = dt.datetime.utcfromtimestamp(t + off).strftime("%Y-%m-%d")
                o, h, lo, v = q["open"][i], q["high"][i], q["low"][i], q["volume"][i]
                bars.append({"d": d,
                             "o": round(o if o is not None else c, 4),
                             "h": round(h if h is not None else c, 4),
                             "l": round(lo if lo is not None else c, 4),
                             "c": round(c, 4),
                             "v": int(v or 0)})
            if bars:
                return bars, f"Yahoo Finance ({host})"
        except Exception as e:  # noqa: BLE001
            print(f"[warn] Yahoo {host}: {e}", file=sys.stderr)
    return [], None


def from_stooq():
    try:
        text = http_get(f"https://stooq.com/q/d/l/?s={SYMBOL.lower()}.us&i=d")
        rows = list(csv.DictReader(io.StringIO(text)))
        bars = [{"d": r["Date"], "o": float(r["Open"]), "h": float(r["High"]),
                 "l": float(r["Low"]), "c": float(r["Close"]),
                 "v": int(float(r.get("Volume") or 0))} for r in rows if r.get("Close")]
        return bars, "Stooq"
    except Exception as e:  # noqa: BLE001
        print(f"[warn] Stooq: {e}", file=sys.stderr)
        return [], None


def main():
    bars, src = from_yahoo()
    if len(bars) < MIN_BARS:
        bars, src = from_stooq()
    if len(bars) < MIN_BARS:
        print("ERROR: no usable data source; existing file left unchanged.", file=sys.stderr)
        return 1
    # de-duplicate by date, keep last, sort ascending
    bars = sorted({b["d"]: b for b in bars}.values(), key=lambda b: b["d"])
    payload = {
        "symbol": SYMBOL,
        "source": src,
        "updated_utc": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_date": bars[-1]["d"],
        "bars": bars,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"Wrote {len(bars)} bars to {OUT} (last {bars[-1]['d']} close {bars[-1]['c']}) from {src}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
