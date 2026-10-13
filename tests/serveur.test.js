'use strict';
// Tests du serveur local : il est lancé sur un port libre, avec un dossier de données temporaire.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-serveur-'));
const F_ETAT = path.join(dossier, 'etat.json');
let port;
let serveur;

const portLibre = () => new Promise(resolve => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// http.request plutôt que fetch : il faut pouvoir choisir l'en-tête Host.
function requete(chemin, { methode = 'GET', entetes = {}, corps } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: chemin, method: methode, headers: { Host: `localhost:${port}`, ...entetes } }, res => {
      let texte = '';
      res.on('data', m => { texte += m; });
      res.on('end', () => resolve({ statut: res.statusCode, texte }));
    });
    req.on('error', reject);
    if (corps !== undefined) req.write(corps);
    req.end();
  });
}

test.before(async () => {
  port = await portLibre();
  serveur = spawn(process.execPath, [path.join(__dirname, '..', 'serveur.js'), `--port=${port}`], {
    env: { ...process.env, VEILLE_DONNEES: dossier }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    serveur.stdout.on('data', m => { if (String(m).includes('ouverte sur')) resolve(); });
    serveur.on('exit', code => reject(new Error(`le serveur s'est arrêté (code ${code})`)));
    setTimeout(() => reject(new Error('le serveur ne démarre pas')), 10000);
  });
});

test.after(() => {
  if (serveur) serveur.kill();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('sert la page', async () => {
  const r = await requete('/');
  assert.equal(r.statut, 200);
  assert.match(r.texte, /Veille Madagascar/);
});

test('une requête malformée reçoit une erreur et ne fait pas tomber le serveur', async () => {
  assert.equal((await requete('/%E0%A4%A')).statut, 400);
  assert.equal((await requete('/api/etat', { entetes: { Origin: 'null' } })).statut, 403);
  assert.equal((await requete('/')).statut, 200);
});

test('refuse un hôte ou une origine étrangers', async () => {
  assert.equal((await requete('/', { entetes: { Host: `evil.example:${port}` } })).statut, 403);
  assert.equal((await requete('/api/etat', { entetes: { Host: `evil.example:${port}` } })).statut, 403);
  assert.equal((await requete('/api/actualiser', { methode: 'POST', entetes: { Origin: 'http://evil.example' } })).statut, 403);
});

test('ne sort pas de ses dossiers', async () => {
  for (const chemin of ['/donnees/../config.json', '/donnees/..%2Fserveur.js', '/%2e%2e/%2e%2e/collecte.js', '/..%5Cserveur.js']) {
    assert.equal((await requete(chemin)).statut, 404, chemin);
  }
});

test('état : n’accepte que du JSON, et ne garde que les tables connues', async () => {
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await requete('/api/etat', { methode: 'PUT', entetes: { 'Content-Type': 'text/plain' }, corps: '{}' })).statut, 415);
  assert.equal((await requete('/api/etat', { methode: 'PUT', entetes: json, corps: '{oups' })).statut, 400);
  assert.equal((await requete('/api/etat', { methode: 'PUT', entetes: json, corps: '[1, 2]' })).statut, 400);
  const recu = { retenues: { a: '2026-10-12T00:00:00Z' }, intrus: 1, vues: 'pas un objet' };
  assert.equal((await requete('/api/etat', { methode: 'PUT', entetes: json, corps: JSON.stringify(recu) })).statut, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(F_ETAT, 'utf8')), { retenues: { a: '2026-10-12T00:00:00Z' }, ecartees: {}, avis: {}, vues: {}, visites: {} });
});

test('état : copie de la veille, reprise si le fichier est abîmé', async () => {
  const json = { 'Content-Type': 'application/json' };
  const hier = new Date(Date.now() - 86400000);
  fs.utimesSync(F_ETAT, hier, hier);
  await requete('/api/etat', { methode: 'PUT', entetes: json, corps: JSON.stringify({ retenues: { b: '2026-10-13T00:00:00Z' } }) });
  const secours = JSON.parse(fs.readFileSync(path.join(dossier, 'etat.sauvegarde.json'), 'utf8'));
  assert.deepEqual(secours.retenues, { a: '2026-10-12T00:00:00Z' });
  fs.writeFileSync(F_ETAT, '{"retenues": {"tronq');
  assert.deepEqual(JSON.parse((await requete('/api/etat')).texte).retenues, { a: '2026-10-12T00:00:00Z' });
});
