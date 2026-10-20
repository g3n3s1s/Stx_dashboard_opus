# STX Framework Rev. 10 — Trigger Dashboard

A static web page (GitHub Pages) that checks every trigger in the *STX Concentrated Position Management Framework Rev. 10*.

- **Daily prices:** a GitHub Action fetches STX daily OHLCV after the US close (Yahoo Finance, with Stooq as fallback). It commits the data to `data/stx.json` and redeploys the site.
- **Systems 1 and 2 plus re-entry:** these are computed automatically from closing prices. The page simulates the rules from your start date to work out the current episode state (fired families, used tiers, A1/k, dormant flag and mandatory review).
- **Systems 0, 3 and 4:** these are interactive calculators and checklists. Anything you enter is stored only in your browser (localStorage).
- **Charts:** price with the 20/50-SMA, Magnitude tier lines, ladder rung and signal markers; RSI; drawdown from P2; volume vs the prior-50 average; weekly MACD; and held % of S0.

## Repository layout (create exactly these paths)

```
index.html
app.js
scripts/fetch_data.py
.github/workflows/update-and-deploy.yml
README.md
```
You don't need to create `data/stx.json`. The workflow creates it on the first run.

## Set-up (about 5 minutes)

1. On GitHub, create a new **public** repository, e.g. `stx-dashboard`. GitHub Pages is free for public repositories.
2. Select **Add file → Create new file** for each path above, then paste in the content. To create the folders, type the full path, e.g. `.github/workflows/update-and-deploy.yml`.
3. Go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
4. Go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**.
5. Go to **Actions → "Update STX data and deploy dashboard" → Run workflow**.
6. Open `https://<your-user>.github.io/stx-dashboard/`.

The workflow then runs each weekday at 22:30 UTC (06:30 SGT). You can also run it on demand from the Actions tab.

## Other data options

- **⚡ Live fetch:** enter a free Twelve Data API key under Settings to fetch straight from the browser.
- **⬆ CSV:** upload a CSV export with Date, Open, High, Low, Close and Volume columns (Yahoo/Investing.com format).

## Notes and limits

- All signals use **closing** prices. Weekly MACD only counts as confirmed at the weekly close (weeks still in progress are marked `*`).
- The simulation assumes every signal was acted on. If your real trades differ, change the start date and A1 override to match your ledger.
- One forward EPS value is used for the whole simulated period. Update it after each earnings release.
- The System 0 glide timing, System 3 inputs and System 4 events are manual by design (they depend on fundamental or public-disclosure information).
- Don't commit personal numbers (net worth, share counts) to the repository. The page keeps them in the browser only.
- This is for analysis only and isn't financial advice. Confirm trading windows, pre-clearance and 10b5-1 plans with Seagate Legal/Compliance.
