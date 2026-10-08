# Collibra Usage Analytics Dashboard

A single-page web dashboard for **Collibra Usage Analytics**. It shows what's being visited, by whom, and how adoption is trending, with more filters, comparisons and export options than the built-in app.

- **Three static files:** HTML, CSS and JavaScript. There's no build step, no framework, no third-party libraries and no backend.
- **Runs in your browser** against the Collibra environment you're signed in to. It uses your existing session, so it never asks for or stores credentials.
- **Portable:** the Collibra URL is discovered at runtime, so the same files work in dev, test and production unchanged.

> ⚠️ **Unofficial.** This project isn't affiliated with or supported by Collibra. It uses **undocumented internal APIs** behind Collibra's Usage Analytics app (`/rest/usageAnalyticsUsage/v1`, `/rest/usageAnalyticsUsers/v1`). Those APIs may change in any Collibra release without notice.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [How it finds Collibra](#how-it-finds-collibra)
- [Using the dashboard](#using-the-dashboard)
  - [How measures are calculated](#how-measures-are-calculated)
  - [Unique active users (deduplicated)](#unique-active-users-deduplicated)
- [Exports](#exports)
- [Shareable links and saved views](#shareable-links-and-saved-views)
- [APIs used](#apis-used)
- [Permissions](#permissions)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [License](#license)

---

## Features

**Seven tabs**

| Tab | What it shows |
|-----|---------------|
| **Overview** | Headline numbers (visits, active/new users, visits per user, assets visited, catalog coverage) with change vs. the comparison period, plus sparklines; **Unique active users**; visit trends, content mix and top lists |
| **Content** | Visits to Assets, Domains, Communities, Dashboards and Diagrams: trends, daily calendar heatmap, weekday profile, breakdown by asset type or community, rising/falling items, and a full ranked list |
| **Users & Adoption** | **Unique active users**, usage rate (High/Medium/Low), retention (Acquired/Retained/Returning), license types, adoption funnel, and per-user detail |
| **Asset Explorer** | Search for any asset and drill into its visits, unique visitors, trend and top visitors |
| **All-time Popularity** | Collibra's all-time most-viewed assets (navigation statistics) |
| **Edit Activity** | The audit trail: who changed what, filterable by cause (manual, import, workflow) |
| **Ratings** | Asset ratings and reviews, all-time or within the selected date range |

**Controls**
- **Date presets:** last 7/30/90 days, this or last month, quarter to date, last quarter, year to date, last 12 months, or a custom range.
- **Granularity:** Auto, Day, Week, Month or Quarter.
- **Comparison:** previous period, same period last year, or none.
- **Exclusions:** toggles to exclude admins and disabled users.
- **Audience and content filters:** user groups, roles, license types, communities/domains and asset types.
- **Interactive charts:** click to zoom, toggle legend items, switch chart type, view as a data table, and go fullscreen.
- **ⓘ on every measure:** every metric tile, chart and table explains how it's calculated, with the current numbers. See [How measures are calculated](#how-measures-are-calculated).
- **Light and dark themes,** keyboard shortcuts, and accessible markup (skip link, ARIA roles, keyboard navigation).

---

## Requirements

- A Collibra environment with **Usage Analytics enabled**.
- A Collibra user with the **Usage Analytics (Insights)** permission, for the usage tabs. See [Permissions](#permissions).
- A modern evergreen browser. It was tested in Microsoft Edge (Chromium); current Chrome and Firefox should also work.
- A way to serve three static files from the **same origin as Collibra**. See [Installation](#installation).

---

## Installation

1. Download or clone this repository. You need these three files, kept together in one folder:

   ```
   usage-dashboard.html
   usage-dashboard.css
   usage-dashboard.js
   ```

2. Serve the folder from the **same origin** (scheme + host + port) as your Collibra environment. For example:

   ```
   https://collibra.example.com/dashboards/usage-dashboard.html
   ```

   The dashboard relies on the browser's Collibra session cookie. Browsers only send that cookie automatically to the same origin, so same-origin hosting needs no configuration.

3. Sign in to Collibra in the same browser, then open `usage-dashboard.html`.

### Other hosting options

| Option | Works? | Notes |
|--------|--------|-------|
| Same origin as Collibra | ✅ Recommended | Zero configuration |
| Inside an iframe on a Collibra page | ✅ | The embedding page is used to find Collibra |
| A different origin | ⚠️ Only if Collibra allows it | Collibra must allow cross-origin requests with credentials (CORS). Use the Connect prompt or `?collibraBase=` |
| Opening the HTML file directly (`file://`) | ⚠️ Usually not | It can't detect Collibra, and cross-origin restrictions normally block the requests |

---

## How it finds Collibra

You normally don't configure anything. On load, the dashboard tries these sources in order and uses the first one that responds as a Collibra REST API:

1. **Explicit override:**
   - A `?collibraBase=https://…` query parameter, or `#collibraBase=…` in the URL hash.
   - Or the `<meta name="collibra-base-url" content="">` tag in `usage-dashboard.html` (empty by default).
2. **Cached result** from earlier in the same browser tab.
3. **The page's own origin.** It tries each folder of the page's path (longest first), so a context path like `https://host/ctx/` is found automatically.
4. **The embedding page,** if the dashboard runs inside an iframe, or the referring page.
5. **The script's own origin.**
6. **A URL you entered before** in the Connect prompt.
7. **A "Connect to Collibra" prompt,** if nothing else works.

Each candidate is checked with `GET /rest/2.0/auth/sessions/current?include=csrfToken`. That call also provides the CSRF token the dashboard sends with later requests. If it finds Collibra but you aren't signed in, it tells you and links to the sign-in page.

---

## Using the dashboard

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `1` – `7` | Switch tabs |
| `R` | Refresh all data |
| `T` | Toggle dark mode |
| `/` | Search assets (opens Asset Explorer) |
| `I` | Explain how the focused chart or metric is calculated |
| `?` | Show help |
| `Esc` | Close menus, dialogs and fullscreen |

### Tips
- **Drill down:** click bars and periods in charts.
- **Hide series:** click legend items.
- **Copy link:** copies a URL that reproduces exactly what you're looking at.
- **Data freshness:** the header shows when Collibra last refreshed Usage Analytics. Collibra aggregates this data periodically, so today's activity may not appear yet.

### How measures are calculated

Every metric tile, chart and table has an **ⓘ** button. You can also press `I` while it has focus. The ⓘ opens a dialog with:

| Section | Contents |
|---------|----------|
| **What it measures** | Plain-language definition. User-type, visit-type, usage-rate and retention definitions use Collibra Usage Analytics' own wording |
| **How it's calculated** | The method and, where useful, the formula |
| **In this view** | The calculation worked through with the numbers currently on screen, e.g. "13 user-days ÷ 30 days = 0.4", plus the date range, comparison and filters that apply |
| **Data source** | The exact API endpoint(s) the value comes from |
| **Good to know** | Caveats such as data refresh delay, row caps, or whether a count is deduplicated |

**Copy explanation** puts the whole explanation on the clipboard as plain text. Metric exports (CSV/Excel/JSON) also include a **Calculation** column.

### Unique active users (deduplicated)

Collibra's **Active users** figure counts **distinct people**. Two people who each sign in every day of a month are **2** active users. Charts that show users **per day / week / month** count a person in every bucket they were active in. Adding those buckets up gives **user-days** (or user-weeks), not people.

The **Unique active users** card (on Overview and Users & Adoption) shows both side by side:

| Value | Meaning |
|-------|---------|
| **Unique active users** | Distinct people with at least one sign-in in the range: Collibra's own count by user ID |
| **User-days** | Sum of each day's distinct active users. One person active on 5 days counts 5 |
| **Avg daily active** | User-days ÷ days in the range |
| **Active days** | Days with at least one active user |
| **Chart** | Bars: distinct users per bucket. Line: running total of unique people, ending at the headline number |

The card's table/CSV/Excel export lists every bucket plus a **Whole range (deduplicated)** total row.

---

## Exports

**Per chart or table.** Every chart and table has its own export menu:
- **Image:** PNG, JPEG or SVG.
- **Document:** PDF or Print.
- **Data:** CSV, Excel (`.xlsx`) or JSON.

**Whole tab.** The **Export** button in the header bundles everything on the current tab as:
- An Excel workbook, with one sheet per chart or table.
- A ZIP of CSV files.
- A JSON file.
- A multi-page PDF report with all charts.
- A printout.

All files are generated in your browser, with no external libraries and no server round-trip. Exports include a description of the active date range, comparison and filters.

---

## Shareable links and saved views

- **URL hash:** all dashboard state (tab, date range, granularity, comparison, exclusions, filters and the selected asset) is kept in the URL hash. Bookmark it or send it to a colleague; they'll see the same view, subject to their own permissions.
- **Saved views:** saves named configurations in your browser's `localStorage`. They're per browser and aren't shared.

---

## APIs used

All requests go from your browser directly to Collibra, using your session cookie plus an `X-CSRF-TOKEN` header.

| API | Used for |
|-----|----------|
| `/rest/usageAnalyticsUsage/v1` *(internal)* | Visit summaries, time series, top items, per-asset usage, filter lists, and the last-refresh time |
| `/rest/usageAnalyticsUsers/v1` *(internal)* | Active/inactive/new users, top users, usage rate, retention, license types |
| `…/timeSeries/download` *(internal)* | Row-level data, so per-item and per-user lists aren't capped at the API's 100-row top lists |
| `/rest/2.0/navigation/most_viewed`, `recently_viewed` | All-time popularity |
| `/rest/2.0/activities` | Edit activity / audit trail |
| `/rest/2.0/ratings` | Ratings and reviews |
| `/rest/2.0/users`, `/rest/2.0/assets`, `/rest/2.0/application/info` | Names, asset search, Collibra version |
| `/graphql/knowledgeGraph/v1` | Asset type, status, domain and community enrichment, with a REST fallback |

The dashboard only **reads** data. It never creates, updates or deletes anything in Collibra.

---

## Permissions

| Tabs | Requires |
|------|----------|
| Overview, Content, Users & Adoption | Usage Analytics (Insights) permission |
| Asset Explorer | Standard asset read access. Its visit data needs the Usage Analytics permission |
| All-time Popularity, Edit Activity, Ratings | Standard REST read permissions |

- **No Usage Analytics permission:** the usage tabs show a notice instead of data.
- **Usage Analytics not available on the environment at all:** those tabs are hidden, and the dashboard opens on All-time Popularity.

---

## Privacy and security

- **No credentials:** the dashboard never asks for a password, token or API key. It uses the session you already have in the browser.
- **No third parties:** no analytics, telemetry or third-party requests. Everything stays between your browser and your Collibra environment.
- **Browser storage:** only theme, preferences, saved views and the last Connect URL are stored locally, under keys prefixed `uad.`. Clear your browser's site data to remove them.
- **User-level data:** usage data can include user names and activity. Share exports and links in line with your organization's privacy policies.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **"Connect to Collibra" appears** | Collibra wasn't found relative to the page. Host the files on the Collibra origin, or enter the Collibra URL. |
| **"You aren't signed in"** | Sign in to Collibra in another tab, then press **Connect** or **Refresh**. |
| **"Couldn't reach that URL … (CORS)"** | The dashboard is on a different origin and Collibra blocks cross-origin requests. Host it on the same origin. |
| **"Your Collibra session has expired"** | Sign in again in another tab, then press **Refresh** (`R`). |
| **Usage tabs show a permission notice** | Your user lacks the Usage Analytics (Insights) permission. |
| **Usage tabs are missing** | Usage Analytics isn't enabled on this environment. |
| **Today's visits are missing** | Usage Analytics data is aggregated periodically. Check "Usage data refreshed …" in the header. |
| **Something broke after a Collibra upgrade** | The internal APIs may have changed. Open the browser developer tools (F12) → Console/Network to see the failing request. |

---

## Limitations

- **Undocumented APIs:** they may change or be removed in future Collibra releases.
- **Usage-rate granularity:** the usage-rate report doesn't support daily buckets. Collibra only provides it by week, month or quarter, so the dashboard uses weekly buckets when Day is selected.
- **Large ranges:** very large date ranges or activity caps can take a while to load, especially on Edit Activity.
- **Same-origin hosting:** without it, the dashboard depends on Collibra's CORS configuration.

---

## License

MIT License © 2026 Woffles. See the `LICENSE` file at the repository root. If you publish this folder as its own repository, copy `LICENSE` alongside it.

*Collibra is a trademark of Collibra NV/SA. This project is independent and not endorsed by Collibra.*
