# GuptiOS

Shresth Gupta’s personal portfolio, inspired by retro desktop interfaces.

Static HTML, CSS, and JavaScript. No build step is required.

## Code Stats
The **Code Stats** window gathers GitHub, LeetCode, Codeforces and CodeChef
progress in one place: questions solved, streaks, a submission heatmap,
contest ratings, topics and repositories.

1. Put your handles in `coding-profiles.json` (leave a platform empty to hide it).
2. The *Coding stats* GitHub Action (`.github/workflows/coding-stats.yml`) runs
   `scripts/fetch-coding-stats.mjs` daily and commits `coding-stats.json`.
   Run it any time from the Actions tab, or locally with
   `node scripts/fetch-coding-stats.mjs` (Node 18+).

If a platform is unreachable, the previous day's data is kept.

## GitHub Pages
Publish the root of the main branch through Settings → Pages.

## Credits
Book and game cover artwork belongs to its respective owners.
