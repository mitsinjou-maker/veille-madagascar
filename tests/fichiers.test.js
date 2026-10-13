'use strict';
// Tests de l'écriture sûre des fichiers, dans un dossier temporaire.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lireJson, lireAvecSecours, ecrireSur, cheminSecours } = require('../fichiers');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-fichiers-'));
const fichier = path.join(dossier, 'etat.json');
test.after(() => fs.rmSync(dossier, { recursive: true, force: true }));

test('écriture en deux temps, sans fichier temporaire laissé', () => {
  ecrireSur(fichier, JSON.stringify({ a: 1 }));
  ecrireSur(fichier, JSON.stringify({ a: 2 }));
  assert.deepEqual(lireJson(fichier, null), { a: 2 });
  assert.deepEqual(fs.readdirSync(dossier), ['etat.json']);
});

test('fichier absent : valeur par défaut', () => {
  assert.deepEqual(lireAvecSecours(path.join(dossier, 'absent.json'), { vide: true }), { vide: true });
});

test('fichier tronqué : reprise de la copie de secours', () => {
  assert.equal(cheminSecours(fichier), path.join(dossier, 'etat.sauvegarde.json'));
  ecrireSur(cheminSecours(fichier), JSON.stringify({ veille: true }));
  fs.writeFileSync(fichier, '{"a": 3, "b": "tronq');
  assert.deepEqual(lireAvecSecours(fichier, null), { veille: true });
});

test('fichier tronqué sans copie de secours : valeur par défaut', () => {
  const seul = path.join(dossier, 'seul.json');
  fs.writeFileSync(seul, '{"tronq');
  assert.deepEqual(lireAvecSecours(seul, { defaut: 1 }), { defaut: 1 });
});
