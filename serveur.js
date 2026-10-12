'use strict';
// Serveur local : sert l'interface, garde l'état de l'utilisateur et lance la collecte à la demande.
// N'écoute que sur cette machine (127.0.0.1).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { collecter } = require('./collecte');

const PORT = Number(process.env.PORT) || 4173;
const RACINE = __dirname;
const INTERFACE = path.join(RACINE, 'interface');
const DONNEES = path.join(RACINE, 'donnees');
const F_ETAT = path.join(DONNEES, 'etat.json');
const F_ARCHIVE = path.join(DONNEES, 'opportunites.json');
const F_CONFIG = path.join(RACINE, 'config.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
};
const lireJson = (fichier, defaut) => {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
};

function repondre(res, code, corps, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof corps === 'string' || Buffer.isBuffer(corps) ? corps : JSON.stringify(corps));
}

function servirFichier(res, base, relatif) {
  const fichier = path.join(base, relatif);
  if (!fichier.startsWith(base + path.sep) || !MIME[path.extname(fichier)]) return repondre(res, 404, { erreur: 'introuvable' });
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
      if (taille > 2e6) { reject(new Error('trop volumineux')); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')));
    req.on('error', reject);
  });
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

const serveur = http.createServer(async (req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (chemin.startsWith('/api/')) {
    // Refuse les appels venus d'une autre page web ouverte dans le navigateur.
    const origine = req.headers.origin;
    if (origine && new URL(origine).host !== req.headers.host) return repondre(res, 403, { erreur: 'origine refusée' });

    if (chemin === '/api/etat' && req.method === 'GET') return repondre(res, 200, lireJson(F_ETAT, {}));
    if (chemin === '/api/etat' && req.method === 'PUT') {
      try {
        const etat = JSON.parse(await lireCorps(req));
        if (!etat || typeof etat !== 'object' || Array.isArray(etat)) throw new Error('format');
        fs.mkdirSync(DONNEES, { recursive: true });
        fs.writeFileSync(F_ETAT, JSON.stringify(etat));
        return repondre(res, 200, { ok: true });
      } catch {
        return repondre(res, 400, { erreur: 'état illisible' });
      }
    }
    if (chemin === '/api/actualiser' && req.method === 'POST') return repondre(res, 200, await actualiser());
    return repondre(res, 404, { erreur: 'introuvable' });
  }

  if (req.method !== 'GET') return repondre(res, 405, { erreur: 'méthode refusée' });
  if (chemin.startsWith('/donnees/')) return servirFichier(res, DONNEES, chemin.slice('/donnees/'.length));
  return servirFichier(res, INTERFACE, chemin === '/' ? 'index.html' : chemin.slice(1));
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
