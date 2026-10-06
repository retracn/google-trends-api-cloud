'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const calls = [];
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  if (init.headers.Authorization !== 'Bearer good') return { ok: false, status: 401, json: async () => ({}) };
  return { ok: true, status: 201, json: async () => fx(body.trendingGeos ? 'trending.json' : 'keyword-reports.json') };
};
process.env.APIFY_TOKEN = 'good';
const g = require('..');
const reset = () => { calls.length = 0; g._cache.clear(); };

test('exports the same methods as google-trends-api', () => {
  const original = require('google-trends-api');
  assert.deepStrictEqual(Object.keys(g).filter((k) => !k.startsWith('_')).sort(), Object.keys(original).sort());
  assert.strictEqual(g.autoComplete, original.autoComplete);
  assert.strictEqual(g.relatedTopics, original.relatedTopics);
});

test('interestOverTime returns the original JSON string shape', async () => {
  reset();
  const s = await g.interestOverTime({ keyword: ['chatgpt', 'claude'], startTime: new Date('2026-07-01'), endTime: new Date('2026-10-01'), geo: 'US', category: 5, property: 'youtube' });
  assert.strictEqual(typeof s, 'string');
  const d = JSON.parse(s).default;
  assert.strictEqual(d.timelineData.length, 93);
  const p = d.timelineData[0];
  assert.deepStrictEqual(Object.keys(p), ['time', 'formattedTime', 'formattedAxisTime', 'value', 'hasData', 'formattedValue']);
  assert.strictEqual(p.time, String(Date.parse('2026-07-05T00:00:00.000Z') / 1000));
  assert.strictEqual(p.formattedAxisTime, 'Jul 5');
  assert.strictEqual(p.value.length, 2);
  assert.deepStrictEqual(p.formattedValue, p.value.map(String));
  assert.deepStrictEqual(d.averages, [73, 17]);
  const inp = calls[0];
  assert.strictEqual(inp.customTimeRange, '2026-07-01 2026-10-01');
  assert.strictEqual(inp.compareAll, true);
  assert.strictEqual(inp.geo, 'US');
  assert.strictEqual(inp.categoryId, 5);
  assert.strictEqual(inp.searchType, 'youtube');
});

test('one run serves several methods with the same options', async () => {
  reset();
  const opts = { keyword: ['chatgpt', 'claude'] };
  await g.interestOverTime(opts);
  const rq = JSON.parse(await g.relatedQueries(opts)).default;
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].timeRange, 'all');
  assert.strictEqual(rq.rankedList.length, 2);
  const top = rq.rankedList[0].rankedKeyword[0];
  assert.deepStrictEqual(Object.keys(top), ['query', 'value', 'formattedValue', 'hasData', 'link']);
  assert.ok(top.link.startsWith('/trends/explore?q='), 'relative links as in the original');
  const rising = rq.rankedList[1].rankedKeyword[0];
  assert.deepStrictEqual(rising, { query: '1980s photo prompt chatgpt', value: 4250, formattedValue: '+4,250%', link: '/trends/explore?q=1980s+photo+prompt+chatgpt&date=today+3-m' });
});

test('interestByRegion: geoMapData sorted, with maxValueIndex', async () => {
  reset();
  const d = JSON.parse(await g.interestByRegion({ keyword: ['chatgpt', 'claude'], resolution: 'region' })).default;
  const first = d.geoMapData[0];
  assert.deepStrictEqual(Object.keys(first), ['geoCode', 'geoName', 'value', 'formattedValue', 'maxValueIndex', 'hasData']);
  assert.strictEqual(first.geoCode, 'CN');
  assert.strictEqual(first.maxValueIndex, 0);
  assert.strictEqual(calls[0].regionResolution, 'REGION');
});

test('dailyTrends and realTimeTrends are rebuilt from trending searches', async () => {
  reset();
  const daily = JSON.parse(await g.dailyTrends({ geo: 'US' })).default;
  const t = daily.trendingSearchesDays[0].trendingSearches[0];
  assert.strictEqual(t.title.query, 'lions vs panthers');
  assert.strictEqual(t.formattedTraffic, '500K+');
  assert.ok(t.relatedQueries[0].exploreLink.startsWith('/trends/explore?q='));
  assert.deepStrictEqual({ geo: calls[0].trendingGeos, hours: calls[0].trendingHours, news: calls[0].includeNews, max: calls[0].trendingMaxItems }, { geo: ['US'], hours: 24, news: true, max: 25 });
  const rt = JSON.parse(await g.realTimeTrends({ geo: 'US', category: 'all' }));
  assert.strictEqual(rt.storySummaries.trendingStories[0].title, 'lions vs panthers');
  assert.strictEqual(calls[1].trendingHours, 4);
});

test('callback style, time ranges and errors', async () => {
  reset();
  await new Promise((resolve, reject) => g.interestOverTime({ keyword: 'claude', startTime: new Date(Date.now() - 3 * 864e5) }, (err, res) => { if (err) reject(err); else { assert.ok(JSON.parse(res).default); resolve(); } }));
  assert.strictEqual(calls[0].timeRange, 'now 7-d');
  await assert.rejects(g.interestOverTime({}), /Keyword must be provided/);
  await assert.rejects(g.interestOverTime({ keyword: ['a', 'b', 'c', 'd', 'e', 'f'] }), /at most 5 keywords/);
  await assert.rejects(g.interestOverTime({ keyword: ['a', 'b'], geo: ['US', 'GB'] }), /different geos/);
  await assert.rejects(g.interestOverTime({ keyword: 'x', apifyToken: 'bad' }), /rejected the API token/);
  const saved = process.env.APIFY_TOKEN; delete process.env.APIFY_TOKEN;
  await assert.rejects(g.interestOverTime({ keyword: 'y' }), /No Apify API token/);
  process.env.APIFY_TOKEN = saved;
});
