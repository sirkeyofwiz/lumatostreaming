// Search engines: a page per title (/title/123-name) with its own title,
// description, preview image and structured data; a "Browse all titles"
// list in every page's footer so crawlers can find each title; and
// sitemap.xml / robots.txt. The site itself still runs as one page — these
// are the same index.html with the right details filled in on the server.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const SITE_URL = (process.env.SITE_URL || 'https://lumatostreaming.site').replace(/\/$/, '');
const SITE_NAME = 'LumatoStreaming';
const SWAHILI = 'Movie zilizotafsiriwa';
const INDEX_FILE = path.join(__dirname, '..', 'public', 'index.html');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Same rule as the site's titlePath() in app.js.
function slugify(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'title';
}
function titlePath(t) {
  return `/title/${t.id}-${slugify(t.title)}`;
}

function absolute(url) {
  if (!url) return null;
  return /^https?:\/\//.test(url) ? url : `${SITE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function trimText(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

// ---------- Caches ----------
// index.html is read once (it only changes with a deploy); the catalog is
// re-read at most every 5 minutes so new titles appear without a restart.
let template = null;
function indexHtml() {
  if (!template || process.env.NODE_ENV !== 'production') template = fs.readFileSync(INDEX_FILE, 'utf8');
  return template;
}

let catalog = { at: 0, titles: [] };
async function allTitles() {
  if (Date.now() - catalog.at < 5 * 60 * 1000) return catalog.titles;
  const titles = await db.all('SELECT id, title, type, year, genre, rating, description, "cast", director, seasons, runtime, poster_url, backdrop_url FROM titles ORDER BY title');
  catalog = { at: Date.now(), titles };
  return titles;
}
function forgetCatalog() {
  catalog.at = 0;
}

// ---------- Building a page ----------

function replaceMeta(html, { title, description, url, image, imageAlt, type, robots, jsonLd, body, footer }) {
  const set = (re, value) => { html = html.replace(re, value); };
  set(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  set(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`);
  set(/<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="${esc(type)}">`);
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`);
  set(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  set(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`);
  if (image) {
    // A title's own picture has unknown dimensions, so drop the fixed ones.
    set(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(image)}">`);
    set(/<meta property="og:image:type" content="[^"]*">\s*/, '');
    set(/<meta property="og:image:width" content="[^"]*">\s*/, '');
    set(/<meta property="og:image:height" content="[^"]*">\s*/, '');
    set(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${esc(imageAlt)}">`);
  }
  const head = [
    `<link rel="canonical" href="${esc(url)}">`,
    robots ? `<meta name="robots" content="${robots}">` : '',
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean).join('\n');
  set('</head>', `${head}\n</head>`);
  if (body) set('<div id="content"></div>', `<div id="content">${body}</div>`);
  if (footer) set(/<footer class="site-footer">/, `<footer class="site-footer">\n${footer}`);
  return html;
}

// Every page's footer: all titles as plain links, grouped. Collapsed so it
// doesn't get in the way; search engines read it either way.
function directory(titles) {
  const group = (label, list) => (list.length ? `
    <div class="seo-dir-group"><h3>${esc(label)}</h3><ul>${list.map((t) => `<li><a href="${titlePath(t)}">${esc(t.title)}</a></li>`).join('')}</ul></div>` : '');
  const swahili = titles.filter((t) => t.genre === SWAHILI);
  const rest = titles.filter((t) => t.genre !== SWAHILI);
  return `<details class="seo-dir">
    <summary>Browse all ${titles.length} titles</summary>
    ${group('Movies', rest.filter((t) => t.type === 'movie'))}
    ${group('TV shows & anime', rest.filter((t) => t.type === 'series'))}
    ${group('Movie zilizotafsiriwa (Swahili)', swahili)}
  </details>`;
}

const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: SITE_NAME, inLanguage: ['en', 'sw'] },
    { '@type': 'Organization', '@id': `${SITE_URL}/#org`, name: SITE_NAME, url: `${SITE_URL}/`, logo: `${SITE_URL}/icons/icon-512.png` },
  ],
};

async function homePage() {
  const titles = await allTitles();
  return replaceMeta(indexHtml(), {
    title: 'LumatoStreaming — Watch Movies, Series & Anime Online',
    description: 'Stream movies, TV series and anime online, including Swahili-translated films (Movie zilizotafsiriwa). Watch free on your phone or computer, or save to watch offline.',
    url: `${SITE_URL}/`,
    type: 'website',
    jsonLd: SITE_JSON_LD,
    footer: directory(titles),
  });
}

async function titlePage(t, episodes) {
  const titles = await allTitles();
  const isSeries = t.type === 'series';
  const swahili = t.genre === SWAHILI;
  const kind = isSeries ? 'Series' : 'Movie';
  const pageTitle = `${t.title}${t.year ? ` (${t.year})` : ''} — Watch ${swahili ? 'Swahili ' : ''}${kind} Online | ${SITE_NAME}`;
  const description = trimText(
    `Watch ${t.title}${t.year ? ` (${t.year})` : ''} online on ${SITE_NAME}${swahili ? ', imetafsiriwa kwa Kiswahili' : ''}. ${t.description || ''}`,
    160
  );
  const url = `${SITE_URL}${titlePath(t)}`;
  const image = absolute(t.backdrop_url || t.poster_url);
  const people = (list) => String(list || '').split(',').map((n) => n.trim()).filter(Boolean).slice(0, 8).map((name) => ({ '@type': 'Person', name }));

  const work = {
    '@type': isSeries ? 'TVSeries' : 'Movie',
    '@id': `${url}#work`,
    name: t.title,
    url,
    description: t.description || undefined,
    image: absolute(t.poster_url || t.backdrop_url) || undefined,
    genre: swahili ? undefined : t.genre,
    inLanguage: swahili ? 'sw' : undefined,
    actor: people(t.cast).length ? people(t.cast) : undefined,
    [isSeries ? 'creator' : 'director']: people(t.director).length ? people(t.director) : undefined,
    datePublished: t.year ? String(t.year) : undefined,
    numberOfSeasons: isSeries && t.seasons ? t.seasons : undefined,
    numberOfEpisodes: isSeries && episodes.length ? episodes.length : undefined,
  };
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      work,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: swahili ? 'Swahili' : isSeries ? 'TV shows' : 'Movies', item: `${SITE_URL}/#${swahili ? 'swahili' : isSeries ? 'shows' : 'movies'}` },
          { '@type': 'ListItem', position: 3, name: t.title, item: url },
        ],
      },
      ...SITE_JSON_LD['@graph'],
    ],
  };

  // What a crawler reads before the site's script draws the page; the script
  // replaces it with the normal home page and opens this title on top.
  const similar = titles.filter((x) => x.id !== t.id && x.genre === t.genre).slice(0, 12);
  const bySeason = new Map();
  for (const ep of episodes) {
    if (!bySeason.has(ep.season_number)) bySeason.set(ep.season_number, []);
    bySeason.get(ep.season_number).push(ep);
  }
  const body = `
    <article class="seo-title">
      <nav class="seo-crumbs"><a href="/">Home</a> › ${esc(swahili ? 'Swahili' : isSeries ? 'TV shows' : 'Movies')}</nav>
      <h1>${esc(t.title)}${t.year ? ` <span>(${esc(t.year)})</span>` : ''}</h1>
      <p class="seo-meta">${[kind, t.genre, isSeries && t.seasons ? `${t.seasons} season${t.seasons > 1 ? 's' : ''}` : t.runtime].filter(Boolean).map(esc).join(' · ')}</p>
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      ${t.cast ? `<p><strong>Cast:</strong> ${esc(t.cast)}</p>` : ''}
      ${t.director ? `<p><strong>${isSeries ? 'Created by' : 'Directed by'}:</strong> ${esc(t.director)}</p>` : ''}
      ${[...bySeason.entries()].map(([season, eps]) => `
        <h2>Season ${esc(season)} episodes</h2>
        <ol>${eps.map((ep) => `<li>${esc(ep.name || `Episode ${ep.episode_number}`)}</li>`).join('')}</ol>`).join('')}
      ${similar.length ? `<h2>More like ${esc(t.title)}</h2><ul>${similar.map((x) => `<li><a href="${titlePath(x)}">${esc(x.title)}</a></li>`).join('')}</ul>` : ''}
    </article>`;

  return replaceMeta(indexHtml(), {
    title: pageTitle, description, url, image, imageAlt: `${t.title} — ${kind.toLowerCase()} poster`,
    type: isSeries ? 'video.tv_show' : 'video.movie', jsonLd, body, footer: directory(titles),
  });
}

async function notFoundPage() {
  return replaceMeta(indexHtml(), {
    title: `Title not found | ${SITE_NAME}`,
    description: 'This title is no longer on LumatoStreaming. Browse movies, series and anime instead.',
    url: `${SITE_URL}/`, type: 'website', robots: 'noindex', jsonLd: SITE_JSON_LD,
    footer: directory(await allTitles()),
  });
}

// ---------- Routes ----------

function routes(app, ah) {
  const sendHtml = (res, html, status = 200) => {
    res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(html);
  };

  app.get(['/', '/index.html'], ah(async (req, res) => {
    await db.ready();
    sendHtml(res, await homePage());
  }));

  app.get('/title/:slug', ah(async (req, res) => {
    await db.ready();
    const id = parseInt(req.params.slug, 10);
    const t = id ? await db.get('SELECT * FROM titles WHERE id = ?', [id]) : null;
    if (!t) return sendHtml(res, await notFoundPage(), 404);
    // Old or mistyped names lead to the one proper address.
    const proper = titlePath(t);
    if (req.path !== proper) return res.redirect(301, proper);
    const episodes = t.type === 'series'
      ? await db.all('SELECT season_number, episode_number, name FROM episodes WHERE title_id = ? ORDER BY season_number, episode_number', [t.id])
      : [];
    sendHtml(res, await titlePage(t, episodes));
  }));

  app.get('/sitemap.xml', ah(async (req, res) => {
    await db.ready();
    const titles = await allTitles();
    const urls = [`<url><loc>${SITE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`]
      .concat(titles.map((t) => `<url><loc>${SITE_URL}${titlePath(t)}</loc><changefreq>weekly</changefreq><priority>0.8</priority>${t.poster_url ? `<image:image><image:loc>${esc(absolute(t.poster_url))}</image:loc></image:image>` : ''}</url>`));
    res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>\n`
    );
  }));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin.html',
      'Disallow: /bulk-upload.html',
      'Disallow: /reset.html',
      'Disallow: /api/',
      '',
      `Sitemap: ${SITE_URL}/sitemap.xml`,
      '',
    ].join('\n'));
  });
}

module.exports = { routes, forgetCatalog, titlePath, slugify };
