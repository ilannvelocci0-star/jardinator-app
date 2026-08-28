# Jardinator — notes de reprise

Salut Téo,

Ilann est parti, je te laisse de quoi reprendre l'app sans avoir à tout
relire. C'est court, mais lis la partie « Ce qui va te poser problème »
avant de toucher quoi que ce soit — il y a deux ou trois trucs qui vont
te mordre sinon.

## Ce que c'est

Une app de suivi de chantiers pour les gars de Jardinator. Lucas crée
les fiches au bureau et assigne les ouvriers ; les ouvriers ouvrent
l'app sur leur téléphone, voient uniquement leurs chantiers, prennent
des photos, écrivent leurs notes et clôturent.

Techniquement c'est volontairement minimal : **un seul fichier HTML**,
pas de framework, pas d'étape de build, pas de `node_modules`. Tu ouvres
`index.html`, tu modifies, tu commites, c'est en ligne. Le code est
commenté en français aux endroits qui ne sont pas évidents.

## Où ça vit

| Quoi | Où |
|---|---|
| Code | `github.com/ilannvelocci0-star/jardinator-app` (public) |
| Site | `ilannvelocci0-star.github.io/jardinator-app/` (GitHub Pages, branche `main`) |
| Base + stockage + comptes | Supabase, projet `xpjsumcttpntlwawrujr` |

Les identifiants des cinq comptes te sont transmis à part. **Ne les mets
pas dans le dépôt, il est public.**

## Comment c'est branché

Le front tape directement l'API REST de Supabase (PostgREST) et son
stockage de fichiers, sans bibliothèque cliente — que du `fetch`. La clé
qui est dans `index.html` est la clé *publishable*, elle est faite pour
être publique.

Ce qui protège les données, ce sont donc **uniquement les règles RLS**.
Si tu les désactives « juste pour tester », tu ouvres la base entière à
n'importe qui ayant l'URL du dépôt. Tout est dans
`supabase-schema.sql`, rejouable sans rien casser.

Le modèle de droits tient en deux lignes :

- **Patron** (`app_metadata.role = 'patron'`) : voit tout, crée, supprime, assigne.
- **Ouvrier** : ne voit que les chantiers où son `uid` est dans le tableau
  `assignes`. Peut modifier notes, statut et photos de ses chantiers.
  Ne peut ni créer ni supprimer de fiche, ni changer le matériel.

La liste de matériel (`MATERIEL` dans `index.html`) est en dur : onze
entrées, dans l'ordre de chargement du camion et non alphabétique. Pour
en ajouter une, il suffit de compléter le tableau — les valeurs sont
stockées en clair dans la colonne `materiel`, donc renommer une entrée
existante ne met pas à jour les chantiers déjà enregistrés.

Le rôle est lu dans `app_metadata` et pas `user_metadata` : le second est
modifiable par l'utilisateur lui-même via l'API, il pourrait se
promouvoir patron tout seul.

Attention, le rôle est figé dans le jeton à la connexion. Si tu changes
le rôle de quelqu'un, il doit se déconnecter/reconnecter pour que ça
prenne.

## Les écritures ne partent pas directement

C'est le point le moins évident du code, et c'est délibéré : l'app tourne
dans un camion, sur du réseau qui tombe.

Toute écriture est d'abord persistée en local, puis empilée dans une file
(`jardinator_queue` en localStorage) rejouée dès qu'il y a du réseau.
Rien n'attend jamais le serveur : cliquer sur « Valider » répond en
quelques dizaines de millisecondes, l'envoi part derrière.

Deux choses à savoir si tu touches à `flushQueue()` :

- Un échec **réseau** interrompt la boucle sans toucher à l'ordre. C'est
  volontaire : une photo ne doit pas partir avant la création du chantier
  auquel elle se rattache.
- Un refus **4xx** (typiquement RLS) sort l'opération de la file et
  l'archive dans `jardinator_rejets`, visible dans l'onglet compte. Sans
  ça, une opération impossible bloquait tout ce qui suivait,
  indéfiniment. Ça s'est produit, c'est corrigé, ne le re-casse pas.
- L'opération traitée est retirée **par identité**, jamais par position
  (`retirerOp`). Si l'utilisateur agit pendant l'envoi, `enqueue()`
  remplace l'entrée de tête ; un `slice(1)` jetterait cette nouvelle
  version sans l'avoir envoyée.

Toute écriture qui passe par `PATCH` ou `DELETE` doit demander
`Prefer: return=representation` et vérifier qu'une ligne a bougé
(`patchChantier`). Sans ça, PostgREST renvoie 204 quand RLS n'a laissé
passer aucune ligne, et la modification est perdue en silence.

L'ajout et le retrait d'une photo passent par les fonctions Postgres
`ajouter_photo` / `retirer_photo`. Un « lire, modifier, réécrire » côté
app effacerait la photo qu'un collègue aurait insérée entre les deux.

Les photos et PDF ne transitent pas par la file elle-même : elle ne
stocke que des clés, les octets sont dans IndexedDB. localStorage
plafonne à 5 Mo, une seule photo en occuperait 8 %.

Les photos sont compressées à 1600 px / qualité 0.75 avant envoi, soit
~300 Ko. Une photo de téléphone brute fait 3 à 8 Mo, c'est intransportable
sur un réseau de chantier.

## Ce qui va te poser problème

**Le projet Supabase se met en pause après 7 jours sans activité.** C'est
la limite du plan gratuit. Si l'app dort pendant les congés, elle
reviendra morte et personne ne comprendra pourquoi. Un clic dans le
tableau de bord Supabase la relance. C'est probablement le premier appel
que tu recevras.

**Tout est sur les comptes personnels d'Ilann** — le GitHub comme le
Supabase. Tant que ça n'est pas transféré vers des comptes de
l'entreprise, Jardinator ne possède pas son propre outil, et des données
clients (noms, adresses, photos de propriétés privées) restent dans le
compte perso d'un ancien salarié. C'est le point le plus urgent, et il
n'est pas technique.

**Les mots de passe sont devinables** (prénom + année). C'était un choix
assumé pour que les gars puissent les taper sur un téléphone de chantier.
À changer au moins quand quelqu'un part.

**Le Service Worker met en cache l'app.** `index.html` est servi réseau
d'abord, donc il se met à jour tout seul. En revanche le logo, les icônes
et le manifeste viennent du cache : si tu les modifies sans incrémenter
`CACHE_VERSION` dans `sw.js`, les téléphones déjà installés garderont les
anciens. Pénible à diagnostiquer parce que tout marche sur ta machine.

**L'ancien backend Google Apps Script est encore déployé et ouvert à
tous.** Il ne sert plus à rien depuis la bascule vers Supabase, mais
c'est une porte d'entrée sur l'ancien Google Sheet, qui contient encore
des chantiers. À archiver.

Le fichier `apps-script-jardinator.gs` du dépôt est le vestige de cette
époque, tu peux le supprimer.

## Deux pièges iOS, payés cher

Ils ne se voient ni en local ni sur un ordinateur, seulement sur un
iPhone, et de façon intermittente.

**Ne reconstruis pas l'écran depuis le gestionnaire du clic.** Détruire
l'élément qu'on vient de toucher empêche Safari de repeindre : l'écran
reste blanc jusqu'au contact suivant, alors que l'état est correct.
Passe par `apresClic()`, qui relâche le focus, sort du gestionnaire et
force un recalcul de couche.

Et surtout, `apresClic()` n'utilise **pas** `requestAnimationFrame` :
il ne se déclenche jamais quand la page est masquée. Un écran qui se
verrouille au moment du clic laisserait l'action en suspens — le
chantier créé mais le formulaire toujours affiché, prêt à être validé
une seconde fois. C'est une correction qui a d'abord été faite avec
rAF, puis annulée pour cette raison.

**Un `<input type=file>` doit être dans le document.** Détaché, Safari
peut le recycler avant que l'événement n'arrive, et la photo est perdue
sans message — ouvrir l'appareil photo mettant justement le navigateur
sous pression mémoire. `choisirFichiers()` l'insère puis le retire, et
traite l'annulation : sans ça l'attente ne se terminait jamais et le
bouton photo restait inerte jusqu'au rechargement.

## Déployer

```
git add -A && git commit -m "…" && git push origin main
```

GitHub Pages reconstruit en une à deux minutes. Si tu as modifié autre
chose que du contenu, incrémente `CACHE_VERSION` dans `sw.js`.

Pour tester en local, il faut un vrai serveur HTTP —
`python3 -m http.server` suffit. En `file://`, le navigateur bloque le
Service Worker et IndexedDB, donc le mode hors-ligne et les photos ne
fonctionnent pas. Ça ressemble à une app cassée alors que non.

## Ce qui n'est pas fait

- **Pas de notification push.** Il y a une alerte quand l'app est
  ouverte, c'est tout. Un vrai push demande VAPID, un abonnement stocké,
  une Edge Function, et sur iPhone que l'app soit installée depuis Safari
  sur l'écran d'accueil. Ça a été évalué et écarté faute de temps.
- **Les fichiers ne sont pas supprimés avec la fiche.** Supprimer un
  chantier retire la ligne, pas les photos dans le bucket. Elles
  s'accumulent. Le stockage gratuit fait 1 Go, environ 3000 photos, et
  personne n'est prévenu à l'approche de la limite.
- **Un uuid d'ouvrier supprimé reste dans `assignes`.** Le tableau n'a
  pas de contrainte de clé étrangère, l'app affiche « Ouvrier inconnu ».
  Sans gravité mais pas propre.
- **Pas de résolution de conflit sur les notes.** Deux ouvriers sur le
  même chantier : le dernier qui clôture écrase le compte-rendu de
  l'autre. Les autres champs sont protégés — un ouvrier ne renvoie que
  `statut`, `notes` et `date_termine`, cf. `versDb()` — mais les notes
  elles-mêmes restent en dernier-écrit-gagne.

## Si ça casse

Dans l'ordre : le projet Supabase est-il en pause ? Le dernier build
GitHub Pages est-il passé ? Puis la console du navigateur — les échecs de
stockage et les opérations refusées y sont journalisés explicitement.

Le code est commenté aux endroits contre-intuitifs, et les messages de
commit expliquent le pourquoi de chaque correction plutôt que le quoi.
`git log` te dira plus de choses que ce document.

Bon courage.
