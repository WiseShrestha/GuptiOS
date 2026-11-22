#!/usr/bin/env node
// Builds coding-stats.json, the snapshot the "Code Stats" window reads.
// Runs daily in .github/workflows/coding-stats.yml; run it locally with:
//   node scripts/fetch-coding-stats.mjs
// Handles live in coding-profiles.json. Leave one empty to hide that platform.
// If a platform fails, its last good data from the previous snapshot is kept.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const profilesFile = new URL(process.env.PROFILES_FILE || 'coding-profiles.json', root);
const outputFile = new URL(process.env.OUTPUT_FILE || 'coding-stats.json', root);
const UA = 'GuptiOS-stats/1.0 (+https://github.com/WiseShrestha/GuptiOS)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(url, options = {}, kind = 'json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers: { 'user-agent': UA, ...options.headers }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return kind === 'json' ? await res.json() : await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1500 * attempt);
    }
  }
}

const day = seconds => new Date(seconds * 1000).toISOString().slice(0, 10);
const pad = date => date.split('-').map((p, i) => i ? p.padStart(2, '0') : p).join('-');
const topCounts = (map, limit = 12) => [...map].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);

async function github(handle) {
  const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
  const user = await request(`https://api.github.com/users/${handle}`, { headers });
  const repos = await request(`https://api.github.com/users/${handle}/repos?per_page=100&type=owner&sort=pushed`, { headers });
  const contributions = await request(`https://github-contributions-api.jogruber.de/v4/${handle}?y=last`);
  const own = repos.filter(r => !r.fork);
  const languages = new Map();
  own.forEach(r => r.language && bump(languages, r.language));
  const calendar = {};
  contributions.contributions.forEach(c => { if (c.count) calendar[c.date] = c.count });
  return {
    name: user.name || user.login,
    url: user.html_url,
    publicRepos: user.public_repos,
    followers: user.followers,
    stars: own.reduce((n, r) => n + r.stargazers_count, 0),
    contributions: contributions.total.lastYear,
    languages: topCounts(languages, 6),
    repos: own.slice(0, 4).map(r => ({ name: r.name, url: r.html_url, description: r.description || '', language: r.language || '', stars: r.stargazers_count })),
    calendar,
  };
}

const LEETCODE_QUERY = `query($u:String!){
  matchedUser(username:$u){
    username profile{ranking}
    submitStatsGlobal{acSubmissionNum{difficulty count}}
    userCalendar{streak totalActiveDays submissionCalendar}
    tagProblemCounts{advanced{tagName problemsSolved} intermediate{tagName problemsSolved} fundamental{tagName problemsSolved}}
    badges{displayName}
  }
  allQuestionsCount{difficulty count}
  userContestRanking(username:$u){attendedContestsCount rating globalRanking topPercentage}
  userContestRankingHistory(username:$u){attended rating contest{title startTime}}
}`;

async function leetcode(handle) {
  const { data, errors } = await request('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', referer: 'https://leetcode.com' },
    body: JSON.stringify({ query: LEETCODE_QUERY, variables: { u: handle } }),
  });
  const user = data?.matchedUser;
  if (!user) throw new Error(errors?.[0]?.message || `LeetCode user ${handle} not found`);
  const byDifficulty = list => Object.fromEntries(list.map(x => [x.difficulty.toLowerCase(), x.count]));
  const solved = byDifficulty(user.submitStatsGlobal.acSubmissionNum);
  const topics = new Map();
  Object.values(user.tagProblemCounts).flat().forEach(t => t.problemsSolved && bump(topics, t.tagName, t.problemsSolved));
  const calendar = {};
  for (const [t, n] of Object.entries(JSON.parse(user.userCalendar?.submissionCalendar || '{}'))) calendar[day(+t)] = (calendar[day(+t)] || 0) + n;
  const contest = data.userContestRanking;
  return {
    url: `https://leetcode.com/u/${user.username}/`,
    solved: { total: solved.all || 0, easy: solved.easy || 0, medium: solved.medium || 0, hard: solved.hard || 0 },
    available: byDifficulty(data.allQuestionsCount),
    ranking: user.profile.ranking,
    streak: user.userCalendar?.streak || 0,
    activeDays: user.userCalendar?.totalActiveDays || 0,
    rating: contest?.rating ? Math.round(contest.rating) : null,
    contests: contest?.attendedContestsCount || 0,
    topPercentage: contest?.topPercentage ?? null,
    history: (data.userContestRankingHistory || []).filter(h => h.attended).map(h => ({ date: day(h.contest.startTime), rating: Math.round(h.rating), name: h.contest.title })),
    topics: topCounts(topics),
    badges: user.badges.map(b => b.displayName).slice(0, 8),
    calendar,
  };
}

async function codeforces(handle) {
  const api = async path => {
    const json = await request(`https://codeforces.com/api/${path}`);
    if (json.status !== 'OK') throw new Error(json.comment || 'Codeforces API error');
    await sleep(2100); // Codeforces allows one call every two seconds.
    return json.result;
  };
  const [info] = await api(`user.info?handles=${handle}`);
  const ratings = await api(`user.rating?handle=${handle}`);
  const submissions = await api(`user.status?handle=${handle}&from=1&count=10000`);
  const solved = new Map(), tags = new Map(), calendar = {};
  for (const s of submissions) {
    const date = day(s.creationTimeSeconds);
    calendar[date] = (calendar[date] || 0) + 1;
    const key = `${s.problem.contestId ?? s.problem.problemsetName}-${s.problem.index}`;
    if (s.verdict === 'OK' && !solved.has(key)) { solved.set(key, s.problem); s.problem.tags.forEach(t => bump(tags, t)) }
  }
  return {
    url: `https://codeforces.com/profile/${info.handle}`,
    rating: info.rating ?? null,
    maxRating: info.maxRating ?? null,
    rank: info.rank || 'unrated',
    maxRank: info.maxRank || 'unrated',
    contests: ratings.length,
    solved: solved.size,
    history: ratings.map(r => ({ date: day(r.ratingUpdateTimeSeconds), rating: r.newRating, name: r.contestName })),
    topics: topCounts(tags),
    calendar,
  };
}

async function codechef(handle) {
  const res = await fetch(`https://www.codechef.com/users/${handle}`, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if (res.status !== 200) throw new Error(`CodeChef user ${handle} not found (${res.status})`);
  const html = await res.text();
  const match = (re, fallback = null) => html.match(re)?.[1] ?? fallback;
  const number = re => { const v = match(re); return v && /^\d+$/.test(v.trim()) ? Number(v) : null };
  const ratingBlock = match(/class="rating-star">([\s\S]*?)<\/div>/, '');
  const history = JSON.parse(match(/var all_rating = (\[[\s\S]*?\]);/, '[]'));
  const daily = JSON.parse(match(/userDailySubmissionsStats = (\[[\s\S]*?\]);/, '[]'));
  const calendar = {};
  daily.forEach(d => { if (d.value) calendar[pad(d.date)] = Number(d.value) });
  return {
    url: `https://www.codechef.com/users/${handle}`,
    name: match(/<h1 class="h2-style">([^<]+)<\/h1>/, handle).trim(),
    rating: number(/class="rating-number">\s*(\d+)/),
    maxRating: number(/Highest Rating (\d+)/),
    stars: (ratingBlock.match(/&#9733;|★/g) || []).length,
    globalRank: number(/href="\/ratings\/all">\s*<strong>\s*(\d+)\s*<\/strong>/),
    countryRank: number(/href="\/ratings\/all\?filterBy=Country[^"]*">\s*<strong>\s*(\d+)\s*<\/strong>/),
    contests: number(/Contests Participated: <b>(\d+)<\/b>/) ?? history.length,
    solved: number(/Total Problems Solved: (\d+)/),
    history: history.map(h => ({ date: h.end_date.slice(0, 10), rating: Number(h.rating), name: h.name })),
    calendar,
  };
}

async function geeksforgeeks(handle) {
  const html = await request(`https://www.geeksforgeeks.org/user/${handle}/`, {}, 'text');
  // The profile data is embedded in the page as escaped JSON: \"score\":12
  const field = name => { const m = html.match(new RegExp(`\\\\?"${name}\\\\?":\\s*(\\d+)`)); return m ? Number(m[1]) : null };
  if (field('total_problems_solved') == null) throw new Error(`GeeksforGeeks user ${handle} not found`);
  const rank = html.match(/\\?"institute_rank\\?":\s*\\?"?(\d+)/)?.[1];
  return {
    url: `https://www.geeksforgeeks.org/user/${handle}/`,
    solved: field('total_problems_solved'),
    score: field('score'),
    monthlyScore: field('monthly_score'),
    instituteRank: rank ? Number(rank) : null,
    potdStreak: field('pod_solved_longest_streak'),
  };
}

async function hackerrank(handle) {
  const base = `https://www.hackerrank.com/rest/hackers/${handle}`;
  const badges = (await request(`${base}/badges`)).models || [];
  const history = await request(`${base}/submission_histories`).catch(() => ({}));
  return {
    url: `https://www.hackerrank.com/profile/${handle}`,
    solved: badges.reduce((n, b) => n + (b.solved || 0), 0),
    stars: badges.reduce((n, b) => n + (b.stars || 0), 0),
    badgeList: badges.map(b => ({ name: b.badge_name, stars: b.stars || 0, solved: b.solved || 0 })),
    calendar: Object.fromEntries(Object.entries(history).map(([d, n]) => [d, Number(n)])),
  };
}

const fetchers = { github, leetcode, codeforces, codechef, geeksforgeeks, hackerrank };
const handles = JSON.parse(await readFile(profilesFile, 'utf8'));
const previous = await readFile(outputFile, 'utf8').then(JSON.parse).catch(() => ({ platforms: {} }));
const platforms = {};
let failures = 0;
const yearAgo = new Date(Date.now() - 371 * 864e5).toISOString().slice(0, 10);

for (const [id, fetcher] of Object.entries(fetchers)) {
  const handle = String(handles[id] || '').trim();
  if (!handle) continue;
  try {
    const data = await fetcher(handle);
    if (data.calendar) data.calendar = Object.fromEntries(Object.entries(data.calendar).filter(([date]) => date >= yearAgo).sort());
    platforms[id] = { handle, updatedAt: new Date().toISOString(), ...data };
    console.log(`✓ ${id}: ${handle}`);
  } catch (err) {
    failures++;
    const old = previous.platforms?.[id];
    platforms[id] = old?.handle === handle ? { ...old, stale: true } : { handle, error: String(err.message || err) };
    console.warn(`✗ ${id}: ${err.message}${old?.handle === handle ? ' (kept previous data)' : ''}`);
  }
}

await writeFile(outputFile, JSON.stringify({ generatedAt: new Date().toISOString(), platforms }, null, 1) + '\n');
console.log(`Wrote ${outputFile.pathname} (${Object.keys(platforms).length} platforms, ${failures} failed)`);
