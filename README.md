# 🧪 Produits Chimiques — Gestion

Application web complète de gestion de produits chimiques : stock, achats, production, comptoir, point de vente, ventes, clients, fournisseurs, employés, dépenses, rapports et paramètres. Interface premium bilingue **Français / Arabe (RTL)** avec animations Framer Motion. L'application démarre **vide** (aucune donnée de démonstration) : toutes les données que vous saisissez sont enregistrées localement dans la base `localStorage` du navigateur et conservées entre les sessions.

## 🛠️ Stack

- **React 18 + TypeScript + Vite**
- **Tailwind CSS** (design system or / chocolat / rose / pistache)
- **Framer Motion** (animations de pages, cartes, modales)
- **Zustand** (état global + persistance localStorage)
- **Recharts** (graphiques du tableau de bord & rapports)
- **React Router** (routage + protection des routes)
- **JsBarcode** (génération / impression de codes-barres EAN-13)
- **jsPDF / impression navigateur** (factures & rapports)
- **Lucide React** (icônes)

## 🚀 Démarrage

### Le plus simple (Windows)

Double-cliquez sur le raccourci **« Produits Chimiques »** (ou sur `run-app.bat`) à la racine du projet. Au premier lancement, les dépendances sont installées automatiquement, puis l'application s'ouvre dans le navigateur. Gardez la fenêtre noire ouverte pendant l'utilisation.

### En ligne de commande

```bash
npm install
npm run dev      # serveur de développement (http://localhost:5173)
npm run build    # build de production
npm run preview  # prévisualiser le build
```

### 📦 Installation sur un autre PC (hors ligne)

L'application fonctionne **100 % hors ligne, avec exactement le même design, les mêmes polices, icônes et couleurs** : les polices (Playfair Display, Inter, JetBrains Mono, Cairo) sont **intégrées localement** (plus aucun chargement depuis Internet), tout comme les icônes (Lucide), les couleurs (Tailwind) et les codes-barres (JsBarcode).

Pour l'installer sur un autre ordinateur sans connexion Internet :

1. Installez **Node.js** sur le nouveau PC (installeur hors ligne depuis https://nodejs.org, à préparer à l'avance).
2. Copiez **tout le dossier du projet, y compris `node_modules`** (c'est lui qui contient les bibliothèques de design, polices et icônes). Une clé USB suffit.
3. Double-cliquez sur le raccourci **« Produits Chimiques »** ou sur `run-app.bat`.

> ⚠️ Si vous oubliez le dossier `node_modules`, le lancement tentera un `npm install` qui échouera sans Internet. Copiez donc bien le dossier complet.

## 🔐 Connexion

- **Aucun compte par défaut.** Au tout premier démarrage, la page de connexion affiche directement le formulaire **« Créer un compte admin »** : renseignez vos identifiants pour créer le compte administrateur.
- Ensuite, la connexion se fait **uniquement avec ce compte admin créé** (et les éventuels comptes employés ajoutés depuis le module Employés, avec permissions granulaires).

## ✨ Fonctionnalités principales

| Module | Description |
|--------|-------------|
| **Tableau de bord** | Statistiques animées, graphiques (ventes, achats, dépenses, catégories), top produits, alertes stock, expirations |
| **Stock** | CRUD produits, vues cartes/tableau, filtres marque/catégorie, génération + impression code-barres |
| **Achats** | Création de factures multi-produits, gestion des dettes fournisseurs, impression de factures |
| **Production** | Recettes, consommation de stock, ajout automatique au comptoir |
| **Comptoir** | Produits disponibles à la vente, destructions + historique |
| **Point de vente (POS)** | Catalogue + panier, réductions, ventes payées/à crédit |
| **Ventes** | Historique, paiement de dettes clients, impression |
| **Clients / Fournisseurs** | Fiches + historiques détaillés avec soldes |
| **Employés** | Création, permissions, acomptes, absences, paie nette |
| **Dépenses** | CRUD avec filtres par période |
| **Rapports** | Synthèse financière par période + export imprimable |
| **Paramètres** | Infos magasin, compte, sauvegarde/restauration JSON |

## 🌍 Bilingue & RTL

Bascule FR ↔ AR depuis l'en-tête ou la page de connexion. En arabe, l'interface passe automatiquement en `dir="rtl"` (sidebar inversée, police Cairo).

## 🗂️ Structure

```
src/
├── components/   ui/ · layout/ · shared/
├── pages/        une page par module
├── store/        stores Zustand (un par domaine)
├── data/         mockData.ts (données initiales)
├── lib/          animations · utils · i18n · barcodeUtils · print
├── hooks/        useLanguage · usePermissions · useCountUp
└── types/        types TypeScript du domaine
```

## 💾 Persistance & réinitialisation

Les modifications sont sauvegardées automatiquement dans le `localStorage` (la base de données locale). Depuis **Paramètres → Base de données**, vous pouvez **exporter** une sauvegarde JSON, la **restaurer**, ou **tout effacer** pour repartir d'une base vide (le compte admin et les informations du magasin sont conservés).
