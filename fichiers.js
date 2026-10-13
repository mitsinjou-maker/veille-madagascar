'use strict';
// Lecture et écriture prudentes des fichiers de données : écriture en deux temps et copie de secours,
// pour qu'une coupure de courant ou une erreur ne fasse pas repartir l'outil de zéro.

const fs = require('fs');

const cheminSecours = fichier => fichier.replace(/\.json$/, '.sauvegarde.json');

function lireJson(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}

// Un fichier absent donne la valeur par défaut (premier lancement).
// Un fichier présent mais illisible (écriture interrompue) fait repartir de la copie de secours.
function lireAvecSecours(fichier, defaut) {
  let brut;
  try { brut = fs.readFileSync(fichier, 'utf8'); } catch { return defaut; }
  try { return JSON.parse(brut); } catch { /* fichier abîmé */ }
  const secours = lireJson(cheminSecours(fichier), undefined);
  if (secours === undefined) return defaut;
  console.error(`${fichier} est illisible : reprise de la copie de secours.`);
  return secours;
}

// Écrit à côté puis renomme : si l'écriture est interrompue, l'ancien fichier reste intact.
function ecrireSur(fichier, contenu) {
  const temporaire = `${fichier}.tmp`;
  fs.writeFileSync(temporaire, contenu);
  try {
    fs.renameSync(temporaire, fichier);
  } catch {
    // Sous Windows, le renommage échoue quand un autre programme tient le fichier ouvert.
    fs.copyFileSync(temporaire, fichier);
    fs.rmSync(temporaire, { force: true });
  }
}

module.exports = { lireJson, lireAvecSecours, ecrireSur, cheminSecours };
