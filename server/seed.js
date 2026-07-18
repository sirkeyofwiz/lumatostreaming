const bcrypt = require('bcryptjs');
const db = require('./db');

const titles = [
  { title: 'Hollow Coast', type: 'movie', year: 2026, genre: 'Thriller', runtime: '2h 04m', seasons: null, rating: 8.4, premium: 1,
    description: 'A lighthouse keeper on a storm-cut peninsula finds a survivor who insists the town evacuated a decade ago.',
    cast: 'Nora Villette, Idris Aman, Beck Solano', director: 'M. Okafor', palette: 0, featured: 1 },
  { title: 'The Long Dusk', type: 'movie', year: 2026, genre: 'Drama', runtime: '1h 58m', seasons: null, rating: 7.9, premium: 0,
    description: 'Two estranged sisters drive their late father\'s truck across three states to fulfil his last request.',
    cast: 'Priya Chandran, Elle Marsh', director: 'J. Halvorsen', palette: 1, featured: 0 },
  { title: 'Copper Nights', type: 'movie', year: 2025, genre: 'Crime', runtime: '2h 11m', seasons: null, rating: 8.1, premium: 1,
    description: 'A retired locksmith is pulled back into one final job when his old crew resurfaces with a grudge.',
    cast: 'Dorian Cato, Fen Ishikawa', director: 'R. Duval', palette: 2, featured: 0 },
  { title: 'Static Bloom', type: 'movie', year: 2026, genre: 'Sci-Fi', runtime: '2h 15m', seasons: null, rating: 7.6, premium: 0,
    description: 'When plant life begins transmitting radio signals, a botanist has ninety-six hours to decode a warning.',
    cast: 'Kwame Osei, Lina Aster', director: 'S. Novak', palette: 3, featured: 0 },
  { title: 'Paper Lanterns', type: 'movie', year: 2025, genre: 'Romance', runtime: '1h 47m', seasons: null, rating: 8.0, premium: 0,
    description: 'A festival photographer and a reluctant lantern-maker keep crossing paths across one long summer.',
    cast: 'Mei Solheim, Tobias Reyn', director: 'A. Ferreira', palette: 4, featured: 0 },
  { title: 'Iron Meridian', type: 'movie', year: 2026, genre: 'Action', runtime: '2h 20m', seasons: null, rating: 8.7, premium: 1,
    description: 'A cargo pilot smuggling more than she realizes has to outrun three governments and her own crew.',
    cast: 'Sable Renn, Marcus Oyelaran', director: 'K. Bergstrom', palette: 5, featured: 1 },
  { title: 'Salt and Ember', type: 'movie', year: 2025, genre: 'Drama', runtime: '1h 52m', seasons: null, rating: 7.5, premium: 0,
    description: 'A wildfire crew\'s newest recruit is hiding the reason she transferred out of her last unit.',
    cast: 'Odalys Ferreira, Jun Park', director: 'T. Whitlock', palette: 6, featured: 0 },
  { title: 'Amber Line', type: 'movie', year: 2026, genre: 'Adventure', runtime: '1h 55m', seasons: null, rating: 7.4, premium: 0,
    description: 'A disgraced cartographer bets everything on a rumored trade route that isn\'t on any map.',
    cast: 'Halden Cruz, Ines Moragas', director: 'P. Adeyemi', palette: 7, featured: 0 },
  { title: 'Nightjar', type: 'movie', year: 2026, genre: 'Horror', runtime: '1h 41m', seasons: null, rating: 7.9, premium: 1,
    description: 'A sound engineer restoring old field recordings starts hearing something that was never on the tape.',
    cast: 'Greta Solum, Aidan Boyle', director: 'C. Marchetti', palette: 0, featured: 0 },
  { title: 'Cobalt Run', type: 'movie', year: 2026, genre: 'Action', runtime: '2h 02m', seasons: null, rating: 8.1, premium: 0,
    description: 'A courier network built on trust starts eating itself when a shipment goes missing on the Cobalt Run.',
    cast: 'Rhea Bissette, Tomas Lindqvist', director: 'D. Achebe', palette: 1, featured: 0 },
  { title: 'Quiet Harbor', type: 'movie', year: 2026, genre: 'Drama', runtime: '1h 49m', seasons: null, rating: 7.6, premium: 0,
    description: 'A harbor town\'s only doctor weighs whether to stay after the ferry line that sustains it is cancelled.',
    cast: 'Noemi Vasko, Elias Thorne', director: 'B. Nakamura', palette: 2, featured: 0 },
  { title: 'The Understudy', type: 'movie', year: 2026, genre: 'Comedy', runtime: '1h 38m', seasons: null, rating: 7.3, premium: 0,
    description: 'A second-string actor gets one disastrous night to prove he can carry the lead role.',
    cast: 'Ferdie Okonkwo, Ana Bregović', director: 'L. Farrow', palette: 3, featured: 0 },
  { title: 'Field Notes', type: 'movie', year: 2026, genre: 'Documentary', runtime: '1h 33m', seasons: null, rating: 8.5, premium: 1,
    description: 'Three seasons embedded with a migratory beekeeping family following the bloom across a continent.',
    cast: 'Featuring the Okoye family', director: 'V. Talvinen', palette: 4, featured: 0 },
  { title: 'Rust Belt', type: 'movie', year: 2026, genre: 'Crime', runtime: '2h 06m', seasons: null, rating: 7.8, premium: 0,
    description: 'A closed steel town becomes the last stop for a courier hiding something worth more than the mill ever was.',
    cast: 'Delia Kowalczyk, Omar Siregar', director: 'H. Vance', palette: 5, featured: 0 },

  { title: 'Glasshouse', type: 'series', year: 2026, genre: 'Drama', runtime: null, seasons: 2, rating: 8.6, premium: 1,
    description: 'A transparent-walled biotech campus hides a very opaque power struggle among its four founders.',
    cast: 'Junie Alvarado, Marcel Osei, Priya Chandran', director: 'Created by R. Duval', palette: 6, featured: 1 },
  { title: 'Nine Rivers', type: 'series', year: 2025, genre: 'Fantasy', runtime: null, seasons: 1, rating: 8.2, premium: 0,
    description: 'Nine villages, one shared river god, and a drought that is forcing all of them to break tradition.',
    cast: 'Kaia Solberg, Emeka Nwosu', director: 'Created by A. Ferreira', palette: 7, featured: 0 },
  { title: 'The Foundry', type: 'series', year: 2023, genre: 'Crime', runtime: null, seasons: 4, rating: 8.9, premium: 1,
    description: 'A forensic accountant follows one shell company and ends up unraveling half the city council.',
    cast: 'Dorian Cato, Nora Villette', director: 'Created by K. Bergstrom', palette: 0, featured: 0 },
  { title: 'Wire and Bone', type: 'series', year: 2026, genre: 'Sci-Fi', runtime: null, seasons: 1, rating: 7.8, premium: 0,
    description: 'A veterinarian for decommissioned combat robots discovers one of her patients remembers too much.',
    cast: 'Lina Aster, Beck Solano', director: 'Created by S. Novak', palette: 1, featured: 0 },
  { title: 'Low Tide', type: 'series', year: 2024, genre: 'Mystery', runtime: null, seasons: 3, rating: 8.3, premium: 0,
    description: 'Every year the tide uncovers a shipwreck, and every year someone in town goes missing looking for it.',
    cast: 'Tobias Reyn, Odalys Ferreira', director: 'Created by C. Marchetti', palette: 2, featured: 0 },
  { title: 'Marble Court', type: 'series', year: 2026, genre: 'Drama', runtime: null, seasons: 1, rating: 7.7, premium: 1,
    description: 'A first-year clerk at the country\'s oldest appellate court learns the law is the least of it.',
    cast: 'Ines Moragas, Fen Ishikawa', director: 'Created by T. Whitlock', palette: 3, featured: 0 },
  { title: 'Split Signal', type: 'series', year: 2025, genre: 'Thriller', runtime: null, seasons: 2, rating: 8.0, premium: 0,
    description: 'A late-night radio host starts receiving calls that reference crimes before they happen.',
    cast: 'Aidan Boyle, Greta Solum', director: 'Created by D. Achebe', palette: 4, featured: 0 },
  { title: 'Second Harvest', type: 'series', year: 2026, genre: 'Drama', runtime: null, seasons: 1, rating: 7.9, premium: 0,
    description: 'Four strangers inherit a failing vineyard together and have one season to decide if they keep it.',
    cast: 'Elle Marsh, Halden Cruz', director: 'Created by B. Nakamura', palette: 5, featured: 0 },
  { title: 'Cipher Row', type: 'series', year: 2026, genre: 'Crime', runtime: null, seasons: 1, rating: 8.4, premium: 1,
    description: 'A retired codebreaker is dragged back in when her own decades-old cipher resurfaces in a live case.',
    cast: 'Rhea Bissette, Elias Thorne', director: 'Created by P. Adeyemi', palette: 6, featured: 0 },
  { title: 'Coastal Static', type: 'series', year: 2026, genre: 'Mystery', runtime: null, seasons: 1, rating: 7.6, premium: 0,
    description: 'A small AM station keeps picking up a distress call from a ship that sank thirty years ago.',
    cast: 'Ana Bregović, Tomas Lindqvist', director: 'Created by H. Vance', palette: 7, featured: 0 },
];

async function run() {
  await db.ready();

  await db.exec('DELETE FROM watchlist');
  await db.exec('DELETE FROM titles');
  await db.exec('DELETE FROM users');

  for (const t of titles) {
    await db.run(
      `INSERT INTO titles (title, type, year, genre, runtime, seasons, rating, premium, description, cast, director, palette, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.title, t.type, t.year, t.genre, t.runtime, t.seasons, t.rating, t.premium, t.description, t.cast, t.director, t.palette, t.featured]
    );
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(adminPassword, 10);
  await db.run(
    `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)`,
    ['admin', hash, 1]
  );

  console.log(`Seeded ${titles.length} titles.`);
  console.log(`Created admin user -> username: admin  password: ${adminPassword}`);
  console.log(`(Set SEED_ADMIN_PASSWORD before seeding to choose your own password.)`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
