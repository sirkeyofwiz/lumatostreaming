const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

// TMDB's genre vocabulary is broader than ours — this maps their names to
// the fixed genre list our own catalog uses. Anything unmapped falls back
// to 'Drama'; the admin reviews and can change it before saving anyway.
const GENRE_MAP = {
  'Action': 'Action',
  'Adventure': 'Adventure',
  'Action & Adventure': 'Action',
  'Comedy': 'Comedy',
  'Crime': 'Crime',
  'Documentary': 'Documentary',
  'Drama': 'Drama',
  'Fantasy': 'Fantasy',
  'Sci-Fi & Fantasy': 'Sci-Fi',
  'Science Fiction': 'Sci-Fi',
  'Horror': 'Horror',
  'Mystery': 'Mystery',
  'Romance': 'Romance',
  'Thriller': 'Thriller',
  'War': 'Thriller',
  'War & Politics': 'Thriller',
  'Western': 'Adventure',
  'Animation': 'Drama',
  'Family': 'Drama',
  'Kids': 'Drama',
  'History': 'Drama',
  'Music': 'Drama',
  'News': 'Documentary',
  'Reality': 'Documentary',
  'Soap': 'Drama',
  'Talk': 'Documentary',
  'TV Movie': 'Drama',
};

function mapGenre(tmdbGenres) {
  for (const g of tmdbGenres || []) {
    if (GENRE_MAP[g.name]) return GENRE_MAP[g.name];
  }
  return 'Drama';
}

function apiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw Object.assign(new Error('TMDB is not configured on this server.'), { code: 'NO_TMDB_KEY' });
  return key;
}

async function tmdbGet(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set('api_key', apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`TMDB request failed (${res.status})`), { status: res.status, body });
  }
  return res.json();
}

// type is 'movie' or 'series' (our vocabulary) — mapped to TMDB's 'movie'/'tv'.
function tmdbType(ourType) {
  return ourType === 'series' ? 'tv' : 'movie';
}

async function search(query, ourType) {
  const t = tmdbType(ourType);
  const data = await tmdbGet(`/search/${t}`, { query, include_adult: 'false' });
  return (data.results || []).slice(0, 12).map(r => ({
    tmdbId: r.id,
    type: ourType,
    title: t === 'tv' ? r.name : r.title,
    year: (t === 'tv' ? r.first_air_date : r.release_date || '').slice(0, 4) || null,
    posterUrl: r.poster_path ? IMG_BASE + r.poster_path : null,
    overview: r.overview,
  }));
}

async function details(tmdbId, ourType) {
  const t = tmdbType(ourType);
  const data = await tmdbGet(`/${t}/${tmdbId}`, { append_to_response: 'credits' });

  const cast = (data.credits && data.credits.cast || []).slice(0, 4).map(c => c.name).join(', ');
  let director;
  if (t === 'movie') {
    const d = (data.credits && data.credits.crew || []).find(c => c.job === 'Director');
    director = d ? d.name : '';
  } else {
    director = (data.created_by || []).map(c => c.name).join(', ');
  }

  return {
    tmdbId: Number(tmdbId),
    title: t === 'tv' ? data.name : data.title,
    type: ourType,
    year: Number((t === 'tv' ? data.first_air_date : data.release_date || '').slice(0, 4)) || new Date().getFullYear(),
    genre: mapGenre(data.genres),
    runtime: t === 'movie' && data.runtime ? `${Math.floor(data.runtime / 60)}h ${data.runtime % 60}m` : null,
    seasons: t === 'tv' ? (data.number_of_seasons || 1) : null,
    rating: Math.round((data.vote_average || 0) * 10) / 10,
    description: data.overview || '',
    cast: cast || 'Not listed',
    director: director || 'Not listed',
    posterUrl: data.poster_path ? IMG_BASE + data.poster_path : null,
    backdropUrl: data.backdrop_path ? BACKDROP_BASE + data.backdrop_path : null,
  };
}

async function seasonEpisodes(tmdbId, seasonNumber) {
  const data = await tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}`);
  return (data.episodes || []).map(e => ({
    episode_number: e.episode_number,
    name: e.name,
    description: e.overview || null,
  }));
}

module.exports = { search, details, seasonEpisodes };
