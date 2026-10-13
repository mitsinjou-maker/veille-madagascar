(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const lienSur = u => (/^https?:\/\//i.test(u || '') ? u : '#');
const connu = (table, cle) => typeof cle === 'string' && Object.prototype.hasOwnProperty.call(table, cle);

const ICONES = {
  liste: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
  horloge: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendrier: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5S9.4 5.9 12 3.5z"/>',
  pouls: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
  actualiser: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.2h-4.2"/>',
  etoile: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z"/>',
  externe: '<path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V14"/><path d="M14 5h5v5M19 5l-8 8"/>',
  recherche: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  retour: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
};
const ico = (nom, classe = '') => `<svg class="ico ${classe}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom]}</svg>`;

const VUES = [
  { id: 'opportunites', nom: 'Opportunités', court: 'Flux', icone: 'liste' },
  { id: 'echeances', nom: 'Échéances', court: 'Échéances', icone: 'horloge' },
  { id: 'calendrier', nom: 'Calendrier annuel', court: 'Calendrier', icone: 'calendrier' },
  { id: 'manuelle', nom: 'Veille manuelle', court: 'À visiter', icone: 'globe' },
  { id: 'sources', nom: 'Sources', court: 'Sources', icone: 'pouls' },
];
const LIB = {
  type: { appel: 'Appel à projets', concours: 'Concours ou prix', bourse: 'Bourse ou programme', marche: 'Marché ou consultance', autre: 'Autre', emploi: 'Emploi, stage, volontariat' },
  elig: { madagascar: 'Madagascar cité', ensemble: 'Ensemble régional', mondial: 'Ouvert au monde', verifier: 'À vérifier', autre: 'Autre zone ciblée' },
  porteur: { jeunes: 'Jeunes', associations: 'Associations', entrepreneurs: 'Entrepreneurs', femmes: 'Femmes', chercheurs: 'Chercheurs', artistes: 'Culture et médias' },
  theme: { agriculture: 'Agriculture', environnement: 'Environnement', numerique: 'Numérique', sante: 'Santé', education: 'Éducation', energie: 'Énergie', gouvernance: 'Gouvernance', eau: 'Eau' },
  rythme: { semaine: 'Chaque semaine', mois: 'Chaque mois', trimestre: 'Chaque trimestre' },
};
const DEFAUT = { type: ['appel', 'concours', 'bourse', 'marche', 'autre'], elig: ['madagascar', 'ensemble', 'mondial', 'verifier'], porteur: [] };
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_TUILE = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const INITIALES = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const JOUR = 86400000;
const CLE_ETAT = 'veille-madagascar-etat';
// Nombre de lignes dessinées d'un coup : la suite arrive au défilement.
const PAS = 100;
const etatVide = () => ({ retenues: {}, ecartees: {}, avis: {}, vues: {}, visites: {} });

const E = {
  items: [], maj: null, sources: [], manuelles: [], calendrier: [], resume: '',
  etat: etatVide(), api: true, charge: false, collecte: false,
  vue: 'opportunites', portee: 'atraiter', porteeEch: 'toutes', porteeSites: 'du', tri: 'pertinence', q: '',
  f: { type: new Set(DEFAUT.type), elig: new Set(DEFAUT.elig), porteur: new Set() },
  sel: null, visibles: [], limite: PAS,
};

// ---------- Dates ----------
const minuit = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const deIso = iso => { const [a, m, j] = iso.split('-').map(Number); return new Date(a, m - 1, j); };
const joursAvant = iso => (iso ? Math.round((deIso(iso) - minuit(new Date())) / JOUR) : null);
const dateLongue = d => `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
function ilYA(iso) {
  if (!iso) return 'jamais';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  if (min < 1440) return `il y a ${Math.round(min / 60)} h`;
  const j = Math.round(min / 1440);
  return j === 1 ? 'hier' : `il y a ${j} jours`;
}
const libJours = o => (o.jours === null ? (o.permanent ? 'En continu' : '') : o.jours < 0 ? 'Clos' : o.jours === 0 ? 'Aujourd’hui' : o.jours === 1 ? 'Demain' : `J-${o.jours}`);

// ---------- Données ----------
// Tout ce qui vient des fichiers de données est ramené ici à des valeurs connues ou à du texte borné.
// Le reste du code peut alors placer ces valeurs dans la page sans risque d'injection.
const texteSur = (v, max) => (v === null || v === undefined ? '' : String(v).slice(0, max));
const tableau = v => (Array.isArray(v) ? v : []);
const entier = (v, min, max, defaut) => { const n = Math.trunc(Number(v)); return n >= min && n <= max ? n : defaut; };
const jourValide = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(deIso(v).getTime()) ? v : null);
const instantValide = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const adresseValide = v => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v.slice(0, 1000) : null);

function assainirAnnonce(o) {
  const echeance = jourValide(o.echeance);
  return {
    id: texteSur(o.id, 80),
    titre: texteSur(o.titre, 300),
    lien: adresseValide(o.lien),
    source: texteSur(o.source, 40),
    sourceNom: texteSur(o.sourceNom, 80),
    publie: instantValide(o.publie),
    premiereVue: instantValide(o.premiereVue) || '',
    type: connu(LIB.type, o.type) ? o.type : 'autre',
    eligibilite: connu(LIB.elig, o.eligibilite) ? o.eligibilite : 'verifier',
    preuve: texteSur(o.preuve, 400),
    porteurs: tableau(o.porteurs).filter(p => connu(LIB.porteur, p)),
    themes: tableau(o.themes).filter(t => connu(LIB.theme, t)),
    echeance,
    jours: joursAvant(echeance),
    montant: texteSur(o.montant, 80),
    resume: texteSur(o.resume, 700),
    aussiSur: tableau(o.aussiSur).map(s => texteSur(s, 80)),
    score: entier(o.score, 0, 200, 0),
    permanent: o.permanent === true,
    presse: o.presse === true,
    verif: o.verif === 'officiel' || o.verif === 'recherche' ? o.verif : null,
    verifLe: jourValide(o.verifLe),
  };
}

const assainirSite = s => ({
  id: texteSur(s.id, 60),
  groupe: texteSur(s.groupe, 80),
  nom: texteSur(s.nom, 120),
  adresse: texteSur(s.adresse, 120),
  url: adresseValide(s.url),
  quoi: texteSur(s.quoi, 300),
  pourquoi: texteSur(s.pourquoi, 300),
  rythme: connu(LIB.rythme, s.rythme) || s.rythme === 'saison' ? s.rythme : 'mois',
  mois: tableau(s.mois).map(m => entier(m, 1, 12, 0)).filter(Boolean),
  quand: texteSur(s.quand, 80),
  constat: texteSur(s.constat, 400),
  suivi: texteSur(s.suivi, 300),
});

const assainirEvenement = e => ({
  nom: texteSur(e.nom, 120),
  debut: entier(e.debut, 1, 12, 1),
  fin: entier(e.fin, 1, 12, 12),
  fenetre: texteSur(e.fenetre, 120),
  public: texteSur(e.public, 200),
  montant: texteSur(e.montant, 80),
  url: adresseValide(e.url),
  officiel: e.verif === 'officiel',
});

const assainirSource = s => ({
  nom: texteSur(s.nom, 80),
  ok: s.ok === true,
  erreur: texteSur(s.erreur, 120),
  lus: entier(s.lus, 0, 1e6, 0),
  gardes: entier(s.gardes, 0, 1e6, 0),
  dernierArticle: instantValide(s.dernierArticle),
  dernierSucces: instantValide(s.dernierSucces),
});

async function lire(url, defaut, texte) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return texte ? await r.text() : await r.json();
  } catch { return defaut; }
}

async function chargerDonnees() {
  const [archive, manuelles, calendrier, resume] = await Promise.all([
    lire('donnees/opportunites.json', null),
    lire('donnees/sources-manuelles.json', []),
    lire('donnees/calendrier.json', {}),
    lire('donnees/resume.txt', '', true),
  ]);
  E.manuelles = tableau(manuelles).map(assainirSite).filter(s => s.id && s.nom);
  E.calendrier = tableau(calendrier && calendrier.evenements).map(assainirEvenement).filter(e => e.nom);
  E.resume = texteSur(resume, 20000);
  E.charge = !!(archive && Array.isArray(archive.items));
  if (E.charge) {
    E.items = archive.items.map(assainirAnnonce).filter(o => o.id && o.titre);
    E.maj = instantValide(archive.majLe);
    E.sources = tableau(archive.sources).map(assainirSource);
  }
  return E.charge;
}

const etatEstVide = e => !e || !Object.keys(etatVide()).some(cle => e[cle] && typeof e[cle] === 'object' && Object.keys(e[cle]).length);

async function chargerEtat() {
  let copie = null;
  try { copie = JSON.parse(localStorage.getItem(CLE_ETAT) || 'null'); } catch { /* stockage indisponible */ }
  let etat = null;
  try {
    const r = await fetch('api/etat', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    etat = await r.json();
  } catch {
    E.api = false;
    etat = copie;
  }
  // Fichier d'état perdu ou vidé côté serveur : on repart de la copie que ce navigateur a gardée.
  const aRestaurer = E.api && etatEstVide(etat) && !etatEstVide(copie);
  if (aRestaurer) etat = copie;
  E.etat = { ...etatVide() };
  for (const cle of Object.keys(etatVide())) if (etat && etat[cle] && typeof etat[cle] === 'object') E.etat[cle] = etat[cle];
  if (aRestaurer) sauver();
}

let minuterieEtat;
function sauver() {
  try { localStorage.setItem(CLE_ETAT, JSON.stringify(E.etat)); } catch { /* stockage indisponible */ }
  if (!E.api) return;
  clearTimeout(minuterieEtat);
  minuterieEtat = setTimeout(() => {
    fetch('api/etat', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(E.etat) }).catch(() => {});
  }, 300);
}

// ---------- Sélection des annonces ----------
const expiree = o => o.jours !== null && o.jours < 0;
const eligDe = o => (E.etat.avis[o.id] === 'oui' ? 'madagascar' : E.etat.avis[o.id] === 'non' ? 'autre' : o.eligibilite);
const libElig = o => (E.etat.avis[o.id] === 'oui' ? 'Éligible, confirmé par vous' : E.etat.avis[o.id] === 'non' ? 'Non éligible selon vous' : LIB.elig[o.eligibilite]);
const retenue = o => !!E.etat.retenues[o.id];
const ecartee = o => !!E.etat.ecartees[o.id];
const parDefaut = o => DEFAUT.type.includes(o.type) && DEFAUT.elig.includes(eligDe(o));
// Texte de recherche d'une annonce, calculé une fois puis gardé.
const cible = o => o.cible || (o.cible = norm(`${o.titre} ${o.sourceNom} ${o.resume} ${o.montant}`));

function dansPortee(o) {
  if (E.vue === 'echeances') return !!o.echeance && !expiree(o) && !ecartee(o) && (E.porteeEch === 'toutes' || retenue(o));
  if (E.portee === 'retenues') return retenue(o);
  if (E.portee === 'ecartees') return ecartee(o);
  return !retenue(o) && !ecartee(o) && !expiree(o);
}
// Ce que l'utilisateur a retenu ou écarté lui-même reste visible quel que soit le filtre de type ou de zone.
const filtresLibres = () => (E.vue === 'echeances' ? E.porteeEch === 'retenues' : E.portee !== 'atraiter');

function passeFiltres(o, libres, mots) {
  if (!libres && (!E.f.type.has(o.type) || !E.f.elig.has(eligDe(o)))) return false;
  if (E.f.porteur.size && !o.porteurs.some(p => E.f.porteur.has(p))) return false;
  if (mots) { const c = cible(o); if (!mots.every(mot => c.includes(mot))) return false; }
  return true;
}

const ordre = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function trier(items) {
  const limite = o => o.echeance || '9999';
  if (E.vue === 'echeances' || E.tri === 'echeance') return items.sort((a, b) => ordre(limite(a), limite(b)) || b.score - a.score);
  if (E.tri === 'recent') return items.sort((a, b) => ordre(b.publie || b.premiereVue, a.publie || a.premiereVue));
  return items.sort((a, b) => b.score - a.score || ordre(limite(a), limite(b)));
}

const delaiSite = { semaine: 7, mois: 30, trimestre: 90 };
function aVisiter(s) {
  if (!s.url) return false;
  const visite = E.etat.visites[s.id] ? new Date(E.etat.visites[s.id]) : null;
  const n = new Date();
  if (s.rythme === 'saison') {
    return s.mois.includes(n.getMonth() + 1) && !(visite && visite.getMonth() === n.getMonth() && visite.getFullYear() === n.getFullYear());
  }
  return !visite || (n - visite) / JOUR > delaiSite[s.rythme];
}

// ---------- Barre latérale ----------
function decompte() {
  const d = { aTraiter: 0, nonLues: 0, sous3: 0, sous14: 0, urgentes: 0, retenues: 0, retenuesDatees: 0 };
  for (const o of E.items) {
    const ret = retenue(o);
    if (ret) d.retenues++;
    if (!parDefaut(o) || ecartee(o) || expiree(o)) continue;
    if (!ret) { d.aTraiter++; if (!E.etat.vues[o.id]) d.nonLues++; }
    if (ret && o.echeance) d.retenuesDatees++;
    if (o.jours !== null && o.jours <= 14) {
      d.sous14++;
      if (o.jours <= 3) { d.sous3++; if (ret) d.urgentes++; }
    }
  }
  return d;
}

function majBarre() {
  let pastilles = {};
  if (E.charge) {
    const d = decompte();
    pastilles = {
      opportunites: { n: d.aTraiter },
      echeances: d.urgentes ? { n: d.urgentes, alerte: true } : { n: d.sous14 },
      manuelle: { n: E.manuelles.filter(aVisiter).length },
      sources: { n: E.sources.filter(s => !s.ok).length, alerte: true },
    };
  }
  $('#menu').innerHTML = VUES.map(v => {
    const k = pastilles[v.id];
    const pastille = k && k.n ? `<span class="compteur ${k.alerte ? 'alerte' : ''}">${k.n}</span>` : '';
    return `<li><button type="button" data-vue="${v.id}" ${v.id === E.vue ? 'aria-current="page"' : ''}>${ico(v.icone)}<span class="long">${v.nom}</span><span class="court">${v.court}</span>${pastille}</button></li>`;
  }).join('');
  // Sans serveur local, la page est la version en ligne : la collecte y est planifiée, pas déclenchée à la main.
  $('#maj').textContent = E.maj ? `Dernière collecte ${ilYA(E.maj)}${E.api ? '' : '. Mise à jour automatique toutes les deux heures.'}` : '';
  const bouton = $('#actualiser');
  bouton.hidden = !E.api;
  bouton.disabled = E.collecte;
  bouton.innerHTML = `${ico('actualiser')}<span>${E.collecte ? 'Collecte en cours…' : 'Actualiser'}</span>`;
  const theme = document.documentElement.dataset.theme;
  $('#theme').innerHTML = `${ico('theme')}<span>Thème : ${theme === 'dark' ? 'sombre' : theme === 'light' ? 'clair' : 'automatique'}</span>`;
}

// ---------- Vues liste : opportunités et échéances ----------
function menuFiltre(groupe, titre, aide) {
  const cle = groupe === 'porteur' ? o => o.porteurs : groupe === 'elig' ? o => [eligDe(o)] : o => [o.type];
  const compte = {};
  for (const o of E.items) {
    const dedans = E.vue === 'echeances' ? !!o.echeance && !expiree(o) && !ecartee(o) : !retenue(o) && !ecartee(o) && !expiree(o);
    if (dedans) for (const valeur of cle(o)) compte[valeur] = (compte[valeur] || 0) + 1;
  }
  const modifie = [...E.f[groupe]].sort().join() !== [...DEFAUT[groupe]].sort().join();
  const cases = Object.entries(LIB[groupe]).map(([valeur, libelle]) =>
    `<label><input type="checkbox" data-filtre="${groupe}" value="${valeur}" ${E.f[groupe].has(valeur) ? 'checked' : ''}>${libelle}<span class="c">${compte[valeur] || 0}</span></label>`).join('');
  return `<details class="filtre ${modifie ? 'modifie' : ''}" data-groupe="${groupe}"><summary>${titre}</summary><div class="pop">${cases}<small>${aide}</small></div></details>`;
}

function vueListe() {
  const ech = E.vue === 'echeances';
  const portees = ech ? [['toutes', 'Toutes'], ['retenues', 'Retenues']] : [['atraiter', 'À traiter'], ['retenues', 'Retenues'], ['ecartees', 'Écartées']];
  const courante = ech ? E.porteeEch : E.portee;
  const tri = ech ? '' : `<label class="tri"><span>Trier par</span><select id="tri" aria-label="Trier par">
      ${[['pertinence', 'Pertinence'], ['echeance', 'Date limite'], ['recent', 'Plus récentes']].map(([v, l]) => `<option value="${v}" ${E.tri === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>`;
  return `
    <header class="entete">
      <div><h1>${ech ? 'Échéances' : 'Opportunités'}</h1><p id="sous-titre"></p></div>
      <div class="chiffres" id="chiffres"></div>
    </header>
    <div class="outils">
      <label class="champ">${ico('recherche')}<input id="q" type="search" placeholder="Rechercher un titre, une source" value="${esc(E.q)}" autocomplete="off" aria-label="Rechercher"></label>
      <div class="segments">${portees.map(([v, l]) => `<button type="button" data-portee="${v}" aria-pressed="${v === courante}">${l}</button>`).join('')}</div>
      ${menuFiltre('type', 'Type', 'Les emplois sont masqués au départ : ils relèvent d’une étape ultérieure.')}
      ${menuFiltre('elig', 'Éligibilité', 'Les annonces réservées à d’autres pays sont masquées au départ.')}
      ${menuFiltre('porteur', 'Porteur', 'Sans case cochée, tous les porteurs sont affichés.')}
      ${tri}
    </div>
    <div class="corps" id="corps">
      <section class="liste" id="liste" aria-label="Liste des opportunités"></section>
      <aside class="fiche" id="fiche" aria-label="Détail de l’opportunité"></aside>
    </div>`;
}

function ligne(o) {
  let tuile;
  if (o.echeance) {
    const d = deIso(o.echeance);
    const etat = o.jours < 0 ? 'clos' : o.jours <= 3 ? 'imminent' : o.jours <= 14 ? 'bientot' : '';
    tuile = `<div class="date ${etat}"><b>${d.getDate()}</b><span>${MOIS_TUILE[d.getMonth()]}</span></div>`;
  } else {
    tuile = `<div class="date vide" title="${o.permanent ? 'Candidatures en continu' : 'Date limite inconnue'}"><b>${o.permanent ? '∞' : '—'}</b></div>`;
  }
  const tags = [`<span class="tag e-${eligDe(o)}">${esc(libElig(o))}</span>`];
  if (o.permanent) tags.push('<span class="tag neutre">Guichet permanent</span>');
  if (o.presse) tags.push('<span class="tag neutre">Article de presse</span>');
  for (const p of o.porteurs.slice(0, 2)) tags.push(`<span class="tag neutre">${LIB.porteur[p]}</span>`);
  const meta = [o.sourceNom, LIB.type[o.type], o.montant].filter(Boolean).map(esc).join(' · ');
  const ret = retenue(o);
  return `<li class="ligne ${o.id === E.sel ? 'sel' : ''} ${E.etat.vues[o.id] ? '' : 'nonlue'}" data-id="${esc(o.id)}">
      ${tuile}
      <div><h3>${esc(o.titre)}</h3><p class="meta">${meta}</p><div class="etiquettes">${tags.join('')}</div></div>
      <div class="cote"><span class="jours">${libJours(o)}</span>
        <button class="etoile" type="button" data-retenir="${esc(o.id)}" aria-pressed="${ret}" aria-label="${ret ? 'Ne plus retenir' : 'Retenir'}" title="${ret ? 'Ne plus retenir' : 'Retenir'}">${ico('etoile')}</button></div>
    </li>`;
}

// Redessine la liste. Seules les E.limite premières lignes sont créées : avec un millier d'annonces,
// tout dessiner à chaque clic coûtait près d'une seconde.
function majListe(garderFenetre) {
  const el = $('#liste');
  if (!el) return;
  if (!garderFenetre) E.limite = PAS;
  const libres = filtresLibres();
  const mots = E.q ? norm(E.q).split(/\s+/).filter(Boolean) : null;
  const items = trier(E.items.filter(o => dansPortee(o) && passeFiltres(o, libres, mots)));
  E.visibles = items.map(o => o.id);
  const montrees = items.slice(0, E.limite);
  const haut = el.scrollTop;

  let html;
  if (!items.length) {
    const vide = E.vue === 'echeances' ? 'Aucune échéance à venir' : E.portee === 'retenues' ? 'Rien de retenu pour l’instant' : E.portee === 'ecartees' ? 'Rien d’écarté' : 'Aucune opportunité ne correspond';
    const aide = E.portee === 'retenues' && E.vue !== 'echeances' ? 'Cliquez sur l’étoile d’une annonce pour la retrouver ici, avec un rappel avant sa date limite.' : 'Élargissez les filtres ou effacez la recherche.';
    html = `<div class="vide-liste"><b>${vide}</b>${aide}</div>`;
  } else if (E.vue === 'echeances') {
    const groupes = [[1, 'Aujourd’hui et demain'], [7, 'Cette semaine'], [14, 'Sous 14 jours'], [30, 'Sous 30 jours'], [Infinity, 'Plus tard']];
    let courant = -1;
    html = '';
    for (const o of montrees) {
      const g = groupes.findIndex(([max]) => o.jours <= max);
      if (g !== courant) { if (courant >= 0) html += '</ul>'; html += `<h2 class="groupe">${groupes[g][1]}</h2><ul>`; courant = g; }
      html += ligne(o);
    }
    html += '</ul>';
  } else {
    html = `<ul>${montrees.map(ligne).join('')}</ul>`;
  }
  const reste = items.length - montrees.length;
  if (reste > 0) html += `<button class="suite" type="button" data-suite>Afficher la suite · ${reste} ${reste > 1 ? 'annonces restantes' : 'annonce restante'}</button>`;
  el.innerHTML = html;
  // Toucher à scrollTop oblige le navigateur à mettre la liste en page sur-le-champ : on ne le fait que si nécessaire.
  if (haut) el.scrollTop = garderFenetre ? haut : 0;
  majChiffres();
}

function majChiffres() {
  const el = $('#chiffres');
  if (!el) return;
  const d = decompte();
  const chiffres = E.vue === 'echeances'
    ? [[d.sous3, 'sous 3 jours', d.sous3 > 0], [d.sous14, 'sous 14 jours'], [d.retenuesDatees, 'retenues datées']]
    : [[d.aTraiter, 'à traiter'], [d.nonLues, 'non lues'], [d.sous14, 'sous 14 jours'], [d.retenues, 'retenues']];
  el.innerHTML = chiffres.map(([n, l, urgent]) => `<div class="chiffre ${urgent ? 'urgent' : ''}"><b>${n}</b><span>${l}</span></div>`).join('');
  const lues = E.sources.filter(s => s.ok).length;
  $('#sous-titre').textContent = E.vue === 'echeances'
    ? 'Classées par date limite. Les dates sont lues dans les annonces : à confirmer avant de déposer un dossier.'
    : `${E.visibles.length} affichées · collecte ${ilYA(E.maj)} sur ${lues} sources`;
}

function majFiche() {
  const el = $('#fiche');
  if (!el) return;
  const o = E.items.find(x => x.id === E.sel);
  $('#corps').classList.toggle('fiche-ouverte', !!o);
  if (!o) {
    el.innerHTML = `<div class="fiche-vide"><b>Sélectionnez une opportunité</b>
      <div class="touches"><span><kbd>↑</kbd> <kbd>↓</kbd> parcourir</span><span><kbd>S</kbd> retenir</span><span><kbd>X</kbd> écarter</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>/</kbd> chercher</span></div></div>`;
    return;
  }
  const e = eligDe(o);
  const avis = E.etat.avis[o.id];
  const limite = o.echeance ? `${dateLongue(deIso(o.echeance))} · ${libJours(o)}` : o.permanent ? 'Aucune : candidatures en continu' : 'Inconnue : non trouvée dans l’annonce';
  const quand = o.verifLe ? ` le ${dateLongue(deIso(o.verifLe))}` : '';
  const verif = o.source !== 'reperage' || !o.verif ? null : o.verif === 'officiel' ? `Site officiel lu${quand}` : `D’après un agrégateur${quand} : à confirmer`;
  const faits = [
    ['Date limite', limite],
    ['Montant repéré', o.montant],
    ['Type', LIB.type[o.type]],
    ['Pour', o.porteurs.map(p => LIB.porteur[p]).join(', ')],
    ['Thèmes', o.themes.map(t => LIB.theme[t]).join(', ')],
    ['Source', o.sourceNom],
    ['Aussi vu sur', o.aussiSur.join(', ')],
    ['Publié le', o.publie ? dateLongue(new Date(o.publie)) : null],
    ['Vérification', verif],
  ].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const note = o.source === 'reperage' ? 'Fiche saisie à la main, hors des flux automatiques.' : 'Classement automatique par mots-clés : à confirmer sur l’annonce.';

  el.innerHTML = `<article class="fiche-contenu">
      <button class="btn petit retour" type="button" data-action="fermer">${ico('retour', 'petit')}Liste</button>
      <p class="surtitre">${esc(o.sourceNom)} · ${esc(LIB.type[o.type])}</p>
      <h2>${esc(o.titre)}</h2>
      <div class="actions">
        <a class="btn primaire" href="${esc(lienSur(o.lien))}" target="_blank" rel="noopener noreferrer">Ouvrir l’annonce${ico('externe', 'petit')}</a>
        <button class="btn ${retenue(o) ? 'actif' : ''}" type="button" data-action="retenir">${retenue(o) ? 'Retenue' : 'Retenir'}</button>
        <button class="btn ${ecartee(o) ? 'actif' : ''}" type="button" data-action="ecarter">${ecartee(o) ? 'Écartée' : 'Écarter'}</button>
      </div>
      <section class="elig e-${e}">
        <h4>Éligibilité : ${esc(libElig(o))}</h4>
        ${o.preuve ? `<blockquote>${esc(o.preuve)}</blockquote>` : ''}
        <p class="note">${note}</p>
        <div class="avis">Après lecture, Madagascar est-il éligible ?
          <button class="btn petit ${avis === 'oui' ? 'actif' : ''}" type="button" data-action="avis-oui">Oui</button>
          <button class="btn petit ${avis === 'non' ? 'actif' : ''}" type="button" data-action="avis-non">Non</button></div>
      </section>
      <dl class="faits">${faits}</dl>
      ${o.resume ? `<p class="resume">${esc(o.resume)}</p>` : ''}
    </article>`;
  el.scrollTop = 0;
}

const ligneDe = id => (id ? $(`.ligne[data-id="${CSS.escape(id)}"]`) : null);

// Changer de sélection ne redessine pas la liste : seules les deux lignes concernées sont retouchées.
function selectionner(id) {
  const ancienne = E.sel;
  E.sel = id;
  if (id && !E.etat.vues[id]) { E.etat.vues[id] = 1; sauver(); }
  const rang = E.visibles.indexOf(id);
  if (rang >= E.limite) {
    E.limite = (Math.floor(rang / PAS) + 1) * PAS;
    majListe(true);
  } else {
    const avant = ligneDe(ancienne);
    if (avant) avant.classList.remove('sel');
    const apres = ligneDe(id);
    if (apres) { apres.classList.add('sel'); apres.classList.remove('nonlue'); }
    majChiffres();
  }
  majFiche();
  majBarre();
  const el = ligneDe(id);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function apresChangement() {
  sauver();
  majListe(true);
  majFiche();
  majBarre();
}

function basculer(table, id, message) {
  if (E.etat[table][id]) delete E.etat[table][id];
  else {
    E.etat[table][id] = new Date().toISOString();
    delete E.etat[table === 'retenues' ? 'ecartees' : 'retenues'][id];
    if (message) toast(message);
  }
  apresChangement();
}

// ---------- Calendrier annuel ----------
function vueCalendrier() {
  const m = new Date().getMonth() + 1;
  const ouvert = e => (e.debut <= e.fin ? m >= e.debut && m <= e.fin : m >= e.debut || m <= e.fin);
  const attente = e => (e.debut - m + 12) % 12;
  const evenements = [...E.calendrier].sort((a, b) => ouvert(b) - ouvert(a) || attente(a) - attente(b) || a.nom.localeCompare(b.nom));
  const fenetres = e => (e.debut <= e.fin ? [[e.debut, e.fin]] : [[e.debut, 12], [1, e.fin]])
    .map(([a, b]) => `<i class="fen ${e.officiel ? '' : 'incertain'}" style="grid-column:${a} / ${b + 1}"></i>`).join('');
  const rang = e => `<div class="rang ${ouvert(e) ? 'ouvert' : ''}">
      <div class="rang-nom">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.nom)}</a>` : `<b>${esc(e.nom)}</b>`}
        <small>${esc([e.fenetre, e.montant].filter(Boolean).join(' · '))}</small><small>${esc(e.public)}</small></div>
      <div class="piste" role="img" aria-label="${esc(`Fenêtre : ${e.fenetre}`)}">${fenetres(e)}</div>
    </div>`;
  const guichets = E.items.filter(o => o.permanent).map(o => `<div class="site">
      <h3>${esc(o.titre)}</h3>
      <a class="adresse" href="${esc(lienSur(o.lien))}" target="_blank" rel="noopener noreferrer"><span>${esc((o.lien || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span>${ico('externe', 'petit')}</a>
      <p>${esc(o.resume)}</p>${o.montant ? `<p class="pourquoi">${esc(o.montant)}</p>` : ''}
    </div>`).join('');
  const nOuverts = evenements.filter(ouvert).length;
  return `
    <header class="entete"><div><h1>Calendrier annuel</h1>
      <p>${evenements.length} appels reviennent chaque année. ${nOuverts} ont leur fenêtre habituelle ouverte en ${MOIS_LONG[m - 1]}. Les fenêtres sont celles de la dernière édition connue : à confirmer chaque année.</p></div></header>
    <div class="page">
      <div class="annee" style="--m:${m}">
        <div class="legende"><span><i class="ouvert"></i>Fenêtre habituelle ouverte ce mois-ci</span><span><i></i>Confirmé sur le site officiel</span><span><i class="incertain"></i>D’après la presse ou un agrégateur</span></div>
        <div class="mois-tete"><span></span><div class="mois">${INITIALES.map((l, i) => `<span class="${i + 1 === m ? 'courant' : ''}">${l}</span>`).join('')}</div></div>
        ${evenements.map(rang).join('')}
      </div>
      ${guichets ? `<div class="section-titre"><h2>Guichets permanents</h2><span>candidatures acceptées toute l’année</span></div><div class="guichets">${guichets}</div>` : ''}
    </div>`;
}

// ---------- Veille manuelle ----------
function carteSite(s) {
  if (!s.url) {
    return `<li class="site sans"><h3>${esc(s.nom)}</h3><p>${esc(s.constat)}</p><p class="pourquoi">${esc(s.suivi)}</p></li>`;
  }
  const du = aVisiter(s);
  const visite = instantValide(E.etat.visites[s.id]);
  return `<li class="site ${du ? 'du' : ''}">
      <div class="site-tete"><h3>${esc(s.nom)}</h3><span class="rythme">${esc(s.rythme === 'saison' ? s.quand : LIB.rythme[s.rythme])}</span></div>
      <a class="adresse" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" data-site="${esc(s.id)}" title="Ouvrir dans un nouvel onglet"><span>${esc(s.adresse)}</span>${ico('externe', 'petit')}</a>
      <p>${esc(s.quoi)}</p>
      <p class="pourquoi">${esc(s.pourquoi)}</p>
      <div class="site-pied"><span class="visite">${visite ? `Visité ${ilYA(visite)}` : 'Jamais visité'}</span>
        <button class="btn petit" type="button" data-visite="${esc(s.id)}">${visite && !du ? 'Annuler la visite' : 'Marquer comme visité'}</button></div>
    </li>`;
}

function vueManuelle() {
  const avecAdresse = E.manuelles.filter(s => s.url);
  const dus = avecAdresse.filter(aVisiter);
  const montres = E.porteeSites === 'du' ? dus : E.manuelles;
  const groupes = [...new Set(E.manuelles.map(s => s.groupe))];
  const sections = groupes.map(g => {
    const sites = montres.filter(s => s.groupe === g);
    if (!sites.length) return '';
    return `<div class="section-titre"><h2>${esc(g)}</h2><span>${sites.filter(s => s.url).length} adresses</span></div><ul class="sites">${sites.map(carteSite).join('')}</ul>`;
  }).join('');
  return `
    <header class="entete"><div><h1>Veille manuelle</h1>
      <p>${avecAdresse.length} sites qu’aucun robot ne lit correctement. Cliquez sur une adresse : elle s’ouvre dans un nouvel onglet et la visite est notée.</p></div>
      <div class="chiffres"><div class="chiffre"><b>${dus.length}</b><span>à visiter maintenant</span></div><div class="chiffre"><b>${avecAdresse.length - dus.length}</b><span>à jour</span></div></div>
    </header>
    <div class="outils"><div class="segments">
      <button type="button" data-sites="du" aria-pressed="${E.porteeSites === 'du'}">À visiter</button>
      <button type="button" data-sites="toutes" aria-pressed="${E.porteeSites === 'toutes'}">Toutes</button></div></div>
    <div class="page">${sections || '<div class="vide-liste"><b>Tout est à jour</b>Aucun site à visiter pour l’instant.</div>'}</div>`;
}

// ---------- Sources ----------
function vueSources() {
  const lignes = E.sources.map(s => {
    const muet = s.ok && s.dernierArticle && (Date.now() - Date.parse(s.dernierArticle)) / JOUR > 7;
    const etat = !s.ok ? ['erreur', `En erreur : ${s.erreur}`] : muet ? ['muet', 'Muette depuis plus de 7 jours'] : ['', 'Lue'];
    return `<tr><td><b>${esc(s.nom)}</b></td><td><span class="etat-src ${etat[0]}">${esc(etat[1])}</span></td>
      <td class="n">${s.lus}</td><td class="n">${s.gardes}</td><td class="n">${s.dernierArticle ? ilYA(s.dernierArticle) : '—'}</td><td class="n">${s.dernierSucces ? ilYA(s.dernierSucces) : 'jamais'}</td></tr>`;
  }).join('');
  return `
    <header class="entete"><div><h1>Sources</h1>
      <p>${E.sources.length} sources sont lues automatiquement. Une source en erreur ou muette depuis une semaine est signalée ici.</p></div></header>
    <div class="page">
      <div class="table-defilante"><table>
        <thead><tr><th>Source</th><th>État</th><th>Lues</th><th>Gardées</th><th>Dernier article</th><th>Dernière lecture</th></tr></thead>
        <tbody>${lignes}</tbody></table></div>
      <div class="section-titre"><h2>Résumé de la dernière collecte</h2><span>fichier <code>donnees/resume.txt</code></span></div>
      <pre class="resume-jour">${esc(E.resume || 'Aucun résumé pour l’instant.')}</pre>
      <div class="section-titre"><h2>Réglages</h2></div>
      <p class="note-page">Le profil, les mots à exclure et la liste des sources se règlent dans le fichier <code>config.json</code>. Les sites à visiter à la main sont dans <code>donnees/sources-manuelles.json</code>, les fiches saisies à la main dans <code>donnees/reperages.json</code> et le calendrier dans <code>donnees/calendrier.json</code>.</p>
    </div>`;
}

// ---------- Rendu général ----------
function rendu() {
  majBarre();
  const c = $('#contenu');
  if (!E.charge) {
    c.innerHTML = E.collecte
      ? '<div class="attente"><b>Première collecte en cours</b><span>Lecture des flux et classement des annonces. Comptez une vingtaine de secondes.</span><div class="progres"></div></div>'
      : `<div class="attente"><b>Aucune donnée pour l’instant</b><span>${E.api ? 'Lancez une première collecte avec le bouton Actualiser.' : 'Lancez d’abord la collecte : node collecte.js'}</span></div>`;
    return;
  }
  if (E.vue === 'opportunites' || E.vue === 'echeances') {
    c.innerHTML = vueListe();
    majListe();
    majFiche();
  } else {
    c.innerHTML = { calendrier: vueCalendrier, manuelle: vueManuelle, sources: vueSources }[E.vue]();
  }
}

let minuterieToast;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => el.classList.remove('visible'), 3600);
}

async function actualiser() {
  if (E.collecte || !E.api) return;
  E.collecte = true;
  rendu();
  let message;
  try {
    const d = await (await fetch('api/actualiser', { method: 'POST' })).json();
    if (d.recente) message = `Collecte déjà faite ${ilYA(E.maj)}. Prochaine possible dans ${d.attendre} min.`;
    else if (d.ok) {
      const erreurs = d.bilan.sourcesEnErreur.length;
      message = `${d.bilan.nouveaux} nouvelles annonces · ${d.bilan.sourcesLues} sources lues${erreurs ? ` · ${erreurs} en erreur` : ''}`;
    } else message = `La collecte a échoué : ${d.erreur}`;
  } catch {
    message = 'Le serveur local ne répond pas.';
  }
  await chargerDonnees();
  E.collecte = false;
  rendu();
  toast(message);
}

function changerTheme() {
  const racine = document.documentElement;
  const suivant = { undefined: 'light', light: 'dark', dark: undefined }[racine.dataset.theme];
  if (suivant) racine.dataset.theme = suivant; else delete racine.dataset.theme;
  try { suivant ? localStorage.setItem('veille-theme', suivant) : localStorage.removeItem('veille-theme'); } catch { /* stockage indisponible */ }
  majBarre();
}

// ---------- Événements ----------
const RETENUE = 'Retenue : un rappel apparaîtra avant la date limite.';
const ECARTEE = 'Écartée. Elle reste consultable dans « Écartées ».';

document.addEventListener('click', ev => {
  const t = ev.target;
  const ouvert = $('details.filtre[open]');
  if (ouvert && !ouvert.contains(t)) ouvert.open = false;

  const vue = t.closest('[data-vue]');
  if (vue) { E.vue = vue.dataset.vue; E.sel = null; rendu(); $('#contenu').focus({ preventScroll: true }); return; }
  if (t.closest('#actualiser')) return void actualiser();
  if (t.closest('#theme')) return void changerTheme();

  const etoile = t.closest('[data-retenir]');
  if (etoile) return void basculer('retenues', etoile.dataset.retenir, RETENUE);
  if (t.closest('[data-suite]')) { E.limite += PAS; majListe(true); return; }
  const portee = t.closest('[data-portee]');
  if (portee) { E[E.vue === 'echeances' ? 'porteeEch' : 'portee'] = portee.dataset.portee; E.sel = null; rendu(); return; }
  const sites = t.closest('[data-sites]');
  if (sites) { E.porteeSites = sites.dataset.sites; rendu(); return; }

  const action = t.closest('[data-action]');
  if (action && E.sel) {
    const a = action.dataset.action;
    if (a === 'fermer') return void selectionner(null);
    if (a === 'retenir') return void basculer('retenues', E.sel, RETENUE);
    if (a === 'ecarter') return void basculer('ecartees', E.sel, ECARTEE);
    const valeur = a === 'avis-oui' ? 'oui' : 'non';
    if (E.etat.avis[E.sel] === valeur) delete E.etat.avis[E.sel]; else E.etat.avis[E.sel] = valeur;
    apresChangement();
    return;
  }

  const adresse = t.closest('a[data-site]');
  if (adresse) { E.etat.visites[adresse.dataset.site] = new Date().toISOString(); sauver(); setTimeout(rendu, 400); return; }
  const visite = t.closest('[data-visite]');
  if (visite) {
    const id = visite.dataset.visite;
    const site = E.manuelles.find(s => s.id === id);
    if (E.etat.visites[id] && site && !aVisiter(site)) delete E.etat.visites[id]; else E.etat.visites[id] = new Date().toISOString();
    sauver(); rendu();
    return;
  }

  const li = t.closest('.ligne');
  if (li) selectionner(li.dataset.id);
});

document.addEventListener('toggle', ev => {
  if (ev.target.matches('details.filtre') && ev.target.open) {
    for (const d of document.querySelectorAll('details.filtre[open]')) if (d !== ev.target) d.open = false;
  }
}, true);

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset.filtre) {
    const jeu = E.f[t.dataset.filtre];
    if (t.checked) jeu.add(t.value); else jeu.delete(t.value);
    const groupe = t.closest('details');
    groupe.classList.toggle('modifie', [...jeu].sort().join() !== [...DEFAUT[t.dataset.filtre]].sort().join());
    majListe();
  } else if (t.id === 'tri') { E.tri = t.value; majListe(); }
});

// La recherche attend une courte pause dans la frappe avant de filtrer.
let minuterieRecherche;
document.addEventListener('input', ev => {
  if (ev.target.id !== 'q') return;
  const valeur = ev.target.value.trim();
  clearTimeout(minuterieRecherche);
  minuterieRecherche = setTimeout(() => { E.q = valeur; majListe(); }, 150);
});

// En approchant du bas de la liste, on dessine les lignes suivantes.
document.addEventListener('scroll', ev => {
  const el = ev.target;
  if (el.id !== 'liste' || E.limite >= E.visibles.length) return;
  if (el.scrollTop + el.clientHeight > el.scrollHeight - 800) { E.limite += PAS; majListe(true); }
}, true);

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    const ouvert = $('details.filtre[open]');
    if (ouvert) ouvert.open = false; else if (E.sel) selectionner(null);
    return;
  }
  const dansChamp = ev.target instanceof Element && ev.target.matches('input, select, textarea');
  if (dansChamp || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (E.vue !== 'opportunites' && E.vue !== 'echeances') return;
  const i = E.visibles.indexOf(E.sel);
  const touche = ev.key.toLowerCase();
  if (ev.key === 'ArrowDown' || touche === 'j') { ev.preventDefault(); selectionner(E.visibles[Math.min(i + 1, E.visibles.length - 1)] || null); }
  else if (ev.key === 'ArrowUp' || touche === 'k') { ev.preventDefault(); selectionner(E.visibles[Math.max(i - 1, 0)] || null); }
  else if (ev.key === '/') { ev.preventDefault(); $('#q').focus(); }
  else if (!E.sel) return;
  else if (touche === 's') basculer('retenues', E.sel, RETENUE);
  else if (touche === 'x') basculer('ecartees', E.sel, ECARTEE);
  else if (ev.key === 'Enter') { const o = E.items.find(x => x.id === E.sel); if (o) window.open(lienSur(o.lien), '_blank', 'noopener'); }
});

// ---------- Démarrage ----------
(async () => {
  try { const t = localStorage.getItem('veille-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* stockage indisponible */ }
  await chargerEtat();
  const pret = await chargerDonnees();
  rendu();
  if (!pret && E.api) actualiser();
})();
})();
