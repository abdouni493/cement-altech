# Transfert vers le nouveau projet Supabase

Ancien projet : `bxxdunoxajzybpsihown` (saturé : erreurs « statement timeout »)
Nouveau projet : `asxdoijraguloypigiia`

L'application est déjà connectée au **nouveau projet** (`src/lib/supabase.ts`).

## Étape 1 — Créer la base dans le nouveau projet (SQL Editor)

Dans le tableau de bord Supabase du **nouveau** projet › **SQL Editor** › New query,
exécuter **dans cet ordre**, chaque fichier en entier (copier / coller / Run) :

1. `altech_production_supabase.sql` — tables, fonctions, sécurité de base
2. `altech_production_toutes_mises_a_jour.sql` — toutes les mises à jour (dont sauvegarde / restauration)
3. `altech_production_nouveau_projet_finalisation.sql` — performance (index, règles de sécurité optimisées) et délais
4. `sql_nouveau_projet/04_atomic_reference_allocator.sql` — numérotation atomique, sans troncature ni renumérotation des documents émis
5. `sql_nouveau_projet/05_atomic_command_operations.sql` — commandes et livraisons atomiques, rejouables avec le même identifiant d'opération
6. `sql_nouveau_projet/06_command_summaries.sql` — pagination et totaux filtrés des commandes
7. `sql_nouveau_projet/07_purchase_summaries.sql` — pagination et totaux filtrés des achats

Pour le chemin découpé : `sql_nouveau_projet/01_schema_de_base.sql`, les sept parties `02`, `03_finalisation.sql`, puis **04 → 05 → 06 → 07**. Les nouveaux fichiers sont ré-exécutables; ne pas rejouer une ancienne définition après eux sans les réappliquer.

Déployer le SQL avant le nouveau frontend et rafraîchir les anciennes sessions. Voir [validation, mesures et déploiement](docs/COMMAND_PERFORMANCE_ROLLOUT.md) pour les diagnostics, tests locaux, compatibilité et reprise sans perte des numéros émis.

## Étape 2 — Créer le premier compte administrateur

Ouvrir l'application (Ctrl+F5). La base étant vide, l'écran de connexion propose
**« Créer un compte Administrateur »**. Le créer, puis se connecter.

## Étape 3 — Transférer les données

**Paramètres › Base de données › « Transférer les données de l'ancienne base »**

- Saisir l'identifiant et le mot de passe **administrateur de l'ancienne application**.
- Cliquer **Lancer le transfert**. L'outil :
  1. se connecte à l'ancienne base ;
  2. lit toutes les données — avec les comptes de connexion si l'ancienne base répond
     assez vite, sinon table par table (sans les comptes) ;
  3. télécharge un fichier de sauvegarde (copie de sécurité, à conserver) ;
  4. restaure tout dans la nouvelle base.
- **Si les comptes ont été transférés** : se déconnecter puis se reconnecter avec
  les identifiants de l'ancienne application (tous les employés gardent les leurs).
- **Sinon** : le compte administrateur créé à l'étape 2 est conservé ; recréer les
  comptes des employés depuis **Employés › Créer le compte**.

Faire le transfert depuis l'ordinateur où les **livreurs** ont été saisis
(ils sont stockés dans ce navigateur et sont inclus dans le fichier).
