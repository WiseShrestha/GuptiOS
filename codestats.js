'use strict';
// Code Stats: one window for every coding profile, in the spirit of a
// multi-platform tracker. Reads coding-stats.json, which the daily GitHub
// Action (scripts/fetch-coding-stats.mjs) rebuilds from coding-profiles.json.

const codePlatforms = {
  github: { name: 'GitHub', short: 'GH', color: '#24292f', kind: 'dev' },
  leetcode: { name: 'LeetCode', short: 'LC', color: '#d8901a', kind: 'cp' },
  codeforces: { name: 'Codeforces', short: 'CF', color: '#1f73b7', kind: 'cp' },
  codechef: { name: 'CodeChef', short: 'CC', color: '#7b4a26', kind: 'cp' },
};
let codeStatsRequest = null, chartWidth = 560;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function loadCodeStats(force = false) {
  if (!codeStatsRequest || force) {
    codeStatsRequest = fetch('coding-stats.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('Snapshot not found'); return r.json() })
      .catch(err => { codeStatsRequest = null; throw err });
  }
  return codeStatsRequest;
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (!Number.isFinite(mins)) return 'unknown';
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function mergeCalendars(list) {
  const out = {};
  list.forEach(cal => Object.entries(cal || {}).forEach(([d, n]) => { out[d] = (out[d] || 0) + n }));
  return out;
}

function streaks(calendar) {
  const today = new Date();
  let best = 0, run = 0, current = 0, active = 0;
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if (calendar[isoDay(d)]) { run++; active++; best = Math.max(best, run) } else run = 0;
  }
  // A streak still counts if today has no activity yet.
  current = run;
  if (!current) {
    const y = new Date(today); y.setDate(today.getDate() - 1);
    for (let d = y; calendar[isoDay(d)]; d.setDate(d.getDate() - 1)) current++;
  }
  return { best, current, active };
}

function heatmap(calendar, unit, color = 'green') {
  const today = new Date(), start = new Date(today);
  start.setDate(today.getDate() - 364 - today.getDay());
  const values = Object.values(calendar).filter(Boolean).sort((a, b) => a - b);
  const q = p => values[Math.floor((values.length - 1) * p)] || 1;
  const steps = [q(.25), q(.5), q(.8)];
  const level = n => !n ? 0 : n <= steps[0] ? 1 : n <= steps[1] ? 2 : n <= steps[2] ? 3 : 4;
  let cells = '', months = '', lastMonth = -1, col = 0;
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) {
      col++;
      if (d.getMonth() !== lastMonth && d.getDate() <= 7) { months += `<span style="grid-column:${col}">${d.toLocaleDateString('en-US', { month: 'short' })}</span>`; lastMonth = d.getMonth() }
    }
    const key = isoDay(d), n = calendar[key] || 0;
    const label = `${n || 'No'} ${unit}${n === 1 ? '' : 's'} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    cells += `<i class="lv${level(n)}" style="grid-column:${col};grid-row:${d.getDay() + 1}" title="${label}"></i>`;
  }
  return `<div class="heat-${color}"><div class="heatmap-scroll"><div class="heatmap" style="--cols:${col}"><div class="heat-months">${months}</div><div class="heat-days"><span>Mon</span><span>Wed</span><span>Fri</span></div><div class="heat-grid" role="img" aria-label="Activity over the last year">${cells}</div></div></div>
  <div class="heat-legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="lv${l}"></i>`).join('')}<span>More</span></div></div>`;
}

function ratingChart(series) {
  const lines = series.filter(s => s.history?.length);
  if (!lines.length) return '<div class="code-empty-note">No rated contests yet.</div>';
  const points = lines.flatMap(s => s.history.map(h => ({ t: +new Date(h.date), r: h.rating })));
  const t0 = Math.min(...points.map(p => p.t)), t1 = Math.max(...points.map(p => p.t)) || t0 + 1;
  let lo = Math.min(...points.map(p => p.r)), hi = Math.max(...points.map(p => p.r));
  const padR = Math.max(50, (hi - lo) * .12); lo = Math.max(0, Math.floor((lo - padR) / 100) * 100); hi = Math.ceil((hi + padR) / 100) * 100;
  const W = chartWidth, H = 200, L = 42, R = 10, T = 10, B = 24;
  const x = t => L + (t1 === t0 ? (W - L - R) / 2 : (t - t0) / (t1 - t0) * (W - L - R));
  const y = r => T + (1 - (r - lo) / (hi - lo)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(lo + (hi - lo) * i / 4));
  const years = [...new Set(points.map(p => new Date(p.t).getFullYear()))];
  const yearStep = Math.ceil(years.length / 6);
  return `<svg class="rating-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contest rating history">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
    ${years.filter((_, i) => i % yearStep === 0).map(yr => { const t = Math.max(t0, +new Date(yr, 0, 1)); return `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${yr}</text>` }).join('')}
    ${lines.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${s.history.map(h => `${x(+new Date(h.date)).toFixed(1)},${y(h.rating).toFixed(1)}`).join(' ')}"/>
      ${s.history.map(h => `<rect x="${(x(+new Date(h.date)) - 2.5).toFixed(1)}" y="${(y(h.rating) - 2.5).toFixed(1)}" width="5" height="5" fill="${s.color}"><title>${esc(s.name)} · ${h.rating} · ${esc(h.name)} (${h.date})</title></rect>`).join('')}`).join('')}
  </svg>${lines.length > 1 ? `<div class="chart-key">${lines.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>` : ''}`;
}

function barList(items, unit = '') {
  if (!items?.length) return '<div class="code-empty-note">Nothing to show yet.</div>';
  const max = Math.max(...items.map(i => i.count));
  return `<ul class="code-bars">${items.map(i => `<li><span class="bar-name">${esc(i.name)}</span><span class="bar-track inset"><b style="width:${Math.max(4, i.count / max * 100)}%"></b></span><span class="bar-count">${fmt(i.count)}${unit}</span></li>`).join('')}</ul>`;
}

const maxRating = d => d.maxRating ?? (Math.max(0, ...(d.history || []).map(h => h.rating)) || null);
const tile = (label, value, note = '') => `<div class="code-tile inset"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
const panel = (title, body, extra = '') => `<section class="code-panel"><div class="code-panel-title"><h2>${title}</h2>${extra}</div>${body}</section>`;

function difficulty(lc) {
  const rows = [['Easy', 'easy', '#3d8b5a'], ['Medium', 'medium', '#c48a17'], ['Hard', 'hard', '#b5473a']];
  return `<div class="difficulty">${rows.map(([label, key, color]) => {
    const solved = lc.solved[key] || 0, total = lc.available?.[key] || solved || 1;
    const blocks = Math.round(solved / total * 20);
    return `<div class="diff-row"><span class="diff-name" style="color:${color}">${label}</span><span class="diff-meter inset" aria-label="${solved} of ${total}">${Array.from({ length: 20 }, (_, i) => `<i${i < blocks ? ` style="background:${color}"` : ''}></i>`).join('')}</span><span class="diff-count"><b>${solved}</b> / ${fmt(total)}</span></div>`;
  }).join('')}</div>`;
}

function overview(data) {
  const p = data.platforms, ok = id => p[id] && !p[id].error;
  const cp = ['leetcode', 'codeforces', 'codechef'].filter(ok);
  const solved = cp.reduce((n, id) => n + (id === 'leetcode' ? p[id].solved.total : p[id].solved || 0), 0);
  const contests = cp.reduce((n, id) => n + (p[id].contests || 0), 0);
  const cal = mergeCalendars(cp.map(id => p[id].calendar));
  const s = streaks(cal);
  const best = cp.map(id => ({ id, r: p[id].rating })).filter(x => x.r).sort((a, b) => b.r - a.r)[0];
  let html = '';
  html += panel('Problem solving', cp.length ? `
    <div class="code-tiles">${tile('Questions solved', fmt(solved), cp.map(id => codePlatforms[id].short).join(' + '))}${tile('Active days', fmt(s.active), 'last 365 days')}${tile('Contests', fmt(contests), 'rated rounds')}${tile('Best rating', best ? fmt(best.r) : '—', best ? codePlatforms[best.id].name : 'unrated')}</div>
    ${heatmap(cal, 'submission')}
    <div class="streak-line"><span>Current streak <b>${s.current}</b> day${s.current === 1 ? '' : 's'}</span><span>Longest streak <b>${s.best}</b> day${s.best === 1 ? '' : 's'}</span></div>`
    : `<div class="code-empty">${icon('trophy')}<div><b>No judges connected yet.</b><p>LeetCode, Codeforces and CodeChef stats will appear here once their handles are added to <code>coding-profiles.json</code>.</p></div></div>`);
  if (cp.length) {
    html += `<div class="code-columns">`;
    if (ok('leetcode')) html += panel('Problems by difficulty', difficulty(p.leetcode), '<span>LEETCODE</span>');
    html += panel('Contest ratings', `<ul class="rating-list">${cp.map(id => `<li><span class="plat-dot" style="background:${codePlatforms[id].color}"></span><span>${codePlatforms[id].name}</span><b>${fmt(p[id].rating)}</b><small>max ${fmt(maxRating(p[id]))}</small></li>`).join('')}</ul>`);
    html += `</div>`;
    const topics = (p.leetcode?.topics?.length ? p.leetcode.topics : p.codeforces?.topics) || [];
    if (topics.length) html += panel('Strongest topics', barList(topics.slice(0, 8)), `<span>${p.leetcode?.topics?.length ? 'LEETCODE' : 'CODEFORCES'}</span>`);
    html += panel('Rating journey', ratingChart(cp.map(id => ({ ...codePlatforms[id], history: p[id].history }))));
  }
  if (ok('github')) {
    const g = p.github;
    html += panel('Development', `<div class="code-tiles">${tile('Contributions', fmt(g.contributions), 'last 12 months')}${tile('Public repos', fmt(g.publicRepos))}${tile('Stars earned', fmt(g.stars))}${tile('Followers', fmt(g.followers))}</div>${heatmap(g.calendar, 'contribution', 'blue')}`, '<span>GITHUB</span>');
  }
  return html;
}

function platformPage(id, d) {
  const meta = codePlatforms[id];
  const head = `<header class="plat-head" style="--plat:${meta.color}"><span class="plat-badge">${meta.short}</span><div><div class="eyebrow">${meta.name}${d.stale ? ' · showing last saved data' : ''}</div><h2>@${esc(d.handle)}</h2></div><a class="bevel button" href="${esc(d.url)}" target="_blank" rel="noopener">Open profile ↗</a></header>`;
  if (d.error) return head + `<div class="code-empty">${icon('power')}<div><b>Couldn’t load this profile.</b><p>${esc(d.error)}</p></div></div>`;
  let body = '';
  if (id === 'github') {
    body += `<div class="code-tiles">${tile('Contributions', fmt(d.contributions), 'last 12 months')}${tile('Public repos', fmt(d.publicRepos))}${tile('Stars', fmt(d.stars))}${tile('Followers', fmt(d.followers))}</div>`;
    body += panel('Contribution graph', heatmap(d.calendar, 'contribution', 'blue'));
    body += `<div class="code-columns">${panel('Languages', barList(d.languages, ' repos'))}${panel('Recently pushed', `<ul class="repo-list">${d.repos.map(r => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a><small>${esc(r.language)}${r.stars ? ` · ★ ${r.stars}` : ''}</small>${r.description ? `<p>${esc(r.description)}</p>` : ''}</li>`).join('')}</ul>`)}</div>`;
  } else {
    const s = streaks(d.calendar || {});
    if (id === 'leetcode') body += `<div class="code-tiles">${tile('Solved', fmt(d.solved.total), `of ${fmt(d.available?.all)}`)}${tile('Contest rating', fmt(d.rating), d.topPercentage != null ? `top ${d.topPercentage}%` : 'unrated')}${tile('Contests', fmt(d.contests))}${tile('Global rank', fmt(d.ranking))}</div>${panel('Problems by difficulty', difficulty(d))}`;
    if (id === 'codeforces') body += `<div class="code-tiles">${tile('Rating', fmt(d.rating), esc(d.rank))}${tile('Max rating', fmt(d.maxRating), esc(d.maxRank))}${tile('Solved', fmt(d.solved), 'unique problems')}${tile('Contests', fmt(d.contests))}</div>`;
    if (id === 'codechef') body += `<div class="code-tiles">${tile('Rating', fmt(d.rating), d.stars ? '★'.repeat(d.stars) : 'unrated')}${tile('Highest', fmt(d.maxRating))}${tile('Solved', fmt(d.solved))}${tile('Contests', fmt(d.contests), d.globalRank ? `global #${fmt(d.globalRank)}` : '')}</div>`;
    body += panel('Submissions', heatmap(d.calendar || {}, 'submission') + `<div class="streak-line"><span>Active days <b>${s.active}</b></span><span>Current streak <b>${s.current}</b></span><span>Longest streak <b>${s.best}</b></span></div>`);
    body += panel('Rating history', ratingChart([{ ...meta, history: d.history }]));
    if (d.topics?.length) body += panel('Topics', barList(d.topics.slice(0, 10)));
    if (d.badges?.length) body += panel('Badges', `<div class="profile-interests">${d.badges.map(b => `<span>${esc(b)}</span>`).join('')}</div>`);
  }
  return head + body;
}

async function setupCodeStats(win, force = false) {
  const view = win.querySelector('#code-view'), tabs = win.querySelector('#code-tabs'), status = win.querySelector('.window-status span');
  view.innerHTML = `<div class="code-loading"><div class="boot-progress"><i></i></div>Dialing up your profiles…</div>`;
  let data;
  try { data = await loadCodeStats(force) } catch {
    view.innerHTML = `<div class="code-empty">${icon('power')}<div><b>No stats snapshot found.</b><p>Run <code>node scripts/fetch-coding-stats.mjs</code> or the “Coding stats” GitHub Action to create <code>coding-stats.json</code>.</p><button class="bevel button" id="code-retry">Try again</button></div></div>`;
    view.querySelector('#code-retry').onclick = () => setupCodeStats(win, true);
    return;
  }
  const ids = Object.keys(codePlatforms);
  const connected = ids.filter(id => data.platforms[id]);
  tabs.innerHTML = ['overview', ...ids].map(id => {
    const d = data.platforms[id], led = id === 'overview' ? '' : `<span class="tab-led ${!d ? 'off' : d.error ? 'err' : d.stale ? 'stale' : ''}"></span>`;
    return `<button role="tab" data-code-tab="${id}" aria-selected="false"${id !== 'overview' && !d ? ' disabled title="Not connected"' : ''}>${led}${id === 'overview' ? 'Overview' : codePlatforms[id].name}</button>`;
  }).join('');
  const show = id => {
    tabs.querySelectorAll('[data-code-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.codeTab === id)));
    chartWidth = Math.max(280, Math.min(1100, view.clientWidth - 46));
    view.innerHTML = id === 'overview' ? overview(data) : platformPage(id, data.platforms[id]);
    view.querySelectorAll('.heatmap-scroll').forEach(el => { el.scrollLeft = el.scrollWidth });
    win.querySelector('.window-body').scrollTop = 0;
  };
  tabs.querySelectorAll('[data-code-tab]').forEach(b => b.onclick = () => { clickSound(); show(b.dataset.codeTab) });
  win.querySelector('#code-accounts').innerHTML = ids.map(id => {
    const d = data.platforms[id];
    return `<li><span class="plat-badge small" style="--plat:${codePlatforms[id].color}">${codePlatforms[id].short}</span><span>${codePlatforms[id].name}<small>${d ? '@' + esc(d.handle) : 'Not connected'}</small></span><span class="tab-led ${!d ? 'off' : d.error ? 'err' : d.stale ? 'stale' : ''}"></span></li>`;
  }).join('');
  if (status) status.textContent = `${connected.length} of ${ids.length} accounts connected · Synced ${timeAgo(data.generatedAt)}`;
  show('overview');
}
