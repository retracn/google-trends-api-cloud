'use strict';
// Drop-in replacement for the google-trends-api npm package (last release 2022). Same methods,
// options, callbacks and JSON-string results. interestOverTime, interestByRegion and relatedQueries
// run on a hosted Google Trends API on Apify (no 429s from servers), and dailyTrends and realTimeTrends,
// whose Google endpoints now answer 404, are rebuilt from Google's current trending searches.
// autoComplete and relatedTopics are the original functions. Set APIFY_TOKEN
// (free account: https://console.apify.com/sign-up) or pass { apifyToken } in the options.
const original = require('google-trends-api');

const ACTOR = 'automationnation~google-trends-scraper';
const PROPERTIES = { images: 'images', news: 'news', youtube: 'youtube', froogle: 'froogle' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const cache = new Map();

function api () {
  return `${(process.env.APIFY_API_BASE_URL || 'https://api.apify.com').replace(/\/+$/, '')}/v2`;
}

const ymd = (d) => d.toISOString().slice(0, 10);

function timeInput (opts) {
  const end = opts.endTime instanceof Date ? opts.endTime : new Date();
  const start = opts.startTime instanceof Date ? opts.startTime : new Date('2004-01-01');
  if (start <= new Date('2004-01-02')) return { timeRange: 'all' };
  const span = end - start;
  if (span < 7 * 864e5 && Date.now() - end < 864e5) return { timeRange: span <= 864e5 ? 'now 1-d' : 'now 7-d', filter: [start, end] };
  return { customTimeRange: `${ymd(start)} ${ymd(end)}` };
}

function keywordsOf (opts) {
  if (!opts || !opts.keyword) throw new Error('Keyword must be provided');
  const kws = Array.isArray(opts.keyword) ? opts.keyword : [opts.keyword];
  if (kws.length > 5) throw new Error('Google Trends compares at most 5 keywords at a time');
  return kws.map(String);
}

function geoOf (opts) {
  const geos = [...new Set((Array.isArray(opts.geo) ? opts.geo : [opts.geo || '']).map((g) => String(g || '')))];
  if (geos.length > 1) throw new Error('google-trends-api-cloud: comparing different geos in one request is not supported; request each geo separately');
  return geos[0];
}

async function run (input, opts) {
  const token = opts.apifyToken || process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('No Apify API token: set APIFY_TOKEN or pass { apifyToken }. Free account: https://console.apify.com/sign-up, token: https://console.apify.com/settings/integrations');
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.rows;
  const res = await fetch(`${api()}/acts/${ACTOR}/run-sync-get-dataset-items?timeout=300&clean=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'google-trends-api-cloud' },
    body: key
  });
  if (res.status === 401) throw new Error('Apify rejected the API token (check APIFY_TOKEN).');
  if (res.status === 402) throw new Error('Your Apify account has no credit left: https://console.apify.com/billing');
  if (!res.ok) throw new Error(`The Google Trends request failed: HTTP ${res.status}`);
  const rows = await res.json();
  const out = Array.isArray(rows) ? rows : [];
  cache.set(key, { rows: out, at: Date.now() });
  return out;
}

async function reports (opts, extra) {
  const kws = keywordsOf(opts);
  const t = timeInput(opts);
  const input = {
    searchTerms: kws, compareAll: kws.length > 1, geo: geoOf(opts), searchType: PROPERTIES[opts.property] || '',
    language: opts.hl || 'en-US', timezoneOffset: Number(opts.timezone || 0),
    includeInterestOverTime: true, includeInterestByRegion: true, includeRelatedQueries: true, includeRelatedTopics: false,
    ...extra
  };
  if (t.timeRange) input.timeRange = t.timeRange; else input.customTimeRange = t.customTimeRange;
  if (opts.category) input.categoryId = Number(opts.category);
  const rows = await run(input, opts);
  const byTerm = new Map(rows.filter((r) => r.type === 'keyword-report').map((r) => [String(r.searchTerm).trim().toLowerCase(), r]));
  return { kws, filter: t.filter, list: kws.map((k) => byTerm.get(k.trim().toLowerCase()) || null) };
}

const relLink = (link) => String(link || '').replace(/^https:\/\/trends\.google\.com/, '');

function axisTime (d, hourly) {
  return hourly ? `${String(d.getUTCHours()).padStart(2, '0')}:00` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

async function interestOverTimeImpl (opts) {
  const { list, filter } = await reports(opts);
  const times = new Map();
  list.forEach((r, i) => {
    for (const p of (r && r.timeline) || []) {
      const ts = Date.parse(p.timestamp || p.date);
      if (filter && (ts < filter[0] - 36e5 || ts > filter[1])) continue;
      if (!times.has(ts)) times.set(ts, { p, values: new Array(list.length).fill(0), partial: false });
      const slot = times.get(ts);
      slot.values[i] = Number(p.value || 0);
      slot.partial = slot.partial || Boolean(p.isPartial);
    }
  });
  const sorted = [...times.entries()].sort((a, b) => a[0] - b[0]);
  const hourly = sorted.length > 1 && sorted[1][0] - sorted[0][0] < 864e5;
  const timelineData = sorted.map(([ts, { p, values, partial }]) => {
    const d = new Date(ts);
    const point = {
      time: String(Math.floor(ts / 1000)),
      formattedTime: p.formattedTime || `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
      formattedAxisTime: axisTime(d, hourly),
      value: values,
      hasData: values.map((v) => v > 0),
      formattedValue: values.map(String)
    };
    if (partial) point.isPartial = true;
    return point;
  });
  const averages = list.map((r) => (r && r.averageInterest != null ? Math.round(r.averageInterest) : 0));
  return JSON.stringify({ default: { timelineData, averages } });
}

async function interestByRegionImpl (opts) {
  const resolution = String(opts.resolution || 'COUNTRY').toUpperCase();
  const city = resolution === 'CITY';
  const { list } = await reports(opts, { regionResolution: resolution, includeCities: city });
  const rows = new Map();
  list.forEach((r, i) => {
    for (const g of ((r && (city ? r.cities : r.regions)) || [])) {
      const k = g.geoCode || g.name;
      if (!rows.has(k)) rows.set(k, { g, values: new Array(list.length).fill(0) });
      rows.get(k).values[i] = Number(g.value || 0);
    }
  });
  const geoMapData = [...rows.values()].map(({ g, values }) => {
    const item = city && g.latitude != null ? { coordinates: { lat: g.latitude, lng: g.longitude }, geoName: g.name } : { geoCode: g.geoCode, geoName: g.name };
    return Object.assign(item, { value: values, formattedValue: values.map(String), maxValueIndex: values.indexOf(Math.max(...values)), hasData: values.map((v) => v > 0) });
  }).sort((a, b) => Math.max(...b.value) - Math.max(...a.value));
  return JSON.stringify({ default: { geoMapData } });
}

async function relatedQueriesImpl (opts) {
  const { list } = await reports(opts);
  const r = list.find(Boolean) || {};
  const top = (r.topQueries || []).map((q) => ({ query: q.query, value: Number(q.value || 0), formattedValue: String(q.value || 0), hasData: true, link: relLink(q.link) }));
  const rising = (r.risingQueries || []).map((q) => ({
    query: q.query,
    value: q.growthPercent != null ? q.growthPercent : (q.isBreakout ? 5000 : 0),
    formattedValue: q.isBreakout ? 'Breakout' : (q.growth || `+${q.growthPercent}%`),
    link: relLink(q.link)
  }));
  return JSON.stringify({ default: { rankedList: [{ rankedKeyword: top }, { rankedKeyword: rising }] } });
}

async function trending (opts, hours) {
  const geo = String(opts.geo || 'US').toUpperCase();
  // Google's old daily feed listed about 20 searches a day; news for hundreds of trends would take minutes.
  const max = Number(opts.maxItems || opts.count || 25);
  const rows = await run({ trendingGeos: [geo], trendingHours: hours, trendingMaxItems: max, includeNews: true, language: opts.hl || 'en-US' }, opts);
  return { geo, items: rows.filter((r) => r.type === 'trending-search') };
}

function timeAgo (iso) {
  if (!iso) return '';
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 36e5));
  return h < 1 ? 'Just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const explore = (q, geo) => `/trends/explore?q=${encodeURIComponent(q).replace(/%20/g, '+')}&date=now+7-d&geo=${geo}`;

async function dailyTrendsImpl (opts) {
  const { geo, items } = await trending(opts, 24);
  const now = new Date();
  const trendingSearches = items.map((t) => {
    const news = t.newsArticles || [];
    const img = news.find((a) => a.imageUrl);
    return {
      title: { query: t.title, exploreLink: explore(t.title, geo) },
      formattedTraffic: t.searchVolumeLabel || '',
      relatedQueries: (t.relatedQueries || []).map((q) => ({ query: q, exploreLink: explore(q, geo) })),
      image: img ? { newsUrl: img.url, source: img.source, imageUrl: img.imageUrl } : {},
      articles: news.map((a) => ({ title: a.title, timeAgo: timeAgo(a.publishedAt), source: a.source, image: a.imageUrl ? { newsUrl: a.url, source: a.source, imageUrl: a.imageUrl } : undefined, url: a.url, snippet: '' })),
      shareUrl: t.trendsUrl
    };
  });
  const day = ymd(now).replace(/-/g, '');
  return JSON.stringify({ default: { trendingSearchesDays: [{ date: day, formattedDate: `${DAYS[now.getUTCDay()]}, ${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()}`, trendingSearches }], endDateForNextRequest: day, rssFeedPageUrl: `https://trends.google.com/trending/rss?geo=${geo}` } });
}

async function realTimeTrendsImpl (opts) {
  const { items } = await trending(opts, 4);
  const trendingStories = items.map((t, i) => {
    const news = t.newsArticles || [];
    const img = news.find((a) => a.imageUrl);
    return {
      image: img ? { newsUrl: img.url, source: img.source, imgUrl: img.imageUrl } : {},
      shareUrl: t.trendsUrl,
      articles: news.map((a) => ({ articleTitle: a.title, url: a.url, source: a.source, time: timeAgo(a.publishedAt), snippet: '' })),
      idsForDedup: [],
      id: `${opts.geo || 'US'}_lnk_${i}`,
      title: t.title,
      entityNames: (t.relatedQueries || []).slice(0, 5)
    };
  });
  return JSON.stringify({ featuredStoryIds: [], trendingStoryIds: trendingStories.map((s) => s.id), storySummaries: { featuredStories: [], trendingStories }, date: ymd(new Date()).replace(/-/g, ''), hideAllImages: false });
}

// Same calling conventions as google-trends-api: (options) => Promise<string>, or (options, callback).
function wrap (impl) {
  return function (opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = undefined; }
    const p = Promise.resolve().then(() => impl(opts || {}));
    if (typeof cb === 'function') { p.then((r) => cb(null, r), (e) => cb(e)); return undefined; }
    return p;
  };
}

module.exports = Object.assign({}, original, {
  interestOverTime: wrap(interestOverTimeImpl),
  interestByRegion: wrap(interestByRegionImpl),
  relatedQueries: wrap(relatedQueriesImpl),
  dailyTrends: wrap(dailyTrendsImpl),
  realTimeTrends: wrap(realTimeTrendsImpl)
});
module.exports._cache = cache;
