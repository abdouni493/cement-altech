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

Les trois fichiers sont ré-exécutables sans risque.

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
