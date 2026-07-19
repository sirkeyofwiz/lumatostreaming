const ANILIST_URL = 'https://graphql.anilist.co';

function stripHtml(str) {
  return (str || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function gql(query, variables) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`AniList request failed (${res.status})`), { status: res.status, body });
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(json.errors[0].message || 'AniList query error');
  }
  return json.data;
}

// AniList doesn't require an API key for search/media queries against
// public data, so there's no configuration check here the way TMDB needs one.

async function search(query) {
  const gqlQuery = `
    query ($search: String) {
      Page(perPage: 12) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title { romaji english }
          format
          seasonYear
          coverImage { large }
          description(asHtml: false)
        }
      }
    }
  `;
  const data = await gql(gqlQuery, { search: query });
  return (data.Page.media || []).map(m => ({
    anilistId: m.id,
    title: m.title.english || m.title.romaji,
    year: m.seasonYear || null,
    posterUrl: m.coverImage && m.coverImage.large || null,
    overview: stripHtml(m.description).slice(0, 160),
    format: m.format,
  }));
}

async function details(anilistId) {
  const gqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english }
        format
        episodes
        duration
        seasonYear
        averageScore
        description(asHtml: false)
        coverImage { large }
        studios(isMain: true) { nodes { name } }
        characters(sort: ROLE, perPage: 4) { nodes { name { full } } }
      }
    }
  `;
  const data = await gql(gqlQuery, { id: Number(anilistId) });
  const m = data.Media;
  const isMovie = m.format === 'MOVIE';
  const cast = (m.characters.nodes || []).map(n => n.name.full).join(', ');
  const studios = (m.studios.nodes || []).map(s => s.name).join(', ');

  return {
    title: m.title.english || m.title.romaji,
    type: isMovie ? 'movie' : 'series',
    year: m.seasonYear || new Date().getFullYear(),
    genre: 'Donghua/Anime',
    runtime: isMovie && m.duration ? `${Math.floor(m.duration / 60)}h ${m.duration % 60}m` : null,
    seasons: isMovie ? null : 1,
    rating: m.averageScore ? Math.round(m.averageScore) / 10 : 0,
    description: stripHtml(m.description),
    cast: cast || 'Not listed',
    director: studios || 'Not listed',
    posterUrl: m.coverImage && m.coverImage.large || null,
  };
}

module.exports = { search, details };
