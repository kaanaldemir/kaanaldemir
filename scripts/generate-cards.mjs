import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const owner = 'kaanaldemir';
const projects = [
  ['DLSS-Override-For-All-Games', 'pin-dlss-override-for-all-games.svg'],
  ['novideo_srgb', 'pin-novideo-srgb.svg'],
  ['kaanaldemir.github.io', 'pin-kaanaldemir-github-io.svg'],
  ['Custom-Contrast-Stretching-GUI', 'pin-custom-contrast-stretching-gui.svg'],
];
const cardFiles = ['top-langs.svg', 'stats.svg', ...projects.map(([, file]) => file)];
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char]));

// Public REST reads avoid the repository-scoped Actions token's GraphQL limits.
// No credential is needed; this profile currently needs five requests per refresh.
async function github(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kaanaldemir-profile-cards' },
      signal: AbortSignal.timeout(30000),
    });
    if (response.status >= 500 && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
    return response.json();
  }
}

function svg(title, width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">${escape(title)}</title>
  <style>text{font-family:Segoe UI,Ubuntu,Arial,sans-serif;fill:#38bdae}.heading{font-size:18px;font-weight:600;fill:#70a5fd}.label{font-size:12px}.value{font-size:13px;font-weight:600}.muted{font-size:11px;fill:#a9b1d6}</style>
  <rect width="100%" height="100%" rx="5" fill="#1a1b27"/>
${body}
</svg>
`;
}

async function searchCount(type, query) {
  const result = await github(`search/${type}?q=${encodeURIComponent(query)}&per_page=1`);
  if (result.incomplete_results || !Number.isInteger(result.total_count)) {
    throw new Error(`Incomplete GitHub search: ${query}`);
  }
  return result.total_count;
}

function descriptionLines(description) {
  const lines = [];
  let line = '';
  for (const word of (description || '').split(/\s+/)) {
    if (`${line} ${word}`.trim().length > 66 && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).map((text, index) =>
    index === 1 && lines.length > 2 ? `${text.slice(0, 63)}…` : text);
}

function pin(repo) {
  const colors = { Python: '#3572a5', PHP: '#4f5d95', 'C#': '#178600' };
  const description = descriptionLines(repo.description).map((line, index) =>
    `<text x="25" y="${60 + index * 18}" class="label">${escape(line)}</text>`).join('\n');
  return svg(repo.name, 495, 130, `
    <text x="25" y="32" class="heading">${escape(repo.name)}</text>
    ${description}
    <circle cx="30" cy="108" r="6" fill="${colors[repo.language] || '#a9b1d6'}"/>
    <text x="43" y="112" class="label">${escape(repo.language || 'Code')}</text>
    <text x="160" y="112" class="muted">★ ${repo.stargazers_count}</text>
    <text x="225" y="112" class="muted">Forks: ${repo.forks_count}</text>`);
}

export async function generate() {
  const repositories = [];
  for (let page = 1; ; page++) {
    const batch = await github(`users/${owner}/repos?type=owner&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Invalid repository response');
    repositories.push(...batch.filter(repo => !repo.private));
    if (batch.length < 100) break;
  }
  const year = new Date().getUTCFullYear();
  const commits = await searchCount('commits', `author:${owner} committer-date:>=${year}-01-01 committer-date:<=${year}-12-31`);
  const prs = await searchCount('issues', `author:${owner} type:pr is:public`);
  const merged = await searchCount('issues', `author:${owner} type:pr is:merged is:public`);
  const issues = await searchCount('issues', `author:${owner} type:issue is:public`);
  const stars = repositories.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const rows = [
    ['Total stars', stars], [`Public commits (${year})`, commits],
    ['Total pull requests', prs], ['Total issues', issues],
    ['Public repositories', repositories.length], ['Merged pull requests', merged],
    ['Pull requests merged', `${prs ? (merged / prs * 100).toFixed(1) : '0.0'}%`],
  ];
  const cards = new Map();
  cards.set('stats.svg', svg("Kaan's GitHub stats", 300, 285, `
    <text x="20" y="34" class="heading">Kaan's GitHub Stats</text>
    ${rows.map(([label, value], index) => `<text x="20" y="${72 + index * 25}" class="label">${escape(label)}</text><text x="280" y="${72 + index * 25}" text-anchor="end" class="value">${escape(value)}</text>`).join('\n')}
    <text x="20" y="266" class="muted">Public GitHub data</text>`));
  for (const [name, file] of projects) {
    const repo = repositories.find(repo => repo.name === name);
    if (!repo) throw new Error(`Public repository not found: ${owner}/${name}`);
    cards.set(file, pin(repo));
  }
  // Finish every API request before replacing any existing card.
  await mkdir('profile', { recursive: true });
  for (const [file, content] of cards) await writeFile(`profile/${file}`, content);
  console.log(`Generated ${cards.size} cards from public GitHub data.`);
}

export async function validate() {
  for (const file of cardFiles) {
    const content = await readFile(`profile/${file}`, 'utf8');
    if (!/<svg\b/.test(content) || !/<\/svg>/.test(content) ||
        /Something went wrong|Resource not accessible|Repository Not found|data-testid="message"/i.test(content)) {
      throw new Error(`Invalid or error card: profile/${file}`);
    }
  }
  console.log(`Validated all ${cardFiles.length} README cards.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--validate')) await validate();
  else await generate();
}
