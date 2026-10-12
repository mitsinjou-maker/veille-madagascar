# Veille Madagascar — première version

Outil local de veille des appels à projets, concours, bourses et marchés ouverts aux porteurs basés à Madagascar.

## En ligne

La version en ligne est à l'adresse <https://mitsinjou-maker.github.io/veille-madagascar/>.

Le flux `.github/workflows/collecte.yml` lance la collecte toutes les deux heures sur GitHub Actions, puis republie la page. L'archive des annonces est conservée sur la branche `donnees`.

- **Lancer une collecte à la main** : onglet Actions du dépôt, flux « Collecte et mise en ligne », bouton « Run workflow ».
- **Changer le rythme** : modifier la ligne `cron` du flux.
- **Recevoir le résumé sur Telegram** : ajouter les secrets `TELEGRAM_JETON` et `TELEGRAM_DESTINATAIRE` dans les réglages du dépôt (Settings, Secrets and variables, Actions). Un message part seulement quand une collecte trouve du nouveau.

En ligne, les annonces retenues, écartées et les visites sont enregistrées dans le navigateur de chaque appareil ; elles ne se synchronisent pas entre téléphone et ordinateur.

## Lancer sur son ordinateur

Double-cliquer sur `Lancer la veille.bat`. Le navigateur s'ouvre sur `http://localhost:4173`.
Laisser la fenêtre noire ouverte pendant l'utilisation ; la fermer arrête l'outil.

Il faut Node.js 18 ou plus récent. Aucune installation supplémentaire.

## Ce que fait l'outil

- **Opportunités** : annonces lues dans 9 sources, classées par pertinence. Chaque annonce porte une étiquette d'éligibilité et la phrase qui la justifie.
- **Échéances** : les mêmes annonces, rangées par date limite.
- **Calendrier annuel** : 28 appels qui reviennent chaque année, avec leur fenêtre habituelle.
- **Veille manuelle** : 37 sites à ouvrir soi-même, avec le rythme de visite et la date de dernière visite.
- **Sources** : état de chaque source et résumé de la dernière collecte.

Le bouton **Actualiser** relance la collecte, au plus une fois toutes les 15 minutes pour ménager les sites.

## Régler

| Fichier | Contenu |
| --- | --- |
| `config.json` | Profil (porteurs, thèmes, mots à exclure), liste des sources |
| `config.local.json` | Réglages propres à cet ordinateur, jamais envoyés sur GitHub (jeton Telegram) |
| `donnees/reperages.json` | Fiches saisies à la main |
| `donnees/sources-manuelles.json` | Sites de la veille manuelle |
| `donnees/calendrier.json` | Appels annuels |

`donnees/opportunites.json`, `donnees/etat.json` et `donnees/resume.txt` sont produits par l'outil.

## Collecter sans ouvrir l'interface

```bash
node collecte.js
```

Le résumé du jour est écrit dans `donnees/resume.txt`. Pour le recevoir sur Telegram depuis cet ordinateur, créer `config.local.json` :

```json
{ "telegram": { "jeton": "…", "destinataire": "…" } }
```

Cet envoi n'a pas encore été testé.

## Limites connues

- L'éligibilité est devinée par mots-clés, sans intelligence artificielle. Elle se trompe parfois : la phrase citée et les boutons Oui / Non de chaque fiche servent à corriger.
- Une date limite n'est retenue que si l'annonce l'écrit après un mot comme « deadline » ou « date limite ». Sinon elle reste inconnue.
- Les fiches de `reperages.json` et le calendrier datent du 12 octobre 2026 et ne se mettent pas à jour seuls.
- Les agrégateurs n'exposent que leurs 10 à 25 dernières annonces : entre deux collectes, certaines peuvent passer sans être vues.
- La page en ligne est publique. Elle demande aux moteurs de recherche de ne pas l'indexer, mais toute personne qui a le lien peut la lire.
