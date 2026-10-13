'use strict';
// Serveur local : sert l'interface, garde l'état de l'utilisateur et lance la collecte à la demande.
// N'écoute que sur cette machine (127.0.0.1).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { collecter } = require('./collecte');
const { lireJson, lireAvecSecours, ecrireSur, cheminSecours } = require('./fichiers');

const optionPort = process.argv.find(a => a.startsWith('--port='));
const PORT = Number(optionPort ? optionPort.slice(7) : process.env.PORT) || 4173;
const RACINE = __dirname;
const INTERFACE = path.join(RACINE, 'interface');
// Même convention que le collecteur : la variable d'environnement sert aux tests.
const DONNEES = process.env.VEILLE_DONNEES || path.join(RACINE, 'donnees');
const F_ETAT = path.join(DONNEES, 'etat.json');
const F_ARCHIVE = path.join(DONNEES, 'opportunites.json');
const F_CONFIG = path.join(RACINE, 'config.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
};
const TABLES_ETAT = ['retenues', 'ecartees', 'avis', 'vues', 'visites'];

// Seules ces adresses désignent ce serveur. Tout autre nom d'hôte signale une page étrangère
// qui tente de l'atteindre en se faisant passer pour lui (réassociation DNS).
const HOTES = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const hoteConnu = req => HOTES.has(String(req.headers.host || '').toLowerCase());
function origineConnue(req) {
  const origine = req.headers.origin;
  if (origine === undefined) return true;
  try { return HOTES.has(new URL(origine).host); } catch { return false; }
}

class Refus extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function repondre(res, code, corps, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof corps === 'string' || Buffer.isBuffer(corps) ? corps : JSON.stringify(corps));
}

function servirFichier(res, base, relatif) {
  const fichier = path.join(base, relatif);
  if (!fichier.startsWith(base + path.sep) || !MIME[path.extname(fichier)]) throw new Refus(404, 'introuvable');
  fs.readFile(fichier, (err, contenu) => {
    if (err) return repondre(res, 404, { erreur: 'introuvable' });
    repondre(res, 200, contenu, MIME[path.extname(fichier)]);
  });
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const morceaux = [];
    req.on('data', m => {
      taille += m.length;
      if (taille > 2e6) { reject(new Refus(413, 'corps trop volumineux')); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')));
    req.on('error', reject);
  });
}

function enregistrerEtat(recu) {
  if (!recu || typeof recu !== 'object' || Array.isArray(recu)) throw new Refus(400, 'état illisible');
  const etat = {};
  for (const table of TABLES_ETAT) {
    const valeur = recu[table];
    etat[table] = valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
  }
  fs.mkdirSync(DONNEES, { recursive: true });
  // Première écriture de la journée : l'état de la veille devient la copie de secours.
  // On réécrit l'état tel qu'il se lit, et non le fichier, qui peut être abîmé.
  try {
    const precedent = lireAvecSecours(F_ETAT, null);
    if (precedent && fs.statSync(F_ETAT).mtime.toDateString() !== new Date().toDateString()) {
      ecrireSur(cheminSecours(F_ETAT), JSON.stringify(precedent));
    }
  } catch { /* pas encore d'état */ }
  ecrireSur(F_ETAT, JSON.stringify(etat));
}

let collecteEnCours = null;

// Une seule collecte à la fois, et pas plus d'une par intervalle : les sites sources ne doivent pas être sollicités en rafale.
async function actualiser() {
  if (collecteEnCours) return collecteEnCours;
  const minutes = (lireJson(F_CONFIG, {}).collecte || {}).intervalleMinimalMinutes ?? 15;
  const derniere = lireJson(F_ARCHIVE, null);
  if (derniere && derniere.majLe) {
    const ecoule = (Date.now() - Date.parse(derniere.majLe)) / 60000;
    if (ecoule < minutes) return { ok: true, recente: true, attendre: Math.ceil(minutes - ecoule), bilan: derniere.bilan };
  }
  collecteEnCours = collecter()
    .then(bilan => ({ ok: true, bilan }))
    .catch(e => ({ ok: false, erreur: e.message }))
    .finally(() => { collecteEnCours = null; });
  return collecteEnCours;
}

async function traiter(req, res) {
  if (!hoteConnu(req)) throw new Refus(403, 'hôte refusé');
  // Une adresse mal formée fait lever une erreur ici : elle est convertie en réponse 400 plus bas.
  const chemin = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (chemin.startsWith('/api/')) {
    if (!origineConnue(req)) throw new Refus(403, 'origine refusée');

    if (chemin === '/api/etat' && req.method === 'GET') return repondre(res, 200, lireAvecSecours(F_ETAT, {}));
    if (chemin === '/api/etat' && req.method === 'PUT') {
      if (!String(req.headers['content-type'] || '').includes('application/json')) throw new Refus(415, 'JSON attendu');
      let recu;
      try { recu = JSON.parse(await lireCorps(req)); } catch (e) { throw e instanceof Refus ? e : new Refus(400, 'état illisible'); }
      enregistrerEtat(recu);
      return repondre(res, 200, { ok: true });
    }
    if (chemin === '/api/actualiser' && req.method === 'POST') return repondre(res, 200, await actualiser());
    throw new Refus(404, 'introuvable');
  }

  if (req.method !== 'GET') throw new Refus(405, 'méthode refusée');
  if (chemin.startsWith('/donnees/')) return servirFichier(res, DONNEES, chemin.slice('/donnees/'.length));
  return servirFichier(res, INTERFACE, chemin === '/' ? 'index.html' : chemin.slice(1));
}

// Aucune requête, même malformée, ne doit arrêter le serveur.
const serveur = http.createServer((req, res) => {
  traiter(req, res).catch(e => {
    if (res.headersSent) return res.destroy();
    if (e instanceof Refus) return repondre(res, e.code, { erreur: e.message });
    if (e instanceof URIError || e.code === 'ERR_INVALID_URL') return repondre(res, 400, { erreur: 'adresse mal formée' });
    console.error(e);
    repondre(res, 500, { erreur: 'erreur interne' });
  });
});

const ADRESSE = `http://localhost:${PORT}`;
const ouvrirNavigateur = () => {
  if (process.argv.includes('--ouvrir')) exec(process.platform === 'win32' ? `start "" "${ADRESSE}"` : `xdg-open "${ADRESSE}"`);
};

serveur.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Lancé une seconde fois : on rouvre simplement la fenêtre déjà servie.
  console.log(`Veille Madagascar tourne déjà sur ${ADRESSE}.`);
  ouvrirNavigateur();
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`Veille Madagascar est ouverte sur ${ADRESSE}`);
  console.log('Laissez cette fenêtre ouverte. Ctrl+C pour arrêter.');
  ouvrirNavigateur();
});
