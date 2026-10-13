'use strict';
// Tests du collecteur. Lancer avec : node --test tests/*.test.js
// Tout se passe dans un dossier temporaire et sans réseau : les vraies données ne sont jamais touchées.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-test-'));
process.env.VEILLE_DONNEES = path.join(dossier, 'donnees');
process.env.VEILLE_CONFIG = path.join(dossier, 'config.json');
delete process.env.TELEGRAM_JETON;
delete process.env.TELEGRAM_DESTINATAIRE;
fs.mkdirSync(process.env.VEILLE_DONNEES);

const c = require('../collecte');
const F_ARCHIVE = path.join(process.env.VEILLE_DONNEES, 'opportunites.json');
const lireArchive = () => JSON.parse(fs.readFileSync(F_ARCHIVE, 'utf8'));
const brut = (titre, extra = {}) => ({ titre, lien: 'https://exemple.org/a', date: '', categories: [], texte: '', ...extra });

test.after(() => fs.rmSync(dossier, { recursive: true, force: true }));

test('date limite : lue seulement après un mot-clé', () => {
  assert.equal(c.trouverEcheance('Application Deadline: November 16, 2026'), '2026-11-16');
  assert.equal(c.trouverEcheance('Deadline: 03-Jul-2026'), '2026-07-03');
  assert.equal(c.trouverEcheance('Date limite : 1er avril 2027'), '2027-04-01');
  assert.equal(c.trouverEcheance('Applications are open until 26 October 2026.'), '2026-10-26');
  assert.equal(c.trouverEcheance('Candidatures jusqu’au 2026-12-01'), '2026-12-01');
  assert.equal(c.trouverEcheance('Le programme a commencé le 3 mars 2026.'), null, 'une date sans mot-clé n’est pas une échéance');
  assert.equal(c.trouverEcheance('Deadline: 31 février 2026'), null, 'une date impossible est refusée');
});

test('type : déduit du titre', () => {
  const type = titre => c.trouverType(brut(titre), {});
  assert.equal(type('WomanKind Creative Grant 2027'), 'appel');
  assert.equal(type('Business Growth Awards for Young Agripreneurs'), 'concours');
  assert.equal(type('Harvard LEAD Fellowship 2027'), 'bourse');
  assert.equal(type('Fellowships 2027 with Funding for 3 Months'), 'bourse', 'une bourse reste une bourse même si le titre parle de financement');
  assert.equal(type('Youth Ambassador Program 2027'), 'bourse');
  assert.equal(type('PAM Madagascar recrute deux stagiaires'), 'emploi');
  assert.equal(type('Avis d’appel d’offres pour un consultant'), 'marche');
  assert.equal(c.trouverType(brut('Sans indice'), { typeDefaut: 'appel' }), 'appel');
  assert.equal(c.trouverType(brut('Recrutement d’un comptable'), { typeForce: 'marche' }), 'marche');
});

test('éligibilité : Madagascar cité', () => {
  assert.equal(c.trouverEligibilite(brut('Call for NGOs', { texte: 'Open to organisations in Kenya, Madagascar and Malawi.' }), {})[0], 'madagascar');
  assert.equal(c.trouverEligibilite(brut('Appel', { categories: ['Latest Grants and Resources in Madagascar', 'Latest Grants and Resources in Kenya'] }), {})[0], 'madagascar');
  assert.equal(c.trouverEligibilite(brut('Trophée'), { presse: true })[0], 'madagascar');
});

test('éligibilité : autre zone', () => {
  const liste = brut('Apply now', { categories: ['Latest Grants and Resources in Albania', 'Latest Grants and Resources in Kosovo'] });
  assert.equal(c.trouverEligibilite(liste, {})[0], 'autre');
  assert.equal(c.trouverEligibilite(brut('Contest 2026 for young Nigerian agripreneurs'), { zone: 'afrique' })[0], 'autre');
  assert.equal(c.trouverEligibilite(brut('Programme for the Middle East and North Africa'), {})[0], 'autre');
  assert.equal(c.trouverEligibilite(brut('Community Grants Scheme 2027 (United Kingdom)'), {})[0], 'autre');
  assert.equal(c.trouverEligibilite(brut('Fellowship', { categories: ['America', 'Europe'] }), {})[0], 'autre');
  const ailleurs = brut('Recrutement', { lien: 'https://www.lesopportunites.com/opportunite/tchad/avis-de-recrutement/x/' });
  assert.equal(c.trouverEligibilite(ailleurs, { zone: 'pays-url' })[0], 'autre');
});

test('éligibilité : ensembles, monde, doute', () => {
  assert.equal(c.trouverEligibilite(brut('Grant', { texte: 'The call focuses on Least Developed Countries.' }), {})[0], 'ensemble');
  assert.equal(c.trouverEligibilite(brut('Bourse', { texte: 'Ouvert aux pays d’Afrique subsaharienne.' }), {})[0], 'ensemble');
  assert.equal(c.trouverEligibilite(brut('Award', { categories: ['Africa'] }), {})[0], 'ensemble');
  assert.equal(c.trouverEligibilite(brut('Award', { categories: ['Africa', 'America', 'Asia', 'Europe'] }), {})[0], 'mondial');
  assert.equal(c.trouverEligibilite(brut('Prize', { texte: 'Applicants from all countries are welcome.' }), {})[0], 'mondial');
  assert.equal(c.trouverEligibilite(brut('Prize'), { zone: 'afrique' })[0], 'ensemble');
  assert.equal(c.trouverEligibilite(brut('Prize'), {})[0], 'verifier');
  assert.equal(c.trouverEligibilite(brut('Programme for Southern Africa'), {})[0], 'verifier');
});

test('nettoyage du texte', () => {
  assert.equal(c.texte('<p>Bonjour <b>le</b> monde</p><script>alert(1)</script>'), 'Bonjour le monde.');
  assert.equal(c.texte('<![CDATA[Science &#38; Technologie &amp; plus]]>'), 'Science & Technologie & plus');
  assert.equal(c.texte(''), '');
});

test('contenus hostiles : le nettoyage reste rapide', () => {
  const debut = Date.now();
  c.texte('<ins '.repeat(30000));
  c.texte('<'.repeat(200000));
  c.texte('<script>x'.repeat(30000));
  c.LECTEURS.rss(`<rss>${'<item '.repeat(400000)}`);
  c.LECTEURS.rss(`<rss><item>${'<category '.repeat(200000)}</item>`);
  assert.ok(Date.now() - debut < 3000, `a pris ${Date.now() - debut} ms`);
});

test('lecture d’un flux RSS', () => {
  const articles = c.LECTEURS.rss(`<?xml version="1.0"?><rss><channel><title>Flux</title>
    <item><title><![CDATA[Premier &amp; seul]]></title><link>https://exemple.org/un</link>
      <pubDate>Mon, 12 Oct 2026 10:00:00 +0000</pubDate>
      <category><![CDATA[Africa]]></category><category>Grants</category>
      <description><![CDATA[<p>Deadline: 1 December 2026.</p><p>The post Premier appeared first on Site.</p>]]></description></item>
    <item><title>Second</title><link>https://exemple.org/deux</link><description>Texte</description></item>
    </channel></rss>`);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].titre, 'Premier & seul');
  assert.equal(articles[0].lien, 'https://exemple.org/un');
  assert.equal(articles[0].date, 'Mon, 12 Oct 2026 10:00:00 +0000', 'la balise pubDate, en casse mixte, doit être lue');
  assert.deepEqual(articles[0].categories, ['Africa', 'Grants']);
  assert.equal(articles[0].texte, 'Deadline: 1 December 2026.', 'la signature du site est retirée');
  assert.throws(() => c.LECTEURS.rss('<html><body>pas un flux</body></html>'), /illisible/);
  assert.equal(c.LECTEURS.rss(`<rss>${'<item><title>T</title><link>https://exemple.org/x</link></item>'.repeat(500)}</rss>`).length, 200, 'au plus 200 articles par flux');
});

test('doublons : fusion entre sources, la restriction l’emporte', () => {
  const base = { type: 'appel', porteurs: [], themes: [], echeance: '2026-12-01', montant: null, aussiSur: [], score: 50 };
  const a = { ...base, id: 'a', titre: 'Global Climate Innovation Grant 2027 for NGOs', source: 'un', sourceNom: 'Un', eligibilite: 'ensemble', preuve: 'p1', premiereVue: '2026-10-01T00:00:00.000Z' };
  const b = { ...base, id: 'b', titre: 'Global Climate Innovation Grant 2027 for NGOs (Kenya)', source: 'deux', sourceNom: 'Deux', eligibilite: 'autre', preuve: 'p2', premiereVue: '2026-10-02T00:00:00.000Z' };
  const d = { ...base, id: 'd', titre: 'Bourse de recherche en océanographie tropicale', source: 'deux', sourceNom: 'Deux', eligibilite: 'mondial', preuve: 'p3', premiereVue: '2026-10-02T00:00:00.000Z' };
  const sortie = c.dedoublonner([b, d, a]);
  assert.equal(sortie.length, 2);
  const garde = sortie.find(o => o.id === 'a');
  assert.ok(garde, 'la plus ancienne des deux annonces est gardée');
  assert.deepEqual(garde.aussiSur, ['Deux']);
  assert.equal(garde.eligibilite, 'autre');
});

// ---------- Collecte complète, avec un faux réseau ----------

const flux = (n, extra = '') => `<rss><channel>${Array.from({ length: n }, (_, i) =>
  `<item><title>Call for Proposals numero ${i} ${extra}</title><link>https://source.test/${extra}${i}</link>
   <pubDate>${new Date().toUTCString()}</pubDate><description>Open to NGOs in Madagascar. Deadline: 1 December 2027.</description></item>`).join('')}</channel></rss>`;

function fauxReseau(reponses) {
  const appels = [];
  global.fetch = async (url, options = {}) => {
    appels.push({ url, entetes: options.headers || {} });
    assert.ok(!String(url).includes('telegram'), 'aucun message ne doit partir pendant les tests');
    const r = reponses(url, options.headers || {});
    return new Response(r.corps ?? null, { status: r.statut || 200, headers: r.entetes || {} });
  };
  return appels;
}

const config = sources => fs.writeFileSync(process.env.VEILLE_CONFIG, JSON.stringify({ profil: { porteurs: ['associations'] }, sources }));

test('collecte : archive écrite, puis source inchangée non retéléchargée', async () => {
  config([{ id: 'a', nom: 'Source A', type: 'rss', url: 'https://source.test/a' }]);
  let appels = fauxReseau(() => ({ corps: flux(5, 'a'), entetes: { etag: '"v1"', 'last-modified': 'Mon, 12 Oct 2026 10:00:00 GMT' } }));
  let bilan = await c.collecter();
  assert.equal(bilan.total, 5);
  assert.equal(bilan.nouveaux, 5);
  assert.equal(appels[0].entetes['If-None-Match'], undefined, 'première lecture : aucune condition');
  let archive = lireArchive();
  assert.equal(archive.items[0].eligibilite, 'madagascar');
  assert.equal(archive.items[0].echeance, '2027-12-01');
  assert.equal(archive.sources[0].etag, '"v1"');
  assert.ok(!fs.readFileSync(F_ARCHIVE, 'utf8').includes('\n'), 'l’archive est écrite sans indentation');

  appels = fauxReseau((url, entetes) => (entetes['If-None-Match'] === '"v1"' ? { statut: 304 } : { corps: flux(5, 'a') }));
  bilan = await c.collecter();
  assert.equal(appels[0].entetes['If-None-Match'], '"v1"');
  assert.equal(appels[0].entetes['If-Modified-Since'], 'Mon, 12 Oct 2026 10:00:00 GMT');
  assert.equal(bilan.sansChangement, 1);
  assert.equal(bilan.total, 5, 'les annonces déjà archivées restent');
  assert.equal(bilan.nouveaux, 0);
  archive = lireArchive();
  assert.equal(archive.sources[0].ok, true);
  assert.equal(archive.sources[0].inchange, true);
});

test('collecte : un changement de profil force une relecture complète', async () => {
  fs.writeFileSync(process.env.VEILLE_CONFIG, JSON.stringify({ profil: { porteurs: ['jeunes'] }, sources: [{ id: 'a', nom: 'Source A', type: 'rss', url: 'https://source.test/a' }] }));
  const appels = fauxReseau(() => ({ corps: flux(5, 'a'), entetes: { etag: '"v1"' } }));
  await c.collecter();
  assert.equal(appels[0].entetes['If-None-Match'], undefined);
});

test('collecte : une source à rythme lent n’est pas relue avant son délai', async () => {
  config([
    { id: 'a', nom: 'Source A', type: 'rss', url: 'https://source.test/a' },
    { id: 'lente', nom: 'Presse', type: 'rss', url: 'https://source.test/lente', intervalleHeures: 12 },
  ]);
  let appels = fauxReseau(url => ({ corps: flux(3, url.endsWith('lente') ? 'lente' : 'a') }));
  await c.collecter();
  assert.equal(appels.length, 2, 'première fois : les deux sources sont lues');
  appels = fauxReseau(url => ({ corps: flux(3, url.endsWith('lente') ? 'lente' : 'a') }));
  const bilan = await c.collecter();
  assert.deepEqual(appels.map(a => a.url), ['https://source.test/a']);
  assert.equal(bilan.reportees, 1);
  assert.equal(lireArchive().sources.find(s => s.id === 'lente').ok, true, 'l’état précédent de la source est conservé');

  const archive = lireArchive();
  archive.sources.find(s => s.id === 'lente').dernierSucces = new Date(Date.now() - 13 * 3600000).toISOString();
  fs.writeFileSync(F_ARCHIVE, JSON.stringify(archive));
  appels = fauxReseau(url => ({ corps: flux(3, url.endsWith('lente') ? 'lente' : 'a') }));
  await c.collecter();
  assert.equal(appels.length, 2, 'treize heures plus tard, elle est relue');
});

test('collecte : une source en erreur n’empêche pas les autres', async () => {
  config([
    { id: 'a', nom: 'Source A', type: 'rss', url: 'https://source.test/a' },
    { id: 'panne', nom: 'En panne', type: 'rss', url: 'https://source.test/panne' },
  ]);
  fs.rmSync(F_ARCHIVE, { force: true });
  fauxReseau(url => (url.endsWith('panne') ? { statut: 429 } : { corps: flux(4, 'a') }));
  const bilan = await c.collecter();
  assert.equal(bilan.total, 4);
  assert.deepEqual(bilan.sourcesEnErreur, ['En panne : trop de requêtes (429)']);
});

test('collecte : les annonces d’une autre zone ne sont gardées que sept jours', async () => {
  config([{ id: 'a', nom: 'Source A', type: 'rss', url: 'https://source.test/a' }]);
  const archive = lireArchive();
  const modele = archive.items[0];
  const ilYA = jours => new Date(Date.now() - jours * 86400000).toISOString();
  archive.items.push(
    { ...modele, id: 'autre-recente', titre: 'Subvention réservée au Canada, récente', lien: 'https://x.test/1', eligibilite: 'autre', premiereVue: ilYA(3) },
    { ...modele, id: 'autre-ancienne', titre: 'Bourse réservée au Kosovo, ancienne', lien: 'https://x.test/2', eligibilite: 'autre', premiereVue: ilYA(9) },
    { ...modele, id: 'eligible-ancienne', titre: 'Concours ouvert à Madagascar, ancien', lien: 'https://x.test/3', eligibilite: 'madagascar', premiereVue: ilYA(9) },
  );
  fs.writeFileSync(F_ARCHIVE, JSON.stringify(archive));
  fauxReseau(() => ({ corps: flux(4, 'a') }));
  await c.collecter();
  const ids = lireArchive().items.map(o => o.id);
  assert.ok(ids.includes('autre-recente'));
  assert.ok(!ids.includes('autre-ancienne'));
  assert.ok(ids.includes('eligible-ancienne'));
});

test('collecte : une chute de plus de moitié est refusée', async () => {
  const archive = lireArchive();
  const modele = archive.items[0];
  archive.items = Array.from({ length: 100 }, (_, i) => ({ ...modele, id: `perime${i}`, titre: `Annonce périmée ${i} sans rapport`, lien: `https://x.test/p${i}`, echeance: '2020-01-01' }));
  fs.writeFileSync(F_ARCHIVE, JSON.stringify(archive));
  fauxReseau(() => ({ corps: flux(4, 'a') }));
  await assert.rejects(c.collecter(), /écriture refusée/);
  assert.equal(lireArchive().items.length, 100, 'l’archive n’a pas été touchée');
});
