'use strict';
// Collecte les flux, classe chaque annonce et met à jour l'archive donnees/opportunites.json.
// Aucune dépendance : Node 18 ou plus récent suffit.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lireJson, lireAvecSecours, ecrireSur, cheminSecours } = require('./fichiers');

const RACINE = __dirname;
// Les deux variables d'environnement servent aux tests, qui travaillent dans un dossier temporaire.
const DONNEES = process.env.VEILLE_DONNEES || path.join(RACINE, 'donnees');
const F_CONFIG = process.env.VEILLE_CONFIG || path.join(RACINE, 'config.json');
// Réglages propres à cette machine (jeton Telegram, par exemple) : non suivi par Git.
// Ignorés pendant les tests, pour qu'un jeton réel ne serve jamais à un essai.
const F_CONFIG_LOCAL = process.env.VEILLE_CONFIG ? '' : path.join(RACINE, 'config.local.json');
const F_ARCHIVE = path.join(DONNEES, 'opportunites.json');
const F_REPERAGES = path.join(DONNEES, 'reperages.json');
const F_MANUELLES = path.join(DONNEES, 'sources-manuelles.json');
const F_ETAT = path.join(DONNEES, 'etat.json');
const F_RESUME = path.join(DONNEES, 'resume.txt');

const AGENT = 'VeilleMadagascar/0.1 (veille personnelle, collecte moderee)';
const JOUR = 86400000;

// Plafonds : une source défaillante ou hostile ne doit ni saturer la mémoire ni bloquer la collecte.
const MAX_REPONSE = 5 * 1024 * 1024;
const MAX_ARTICLES = 200;
const MAX_BLOC = 100000;
const MAX_ARTICLE = 20000;

// À augmenter quand les règles de classement changent : les sources sont alors relues en entier
// au lieu de répondre « rien de neuf », et leurs annonces reclassées.
const REGLES = 2;
// Marge laissée aux retards de la planification quand une source a son propre rythme.
const TOLERANCE = 20 * 60000;

const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[’‘`]/g, "'");
const isoJour = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------- Lecture des flux ----------

const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', euro: '€', pound: '£',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î',
};
const point = n => { try { return String.fromCodePoint(n); } catch { return ''; } };
const decoder = s => s
  .replace(/&#(\d+);/g, (_, n) => point(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => point(parseInt(h, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n.toLowerCase()] ?? m);

// Le découpage ci-dessous avance par recherche directe, sans expression régulière à retour arrière :
// son temps reste proportionnel à la taille du texte, même si des balises ne sont jamais fermées.

// Retire les blocs <script>, <style>, <ins> et <figure> avec leur contenu.
function retirerBlocs(html) {
  const bas = html.toLowerCase();
  const debuts = /<(script|style|ins|figure)\b/g;
  const jamaisFerme = new Set();
  let sortie = '', pos = 0, m;
  while ((m = debuts.exec(bas))) {
    if (jamaisFerme.has(m[1])) continue;
    const fin = bas.indexOf(`</${m[1]}`, debuts.lastIndex);
    if (fin === -1) { jamaisFerme.add(m[1]); continue; }
    const chevron = bas.indexOf('>', fin);
    sortie += `${html.slice(pos, m.index)} `;
    pos = chevron === -1 ? html.length : chevron + 1;
    debuts.lastIndex = pos;
  }
  return sortie + html.slice(pos);
}

function texte(html) {
  if (!html) return '';
  let t = decoder(html.replace(/<!\[CDATA\[|\]\]>/g, '').slice(0, MAX_ARTICLE));
  t = retirerBlocs(t)
    .replace(/<\/(?:p|div|li|h\d|tr|td|th)>|<br\s*\/?>/gi, '. ')
    .replace(/<[^<>]*>/g, ' ');
  return decoder(t).replace(/\s+/g, ' ').replace(/ ([.,;:])/g, '$1').replace(/([.!?:;])\.(?=\s|$)/g, '$1').replace(/\.{2,}/g, '.').trim();
}

const ESPACES = '> \n\t\r/';

// Blocs <nom>…</nom> d'un flux : les articles.
function decouper(xml, nom) {
  const bas = xml.toLowerCase();
  const debut = `<${nom}`, fin = `</${nom}>`, blocs = [];
  let pos = 0;
  while (blocs.length < MAX_ARTICLES) {
    const d = bas.indexOf(debut, pos);
    if (d === -1) break;
    if (!ESPACES.includes(bas[d + debut.length])) { pos = d + debut.length; continue; }
    const f = bas.indexOf(fin, d);
    if (f === -1) break;
    const brut = xml.slice(d, Math.min(f + fin.length, d + MAX_BLOC));
    blocs.push({ brut, bas: brut.toLowerCase() });
    pos = f + fin.length;
  }
  return blocs;
}

// Contenus des balises <nom> d'un article.
function contenus(bloc, nom, max = 80) {
  // La recherche se fait dans la copie en minuscules : « pubDate » y est écrit « pubdate ».
  const debut = `<${nom.toLowerCase()}`, fin = `</${nom.toLowerCase()}>`, trouves = [];
  let pos = 0;
  while (trouves.length < max) {
    const d = bloc.bas.indexOf(debut, pos);
    if (d === -1) break;
    if (!ESPACES.includes(bloc.bas[d + debut.length])) { pos = d + debut.length; continue; }
    const ouvre = bloc.bas.indexOf('>', d);
    if (ouvre === -1) break;
    if (bloc.bas[ouvre - 1] === '/') { pos = ouvre + 1; continue; }
    const f = bloc.bas.indexOf(fin, ouvre);
    if (f === -1) break;
    trouves.push(bloc.brut.slice(ouvre + 1, f));
    pos = f + fin.length;
  }
  return trouves;
}
const contenu = (bloc, nom) => contenus(bloc, nom, 1)[0] || '';

// Télécharge une source. Si elle a déjà été lue, on lui présente ce qu'elle avait annoncé la fois précédente :
// elle répond alors 304, sans renvoyer son contenu, quand rien n'a changé.
async function telecharger(url, deja = {}) {
  const arret = new AbortController();
  const minuterie = setTimeout(() => arret.abort(), 30000);
  const entetes = { 'User-Agent': AGENT, Accept: 'application/rss+xml, application/xml, application/json, text/xml, */*' };
  if (deja.etag) entetes['If-None-Match'] = deja.etag;
  if (deja.lastModified) entetes['If-Modified-Since'] = deja.lastModified;
  try {
    const rep = await fetch(url, { signal: arret.signal, headers: entetes });
    if (rep.status === 304) return { inchange: true };
    if (!rep.ok) throw new Error(rep.status === 429 ? 'trop de requêtes (429)' : `réponse ${rep.status}`);
    if (Number(rep.headers.get('content-length')) > MAX_REPONSE || !rep.body) throw new Error('réponse trop volumineuse ou vide');
    const morceaux = [];
    let taille = 0;
    for await (const morceau of rep.body) {
      taille += morceau.length;
      if (taille > MAX_REPONSE) { arret.abort(); throw new Error('réponse trop volumineuse'); }
      morceaux.push(morceau);
    }
    return {
      corps: Buffer.concat(morceaux).toString('utf8'),
      etag: rep.headers.get('etag') || null,
      lastModified: rep.headers.get('last-modified') || null,
    };
  } finally {
    clearTimeout(minuterie);
  }
}

// Mention ajoutée par les sites en fin d'article : sans intérêt, et elle fausse le classement.
const RE_SIGNATURE = /(The post|Cet article|L’article|L'article) .{0,400}?(appeared first on|first appeared on|est apparu en premier sur).*$/i;

// Chaque lecteur reçoit le contenu téléchargé et rend les articles bruts.
const LECTEURS = {
  rss(xml) {
    let articles = decouper(xml, 'item');
    if (!articles.length) articles = decouper(xml, 'entry');
    if (!articles.length && !/<(rss|feed|rdf)/i.test(xml.slice(0, 5000))) throw new Error('flux illisible');
    return articles.map(b => ({
      titre: texte(contenu(b, 'title')),
      lien: texte(contenu(b, 'link')) || (b.brut.match(/<link[^<>]*href="([^"<>]+)"/i) || [])[1] || '',
      date: texte(contenu(b, 'pubDate') || contenu(b, 'dc:date') || contenu(b, 'published') || contenu(b, 'updated')),
      categories: contenus(b, 'category').map(texte).filter(Boolean),
      texte: texte(contenu(b, 'content:encoded') || contenu(b, 'description') || contenu(b, 'summary'))
        .replace(RE_SIGNATURE, '').replace(/\s*(\[…\]|\[\.\.\.\]|Read more)\s*$/i, '').trim().slice(0, 4000),
    }));
  },

  // Avis de marchés des projets financés à Madagascar.
  'banque-mondiale'(json) {
    const data = JSON.parse(json);
    const TYPES = {
      'Invitation for Bids': 'Appel d’offres',
      'Request for Expression of Interest': 'Manifestation d’intérêt',
      'General Procurement Notice': 'Avis général de passation',
      'Specific Procurement Notice': 'Avis spécifique de passation',
      'Invitation for Prequalification': 'Préqualification',
    };
    return (data.procnotices || [])
      .filter(n => TYPES[n.notice_type])
      .map(n => ({
        titre: `${TYPES[n.notice_type]} : ${n.bid_description || n.project_name}`,
        lien: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
        date: n.noticedate,
        categories: [n.notice_type],
        texte: `Projet : ${n.project_name}. Organisme : ${n.contact_organization || 'non indiqué'}. Méthode : ${n.procurement_method_name || 'non indiquée'}. Référence : ${n.bid_reference_no || 'non indiquée'}.`,
        echeance: n.submission_deadline_date ? n.submission_deadline_date.slice(0, 10) : null,
      }));
  },
};

// ---------- Classement ----------

const MOIS = {
  jan: 1, january: 1, janvier: 1, janv: 1, feb: 2, february: 2, fevrier: 2, fev: 2, fevr: 2, mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avril: 4, avr: 4, may: 5, mai: 5, jun: 6, june: 6, juin: 6, jul: 7, july: 7, juillet: 7, juil: 7,
  aug: 8, august: 8, aout: 8, sep: 9, sept: 9, september: 9, septembre: 9, oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12,
};
const M = Object.keys(MOIS).sort((a, b) => b.length - a.length).join('|');
const RE_DATE = `(?:(\\d{1,2})(?:st|nd|rd|th|er)?[\\s\\-/.]+(${M})\\.?,?[\\s\\-/.]+(\\d{4})|(${M})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})|(\\d{4})-(\\d{2})-(\\d{2}))`;
const RE_CLE = "(?:application deadline|submission deadline|deadline|closing date|closes? on|open until|accepted until|until|date limite|date de cloture|cloture|jusqu'au|au plus tard le|avant le|apply by|due by|due date|submitted by|received by)";
const RE_ECHEANCE = new RegExp(`${RE_CLE}[^\\d\\n]{0,45}?${RE_DATE}`, 'i');

// Ne retient une date que si elle suit un mot-clé d'échéance : on ne devine pas.
function trouverEcheance(brut) {
  const m = norm(brut).match(RE_ECHEANCE);
  if (!m) return null;
  let a, mo, j;
  if (m[3]) [j, mo, a] = [Number(m[1]), MOIS[m[2]], Number(m[3])];
  else if (m[6]) [mo, j, a] = [MOIS[m[4]], Number(m[5]), Number(m[6])];
  else [a, mo, j] = [Number(m[7]), Number(m[8]), Number(m[9])];
  const d = new Date(a, mo - 1, j);
  if (d.getMonth() !== mo - 1 || a < 2020 || a > 2100) return null;
  return isoJour(d);
}

const RE_MONTANT = /(?:(?:us\$|usd|eur|gbp|chf|cad|aud|\$|€|£)\s?\d[\d,. ]*\d(?:\s?(?:k\b|million|millions|m\b))?|\d[\d,. ]*\d\s?(?:millions? (?:de |d')?)?(?:usd|us dollars|dollars|euros?|eur|gbp|pounds|chf|cad|aud|ariary|mga)\b)/i;
const trouverMontant = brut => {
  const m = brut.match(RE_MONTANT);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
};

const RE_TYPES = [
  ['emploi', /\brecrute|\brecrutement|\bjobs?\b|\bvacanc|\bhiring\b|\bstagiaires?\b|\bstages?\b|\binternships?\b|\binterns\b|\bvolontaires?\b|\bvolunteers?\b|offre d'emploi|\bcareers?\b/],
  ['marche', /\btenders?\b|appels? d'offres|\brfp\b|\brfq\b|\bitb\b|manifestation d'interet|expression of interest|\beoi\b|procurement|invitation for bids|\bconsultan(?:t|ts|cy|ce)\b|prestataire|terms of reference|termes de reference|passation/],
  ['concours', /\bprizes?\b|\bprix\b|\bawards?\b|competition|\bchallenge|\bcontest|\bconcours|hackathon|\bpitch\b|trophee|fifaninanana/],
  ['bourse', /scholarship|fellowship|\bbourses?\b|vatsim-?pianarana/],
  ['appel', /\bgrants?\b|\bfunding\b|\bfunds?\b|call for proposals|appels? a (?:projets?|propositions?)|subvention|financement|request for proposals|call for (?:concept|letters)|\bcfps?\b|\bcfas?\b|\brfas?\b|seed (?:funding|capital)|famatsiam-bola/],
  ['bourse', /\btraining\b|\bformations?\b|\bprogram(?:me)?s?\b|accelerat|incubat|bootcamp|\bcourses?\b|\bmooc\b|summer school|mentor|residenc|exchange|leadership|workshop|fanofanana/],
];
const TYPE_PAR_CATEGORIE = [
  ['bourse', /fellowships?|scholarships?|workshops?|training|internships? abroad/],
  ['concours', /awards?|prizes?|competitions?|contests?/],
  ['appel', /^grants?$|funding/],
  ['emploi', /^jobs?$|^internships?$|careers?/],
];
const TYPE_PAR_ADRESSE = {
  'avis-de-recrutement': 'emploi', stages: 'emploi', volontaires: 'emploi', emplois: 'emploi',
  'appel-doffres': 'marche', 'appels-doffres': 'marche', consultance: 'marche',
  bourses: 'bourse', formations: 'bourse', concours: 'concours',
  'appel-a-projets': 'appel', 'appels-a-projets': 'appel', financements: 'appel',
};

function trouverType(b, source) {
  const segment = source.zone === 'pays-url' && (b.lien.match(/\/opportunite\/[^/]+\/([^/]+)\//) || [])[1];
  if (segment && TYPE_PAR_ADRESSE[segment]) return TYPE_PAR_ADRESSE[segment];
  if (source.typeForce) return source.typeForce;
  const titre = norm(b.titre);
  for (const [type, re] of RE_TYPES) if (re.test(titre)) return type;
  const cats = b.categories.map(norm);
  for (const [type, re] of TYPE_PAR_CATEGORIE) if (cats.some(c => re.test(c))) return type;
  if (source.typeDefaut) return source.typeDefaut;
  const corps = norm(b.texte).slice(0, 600);
  for (const [type, re] of RE_TYPES) if (re.test(corps)) return type;
  return 'autre';
}

const RE_PORTEURS = {
  jeunes: /\byouth\b|\byoung\b|\bjeunes?\b|jeunesse|\bstudents?\b|etudiant|under (?:30|35|40)\b|early[- ]career|\btanora\b|emerging leaders|high school/,
  associations: /\bngos?\b|\bong\b|\bcsos?\b|\bosc\b|civil society|societe civile|non-?profits?|\bassociations?\b|community[- ]based|community projects|grassroots|organisations? (?:locales?|communautaires?)|charit/,
  entrepreneurs: /entrepreneu|start-?ups?|\bsmes?\b|\bpme\b|\btpe\b|business|\bventures?\b|innovat|founders?|agripreneur|mpandraharaha|enterprise/,
  femmes: /\bwomen\b|\bwoman|\bfemale\b|\bfemmes?\b|\bgirls?\b|feminist|\bgender\b|\bgenre\b|vehivavy/,
  chercheurs: /\bresearch|\bphd\b|postdoc|doctora|scientist|chercheu|\bacademic|\bscholars\b|universit/,
  artistes: /\bartists?\b|\bartistes?\b|creativ|\bfilm|\bmusic|musique|\bwriters?\b|ecrivain|journalis|photograph|\bculture\b|culturel|\bmedia\b/,
};
const RE_THEMES = {
  agriculture: /agri|farming|farmer|\bfood\b|aliment|fisher|\bpeche\b|livestock|elevage|\brural/,
  environnement: /environment|environnement|climat|biodivers|conservation|forest|foret|wildlife|\bocean|marine|ecosystem|\bnature\b|restoration/,
  numerique: /digital|numerique|\btech\b|technolog|\bai\b|artificial intelligence|intelligence artificielle|software|coding|\bdata\b|cyber|internet|mobile/,
  sante: /health|sante|medical|\bhiv\b|malaria|nutrition/,
  education: /education|school|\becole|teaching|enseign|literacy|learning|scolaire/,
  energie: /energy|energie|solar|solaire|renewable|renouvelable|electri/,
  gouvernance: /governance|gouvernance|democra|human rights|droits humains|droits de l'homme|justice|\bpeace|\bpaix\b|transparen|civic|citoyen/,
  eau: /\bwater\b|\beau\b|sanitation|assainissement|hygiene/,
};
const marqueurs = (table, t) => Object.keys(table).filter(k => table[k].test(t));

const AUTRES_PAYS = [
  'nigeria', 'nigerian', 'nigerians', 'kenya', 'kenyan', 'kenyans', 'ghana', 'ghanaian', 'ghanaians', 'south africa', 'south african',
  'south africans', 'uganda', 'ugandan', 'ugandans', 'tanzania', 'tanzanian', 'rwanda', 'rwandan', 'ethiopia', 'ethiopian',
  'senegal', 'senegalese', 'cameroon', 'cameroun', 'cameroonian', "cote d'ivoire", 'ivory coast', 'ivorian', 'zimbabwe',
  'zimbabwean', 'zambia', 'zambian', 'malawi', 'malawian', 'mozambique', 'mozambican', 'namibia', 'namibian', 'botswana',
  'liberia', 'liberian', 'sierra leone', 'gambia', 'gambian', 'mali', 'malian', 'burkina faso', 'niger', 'togo', 'benin',
  'drc', 'rdc', 'rdcongo', 'congo', 'angola', 'somalia', 'somali', 'sudan', 'sudanese', 'egypt', 'egyptian', 'morocco', 'maroc',
  'moroccan', 'tunisia', 'tunisie', 'tunisian', 'algeria', 'algerie', 'algerian', 'libya', 'mauritius', 'seychelles',
  'comoros', 'comores', 'lesotho', 'eswatini', 'burundi', 'chad', 'tchad', 'guinea', 'guinee', 'gabon', 'mauritania',
  'mauritanie', 'cabo verde', 'djibouti', 'eritrea',
  'mena', 'middle east', 'north africa', 'afrique du nord', 'west africa', 'west african', "afrique de l'ouest",
  'central africa', 'afrique centrale', 'sahel', 'horn of africa', 'arab', 'caribbean', 'caraibes', 'asia-pacific', 'pacific',
  'latin america', 'amerique latine', 'commonwealth', 'balkans',
];
const RE_AUTRES_PAYS = new RegExp(`\\b(${AUTRES_PAYS.join('|')})\\b`);
const LOINTAINS = 'canada|united kingdom|uk|us|usa|united states|australia|new zealand|ireland|scotland|england|wales|india|germany|france|kosovo|ukraine|japan|china|brazil|mexico|pakistan|bangladesh|nepal|philippines|indonesia|europe|european|eu';
// « (Canada) », « (UK, Ireland) » ou « … in Canada » en fin de titre : l'annonce est réservée à ce pays.
const RE_TITRE_LOINTAIN = new RegExp(`\\(\\s*(?:${LOINTAINS})(?:\\s*,\\s*(?:${LOINTAINS}))*\\s*\\)|(?:\\bin|[–-])\\s+(?:${LOINTAINS})\\s*$`);
const RE_PAYS_LOINTAIN = new RegExp(`\\b(?:${LOINTAINS})\\b`);
const RE_VOISINS =/\b(southern africa|east(?:ern)? africa|eastern and southern africa|afrique australe|afrique de l'est)\b/;
const RE_MADAGASCAR = /madagascar|malagasy|malgache|madagasikara/;
const ZONES_CATEGORIE = new Set([
  'africa', 'sub-saharan africa', 'asia', 'asia-pacific', 'lac', 'europe', 'america', 'north america', 'south america',
  'australia and oceania', 'middle east and north africa', 'latin america and the caribbean', 'mena', 'worldwide',
]);
const ENSEMBLES = [
  [/sub[- ]?saharan|afrique subsaharienne|subsaharien/, 'Afrique subsaharienne'],
  [/least developed countr|\bldcs?\b|pays les moins avances|\bpma\b/, 'pays les moins avancés'],
  [/\bacp\b|\boacps\b|\boeacp\b/, 'pays ACP'],
  [/francophon/, 'espace francophone'],
  [/indian ocean|ocean indien/, 'océan Indien'],
  [/\bsadc\b|\bcomesa\b/, 'SADC ou COMESA'],
  [/african union|union africaine/, 'Union africaine'],
  [/developing countr|pays en (?:voie de )?developpement|low[- ]and[- ]middle[- ]income|low[- ]income countr|\blmics?\b|global south|oda[- ]eligible/, 'pays en développement'],
  [/\bafrica\b|\bafricans?\b|\bafrique\b|\bafricaine?s?\b/, 'Afrique'],
];
const RE_MONDIAL = /worldwide|world-wide|all countries|any country|all nationalities|any nationality|toutes (?:les )?nationalites|monde entier|international applicants|international students|open to all|around the world|all over the world|from any country/;

// Renvoie la phrase d'origine qui justifie le classement, pour que l'utilisateur puisse juger.
function citer(brut, re) {
  for (const phrase of brut.split(/(?<=[.!?])\s+/)) {
    if (re.test(norm(phrase))) return phrase.length > 260 ? `${phrase.slice(0, 257).trimEnd()}…` : phrase;
  }
  return null;
}

function trouverEligibilite(b, source) {
  const titre = norm(b.titre);
  const cats = b.categories.map(norm);
  const brut = `${b.titre}. ${b.texte}`;
  const tout = norm(`${brut} ${b.categories.join(' . ')}`);

  if (source.presse) return ['madagascar', 'Annonce relayée par la presse malgache.'];
  if (source.type === 'banque-mondiale') return ['madagascar', 'Marché d’un projet financé à Madagascar.'];

  const pays = cats.map(c => (c.match(/^latest grants and resources in (.+)$/) || [])[1]).filter(Boolean);
  if (pays.length) {
    if (pays.includes('madagascar')) return ['madagascar', `Madagascar figure parmi les ${pays.length} pays listés par la source.`];
    const apercu = pays.slice(0, 4).map(p => p.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
    return ['autre', `Pays listés par la source, sans Madagascar : ${apercu}${pays.length > 4 ? '…' : ''}`];
  }

  if (RE_MADAGASCAR.test(tout)) return ['madagascar', citer(brut, RE_MADAGASCAR) || 'Madagascar est cité dans l’annonce.'];

  if (source.zone === 'pays-url') {
    const lieu = (b.lien.match(/\/opportunite\/([^/]+)\//) || [])[1];
    if (lieu && !/^(international|afrique|monde)$/.test(lieu)) {
      if (/en ligne|a distance|teletravail|\bremote\b|\bonline\b/.test(tout)) return ['mondial', 'Mission annoncée en ligne ou à distance.'];
      return ['autre', `Annonce classée par la source dans : ${lieu}.`];
    }
  }

  const ailleurs = `${titre} . ${norm(b.texte.slice(0, 220))}`.match(RE_AUTRES_PAYS)
    || titre.match(RE_TITRE_LOINTAIN) || (source.paysDansTitre && titre.match(RE_PAYS_LOINTAIN));
  if (ailleurs) return ['autre', `L’annonce vise une autre zone : ${ailleurs[0].replace(/[()]/g, '').replace(/^s*(?:in|[–-])s+/, '').trim()}.`];
  if (RE_VOISINS.test(titre)) return ['verifier', 'Le titre vise l’Afrique australe ou de l’Est : Madagascar n’y est pas toujours inclus.'];

  const zones = cats.filter(c => ZONES_CATEGORIE.has(c));
  if (zones.length) {
    const afrique = zones.some(z => z === 'africa' || z === 'sub-saharan africa');
    if (zones.includes('worldwide') || (afrique && zones.length >= 4)) return ['mondial', 'La source classe l’annonce comme ouverte au monde entier.'];
    if (afrique) return ['ensemble', 'La source classe l’annonce dans la zone Afrique.'];
    return ['autre', `Zones indiquées par la source : ${zones.join(', ')}.`];
  }

  for (const [re, nom] of ENSEMBLES) if (re.test(tout)) return ['ensemble', citer(brut, re) || `Zone citée : ${nom}.`];
  if (RE_MONDIAL.test(tout)) return ['mondial', citer(brut, RE_MONDIAL) || 'Annonce présentée comme ouverte à tous les pays.'];
  if (source.zone === 'afrique') return ['ensemble', 'Source destinée aux candidats africains.'];
  return ['verifier', 'Aucune indication de pays repérée dans le flux.'];
}

const RE_PRESSE = /appels? a (?:projets?|candidatures?|propositions?|manifestation)|candidatures? (?:sont )?ouvertes?|\bconcours\b|\bbourses? (?:d'|de |a )|subvention|\bchallenge\b|hackathon|start-?ups?|incubat|trophee|fellowship|\bpoesam\b|appels? d'offres|fifaninanana|vatsim-?pianarana|tanora mpandraharaha/;
const RE_LANGUE = {
  fr: /\b(le|la|les|des|pour|une|est|dans|avec|aux|sur)\b/g,
  en: /\b(the|and|for|of|to|with|are|from|this|will)\b/g,
  mg: /\b(ny|sy|amin|dia|izay|ho|fa|tamin|ireo|ary)\b/g,
};
function trouverLangue(t) {
  const n = norm(t).slice(0, 1200);
  let meilleure = 'fr', max = 0;
  for (const [langue, re] of Object.entries(RE_LANGUE)) {
    const c = (n.match(re) || []).length;
    if (c > max) [meilleure, max] = [langue, c];
  }
  return meilleure;
}

const POIDS_ELIG = { madagascar: 55, ensemble: 40, mondial: 28, verifier: 15, autre: 0 };
const POIDS_TYPE = { appel: 20, concours: 20, bourse: 16, autre: 6, emploi: 2, marche: 0 };

function noter(o, profil, aujourdhui) {
  let score = POIDS_ELIG[o.eligibilite] + POIDS_TYPE[o.type];
  score += Math.min(12, 4 * o.porteurs.filter(p => (profil.porteurs || []).includes(p)).length);
  score += Math.min(9, 3 * o.themes.filter(t => (profil.themes || []).includes(t)).length);
  if (o.echeance) {
    const reste = (new Date(o.echeance) - aujourdhui) / JOUR;
    if (reste >= 0 && reste <= 14) score += 6;
  }
  if (o.presse) score -= 35;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function classer(b, source, profil, maintenant) {
  if (!b.titre || !/^https?:\/\//i.test(b.lien)) return null;
  const tout = norm(`${b.titre} ${b.texte} ${b.categories.join(' ')}`);
  if (source.presse && !RE_PRESSE.test(norm(`${b.titre} ${b.texte.slice(0, 500)}`))) return null;
  if ((profil.motsExclus || []).some(mot => mot && tout.includes(norm(mot)))) return null;

  const [eligibilite, preuve] = trouverEligibilite(b, source);
  const publie = b.date && !Number.isNaN(Date.parse(b.date)) ? new Date(b.date).toISOString() : null;
  const resume = b.texte;
  const o = {
    id: crypto.createHash('sha1').update(b.lien.split('?')[0]).digest('hex').slice(0, 12),
    titre: b.titre.slice(0, 240),
    lien: b.lien,
    source: source.id,
    sourceNom: source.nom,
    publie,
    type: trouverType(b, source),
    eligibilite,
    preuve,
    porteurs: marqueurs(RE_PORTEURS, tout),
    themes: marqueurs(RE_THEMES, tout),
    echeance: b.echeance !== undefined ? b.echeance : trouverEcheance(`${b.titre}. ${b.texte}`),
    montant: trouverMontant(`${b.titre}. ${b.texte}`),
    langue: trouverLangue(`${b.titre} ${b.texte}`),
    resume: resume.length > 320 ? `${resume.slice(0, 317).trimEnd()}…` : resume,
    aussiSur: [],
  };
  if (source.presse) o.presse = true;
  o.score = noter(o, profil, maintenant);
  return o;
}

// ---------- Dédoublonnage ----------

const MOTS_VIDES = new Set(['the', 'for', 'and', 'with', 'from', 'call', 'apply', 'now', 'applications', 'application', 'open',
  'pour', 'les', 'des', 'aux', 'une', 'sur', 'dans', 'appel', 'fully', 'funded', 'programme', 'program', 'new']);
const jetons = titre => new Set(norm(titre).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter(m => m.length > 2 && !MOTS_VIDES.has(m) && !/^20\d\d$/.test(m)));
const RANG_ELIG = { madagascar: 4, ensemble: 3, mondial: 2, verifier: 1, autre: 0 };

function dedoublonner(items) {
  const gardes = [];
  const tries = [...items].sort((a, b) => a.premiereVue.localeCompare(b.premiereVue) || a.id.localeCompare(b.id));
  for (const o of tries) {
    const j = jetons(o.titre);
    const double = j.size >= 3 && gardes.find(g => {
      if (g.source === o.source) return false;
      let communs = 0;
      for (const m of j) if (g.jetons.has(m)) communs++;
      if (communs / (j.size + g.jetons.size - communs) >= 0.72) return true;
      // Titre court contenu dans un titre long, avec la même date limite.
      const petit = Math.min(j.size, g.jetons.size);
      return petit >= 4 && communs / petit >= 0.8 && (!o.echeance || !g.o.echeance || o.echeance === g.o.echeance);
    });
    if (!double) { gardes.push({ o, jetons: j, source: o.source }); continue; }
    const g = double.o;
    if (!g.aussiSur.includes(o.sourceNom) && g.sourceNom !== o.sourceNom) g.aussiSur.push(o.sourceNom);
    if (!g.echeance && o.echeance) g.echeance = o.echeance;
    if (!g.montant && o.montant) g.montant = o.montant;
    // Une restriction lue par une source l'emporte sur le classement large d'une autre.
    if (o.eligibilite === 'autre' && g.eligibilite !== 'madagascar') [g.eligibilite, g.preuve] = [o.eligibilite, o.preuve];
    else if (g.eligibilite !== 'autre' && RANG_ELIG[o.eligibilite] > RANG_ELIG[g.eligibilite]) [g.eligibilite, g.preuve] = [o.eligibilite, o.preuve];
  }
  return gardes.map(g => g.o);
}

// ---------- Résumé du jour ----------

const MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const dateCourte = iso => { const [, m, j] = iso.split('-').map(Number); return `${j} ${MOIS_FR[m - 1]}`; };
const LIB_ELIG = { madagascar: 'Madagascar cité', ensemble: 'Ensemble régional', mondial: 'Ouvert au monde', verifier: 'À vérifier', autre: 'Autre zone' };

function sitesAVisiter(etat, maintenant) {
  const sites = lireJson(F_MANUELLES, []);
  const DELAI = { semaine: 7, mois: 30, trimestre: 90 };
  return sites.filter(s => {
    if (!s.url) return false;
    const visite = etat.visites && etat.visites[s.id] ? new Date(etat.visites[s.id]) : null;
    if (s.rythme === 'saison') {
      return (s.mois || []).includes(maintenant.getMonth() + 1)
        && !(visite && visite.getMonth() === maintenant.getMonth() && visite.getFullYear() === maintenant.getFullYear());
    }
    return !visite || (maintenant - visite) / JOUR > DELAI[s.rythme];
  });
}

function redigerResume(items, nouveaux, etat, maintenant) {
  const jour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  const reste = o => Math.round((new Date(`${o.echeance}T00:00:00`) - jour) / JOUR);
  const lignes = [`Veille Madagascar — ${maintenant.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`, ''];

  const rappels = items.filter(o => etat.retenues && etat.retenues[o.id] && o.echeance && reste(o) >= 0 && reste(o) <= 14)
    .sort((a, b) => a.echeance.localeCompare(b.echeance));
  if (rappels.length) {
    lignes.push('RAPPELS — opportunités retenues qui ferment sous 14 jours');
    for (const o of rappels) lignes.push(`- J-${reste(o)} (${dateCourte(o.echeance)}) ${o.titre}`, `  ${o.lien}`);
    lignes.push('');
  }

  const aMontrer = nouveaux.filter(o => o.eligibilite !== 'autre' && o.type !== 'emploi').sort((a, b) => b.score - a.score).slice(0, 15);
  lignes.push(`NOUVEAUTÉS — ${aMontrer.length} à lire sur ${nouveaux.length} annonces nouvelles`);
  aMontrer.forEach((o, i) => {
    const limite = o.echeance ? `limite ${dateCourte(o.echeance)}` : 'date limite inconnue';
    lignes.push(`${i + 1}. [${LIB_ELIG[o.eligibilite]}] ${o.titre}`, `   ${o.sourceNom} · ${limite}`, `   ${o.lien}`);
  });
  if (!aMontrer.length) lignes.push('Rien de nouveau depuis la dernière collecte.');

  // En ligne, les visites ne sont connues que du navigateur : la liste serait la même à chaque collecte.
  const sites = fs.existsSync(F_ETAT) ? sitesAVisiter(etat, maintenant) : [];
  if (sites.length) {
    lignes.push('', `À OUVRIR À LA MAIN — ${sites.length} sites`);
    for (const s of sites.slice(0, 12)) lignes.push(`- ${s.nom} : ${s.url}`);
    if (sites.length > 12) lignes.push(`- et ${sites.length - 12} autres, dans l'onglet Veille manuelle`);
  }
  return { texte: lignes.join('\n'), aSignaler: rappels.length + aMontrer.length > 0 };
}

// Envoi facultatif. Le jeton vient des variables d'environnement (secrets GitHub) ou de config.local.json,
// jamais d'un fichier suivi par Git.
async function envoyerTelegram(config, message) {
  const jeton = process.env.TELEGRAM_JETON || (config.telegram || {}).jeton;
  const destinataire = process.env.TELEGRAM_DESTINATAIRE || (config.telegram || {}).destinataire;
  if (!jeton || !destinataire) return null;
  for (let i = 0; i < message.length; i += 3800) {
    const rep = await fetch(`https://api.telegram.org/bot${jeton}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: destinataire, text: message.slice(i, i + 3800), disable_web_page_preview: true }),
    });
    if (!rep.ok) return `Telegram a répondu ${rep.status}`;
  }
  return 'envoyé';
}

// ---------- Collecte complète ----------

async function collecter() {
  const config = { ...lireJson(F_CONFIG, { sources: [], profil: {} }), ...lireJson(F_CONFIG_LOCAL, {}) };
  const profil = config.profil || {};
  const maintenant = new Date();
  const horodatage = maintenant.toISOString();
  const archive = lireAvecSecours(F_ARCHIVE, { items: [], sources: [] });
  const etat = lireJson(F_ETAT, {});
  const connus = new Map(archive.items.map(o => [o.id, o]));
  const etatsPrecedents = new Map((archive.sources || []).map(s => [s.id, s]));

  const sources = (config.sources || []).filter(s => s.actif !== false);
  const lectures = await Promise.all(sources.map(async source => {
    const precedent = etatsPrecedents.get(source.id) || {};
    // Empreinte de ce qui décide du classement : si elle change, la source est relue en entier.
    const regles = crypto.createHash('sha1').update(JSON.stringify([REGLES, profil, source])).digest('hex').slice(0, 10);
    const base = { source, precedent, regles };

    // Source à rythme lent (presse, marchés) : on ne la relit pas avant son délai.
    const delai = (source.intervalleHeures || 0) * 3600000;
    const depuis = precedent.dernierSucces ? maintenant - Date.parse(precedent.dernierSucces) : Infinity;
    if (delai && depuis < delai - TOLERANCE) return { ...base, reportee: true };

    try {
      const rep = await telecharger(source.url, precedent.regles === regles ? precedent : {});
      if (rep.inchange) return { ...base, inchange: true };
      return { ...base, bruts: LECTEURS[source.type](rep.corps, source), etag: rep.etag, lastModified: rep.lastModified };
    } catch (e) {
      return { ...base, erreur: e.name === 'AbortError' ? 'délai dépassé' : (e.cause && e.cause.code) || e.message };
    }
  }));

  const recoltes = [];
  const etatsSources = lectures.map(l => {
    const { source, precedent } = l;
    const identite = { id: source.id, nom: source.nom, url: source.url };
    if (l.reportee) return { ...precedent, ...identite };
    if (l.inchange) return { ...precedent, ...identite, ok: true, erreur: null, inchange: true, collecteLe: horodatage, dernierSucces: horodatage };
    const classes = (l.bruts || []).map(b => classer(b, source, profil, maintenant)).filter(Boolean);
    recoltes.push(...classes);
    const dates = (l.bruts || []).map(b => Date.parse(b.date)).filter(n => !Number.isNaN(n));
    return {
      ...identite, ok: !l.erreur, erreur: l.erreur || null, inchange: false,
      lus: l.bruts ? l.bruts.length : 0, gardes: classes.length,
      dernierArticle: dates.length ? new Date(Math.max(...dates)).toISOString() : precedent.dernierArticle || null,
      collecteLe: horodatage, dernierSucces: l.erreur ? precedent.dernierSucces || null : horodatage,
      // En cas d'erreur, on garde ce que la source avait annoncé la dernière fois qu'elle a répondu.
      etag: l.erreur ? precedent.etag || null : l.etag,
      lastModified: l.erreur ? precedent.lastModified || null : l.lastModified,
      regles: l.erreur ? precedent.regles || null : l.regles,
    };
  });

  // Repérages faits à la main : fiches vérifiées, hors flux.
  for (const r of lireJson(F_REPERAGES, [])) {
    const o = { source: 'reperage', sourceNom: 'Repérage manuel', publie: null, porteurs: [], themes: [], aussiSur: [], langue: 'fr', ...r };
    o.score = noter(o, profil, maintenant) + 5;
    recoltes.push(o);
  }

  for (const o of recoltes) {
    const ancien = connus.get(o.id);
    o.premiereVue = ancien ? ancien.premiereVue : horodatage;
    if (ancien && ancien.aussiSur) o.aussiSur = [...new Set([...ancien.aussiSur, ...o.aussiSur])];
    connus.set(o.id, o);
  }

  const aujourdhui = isoJour(maintenant);
  const retenues = etat.retenues || {};
  const vivants = [...connus.values()].filter(o => {
    if (retenues[o.id]) return true;
    if (o.source === 'reperage' && !recoltes.includes(o)) return false;
    // Les annonces réservées à d'autres pays sont masquées par défaut : une semaine suffit pour pouvoir les corriger.
    if (o.eligibilite === 'autre') return (maintenant - new Date(o.premiereVue)) / JOUR <= 7;
    if (o.echeance) return (new Date(aujourdhui) - new Date(o.echeance)) / JOUR <= 45;
    return (maintenant - new Date(o.publie || o.premiereVue)) / JOUR <= 75;
  });
  const items = dedoublonner(vivants).sort((a, b) => b.score - a.score).slice(0, 1200);
  const nouveaux = items.filter(o => o.premiereVue === horodatage);

  const bilan = {
    total: items.length,
    nouveaux: nouveaux.length,
    sourcesLues: etatsSources.filter(s => s.ok).length,
    sansChangement: lectures.filter(l => l.inchange).length,
    reportees: lectures.filter(l => l.reportee).length,
    sourcesEnErreur: etatsSources.filter(s => !s.ok).map(s => `${s.nom} : ${s.erreur}`),
  };

  // Garde-fou : une archive qui fond de plus de moitié en une collecte signale une erreur, pas une purge normale.
  const avant = (archive.items || []).length;
  if (avant >= 40 && items.length < avant / 2 && process.env.ACCEPTER_CHUTE !== '1') {
    throw new Error(`l'archive passerait de ${avant} à ${items.length} annonces : écriture refusée. Relancer avec ACCEPTER_CHUTE=1 si c'est voulu.`);
  }

  fs.mkdirSync(DONNEES, { recursive: true });
  // Première écriture de la journée : l'archive de la veille devient la copie de secours.
  // On réécrit l'archive telle qu'elle a été lue, et non le fichier, qui peut être celui qu'on vient de réparer.
  if (archive.majLe && archive.majLe.slice(0, 10) !== horodatage.slice(0, 10)) ecrireSur(cheminSecours(F_ARCHIVE), JSON.stringify(archive));
  ecrireSur(F_ARCHIVE, JSON.stringify({ majLe: horodatage, bilan, sources: etatsSources, items }));
  const resume = redigerResume(items, nouveaux, etat, maintenant);
  ecrireSur(F_RESUME, resume.texte);
  try {
    // Pas de message quand il n'y a rien de nouveau : la collecte tourne plusieurs fois par jour.
    bilan.telegram = resume.aSignaler ? await envoyerTelegram(config, resume.texte) : null;
  } catch (e) {
    bilan.telegram = `échec de l'envoi : ${e.message}`;
  }
  return bilan;
}

module.exports = {
  collecter, trouverEcheance, trouverEligibilite, trouverType, trouverMontant,
  texte, decouper, contenus, classer, dedoublonner, noter, LECTEURS, REGLES,
};

if (require.main === module) {
  collecter().then(bilan => {
    console.log(`${bilan.total} opportunités dans l'archive, dont ${bilan.nouveaux} nouvelles. ${bilan.sourcesLues} sources lues, dont ${bilan.sansChangement} sans changement et ${bilan.reportees} reportées.`);
    for (const e of bilan.sourcesEnErreur) console.log(`Source en erreur — ${e}`);
    if (bilan.telegram) console.log(`Telegram : ${bilan.telegram}`);
  }).catch(e => { console.error(e); process.exit(1); });
}
