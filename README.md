# google-trends-api-cloud: google-trends-api without 429s, with dailyTrends working again

The [google-trends-api](https://github.com/pat310/google-trends-api) npm package calls Google Trends from your own IP and hasn't had a release since June 2022. Google answers busy servers with **429 Too Many Requests**, and two of its endpoints are gone: **`dailyTrends` and `realTimeTrends` now get a 404 page** (see its issues "[dailyTrends returning a 404](https://github.com/pat310/google-trends-api/issues/175)" and "[REAL TIME TRENDS does not work](https://github.com/pat310/google-trends-api/issues/173)").

**google-trends-api-cloud keeps the same methods, options, callbacks and JSON-string results, so your code doesn't change.** `interestOverTime`, `interestByRegion` and `relatedQueries` run on a hosted Google Trends API that rotates IPs and retries for you. `dailyTrends` and `realTimeTrends` are rebuilt in their old format from Google's current trending searches. `autoComplete` and `relatedTopics` are the original functions.

```diff
- const googleTrends = require('google-trends-api');
+ const googleTrends = require('google-trends-api-cloud');
```

## Install

```bash
npm install github:retracn/google-trends-api-cloud
```

You need an Apify API token: create a [free Apify account](https://console.apify.com/sign-up), copy the token from [Settings → API & Integrations](https://console.apify.com/settings/integrations) and set `APIFY_TOKEN`, or pass `apifyToken` in the options.

## Use it exactly like google-trends-api

```js
const googleTrends = require('google-trends-api-cloud');

const results = await googleTrends.interestOverTime({ keyword: ['chatgpt', 'claude'], startTime: new Date('2026-07-01'), geo: 'US' });
const { timelineData, averages } = JSON.parse(results).default;   // same JSON string as before

googleTrends.relatedQueries({ keyword: 'claude' }, (err, res) => { /* callbacks work too */ });

const daily = JSON.parse(await googleTrends.dailyTrends({ geo: 'US' }));       // works again
const realtime = JSON.parse(await googleTrends.realTimeTrends({ geo: 'GB' })); // works again
```

- **One request for several methods:** calling `interestOverTime`, `interestByRegion` and `relatedQueries` with the same options uses one request; the rest come from a 5-minute cache.
- `dailyTrends` and `realTimeTrends` return the top 25 trending searches with news by default; pass `maxItems` (or `count`) for more.
- Options map as before: `keyword` (up to 5), `startTime`, `endTime`, `geo`, `hl`, `timezone`, `category`, `property` (`youtube`, `news`, `images`, `froogle`) and `resolution` (`COUNTRY`, `REGION`, `CITY`, `DMA`).

## Differences

| | google-trends-api | google-trends-api-cloud |
|---|---|---|
| From servers | 429 errors | Works |
| `dailyTrends`, `realTimeTrends` | 404 | Rebuilt from Google's current trending searches, with search volume, related queries and news articles |
| `geo` array with different countries | Compares geos | Not supported: request each geo separately |
| `relatedQueries` with several keywords | – | Lists for the first keyword |
| Article `snippet`, `timeAgo` | From Google's old feed | `snippet` is empty, `timeAgo` is computed from the publish time |
| Cost | Free | $1 per 1,000 keyword reports and $0.50 per 1,000 trending searches on your Apify account; the free plan's $5 monthly credit covers about 5,000 keyword reports |

## How it works

Each call runs [Google Trends Scraper](https://apify.com/automationnation/google-trends-scraper) through Apify's `run-sync-get-dataset-items` endpoint with your token, and converts its output to google-trends-api's JSON. For Python, see [pytrends-cloud](https://github.com/retracn/pytrends-cloud), the same idea for pytrends.

Disclosure: I maintain the Actor this package calls. MIT licensed. Not affiliated with Google or with google-trends-api.
