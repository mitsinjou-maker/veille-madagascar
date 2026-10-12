# Veille Madagascar — première version

Outil local de veille des appels à projets, concours, bourses et marchés ouverts aux porteurs basés à Madagascar.

## Lancer

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
| `config.json` | Profil (porteurs, thèmes, mots à exclure), liste des sources, Telegram |
| `donnees/reperages.json` | Fiches saisies à la main |
| `donnees/sources-manuelles.json` | Sites de la veille manuelle |
| `donnees/calendrier.json` | Appels annuels |

`donnees/opportunites.json`, `donnees/etat.json` et `donnees/resume.txt` sont produits par l'outil.

## Collecter sans ouvrir l'interface

```bash
node collecte.js
```

Le résumé du jour est écrit dans `donnees/resume.txt`. Pour le recevoir sur Telegram, renseigner `jeton` et `destinataire` dans `config.json`. Cet envoi n'a pas encore été testé.

## Limites connues

- L'éligibilité est devinée par mots-clés, sans intelligence artificielle. Elle se trompe parfois : la phrase citée et les boutons Oui / Non de chaque fiche servent à corriger.
- Une date limite n'est retenue que si l'annonce l'écrit après un mot comme « deadline » ou « date limite ». Sinon elle reste inconnue.
- Les fiches de `reperages.json` et le calendrier datent du 12 octobre 2026 et ne se mettent pas à jour seuls.
- L'outil ne collecte que lorsque l'ordinateur est allumé et qu'on clique sur Actualiser.
