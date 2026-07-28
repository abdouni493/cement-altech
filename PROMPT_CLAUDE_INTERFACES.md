# PROMPT SYSTEM COMPLETE: GENERATION DES INTERFACES PRODUCTIONS, COMPTOIR, FICHE TECHNIQUE, CAISSE ET RAPPORTS DE CAISSE

> **INSTRUCTIONS POUR CLAUDE / LLM :**
> Vous êtes un architecte frontend expert React, TypeScript, TailwindCSS et UI/UX Design.
> Votre mission est de générer intégralement la suite d'interfaces d'application de gestion industrielle et commerciale pour l'industrie chimique / de production ("Produits Chimiques"), en respectant l'architecture logicielle, la gestion d'état Zustand, l'i18n (Français / Arabe RTL/LTR), ainsi que les règles métier exactes décrites ci-dessous.

---

## 📐 DESIGN SYSTEM & COMPOSANTS GLOBAUX

### 1. Principes de Design & Typographie
- **Cartes & Conteneurs (Cards)** : `bg-white/80 backdrop-blur-md border shadow-card transition-all rounded-2xl`
- **Typographie** : Inter / Outfit / Sans-serif moderne, nombres tabulaires (`tabular` ou `font-mono`) pour les alignements de prix.
- **Support RTL / LTR** : Attribut `dir="rtl"` ou `dir="ltr"` dynamique selon la langue (`ar` ou `fr`).

### 2. Composants UI Réutilisables
- `PageHeader` : Titre avec icône Lucide 24px, sous-titre dynamique, et zone d'actions alignée à droite (`Button`).
- `Card` : Carte conteneur avec variante animée `framer-motion` (`variants={cardVariants}`).
- `Badge` : Pillule de statut (`info`, `warning`, `danger`, `success`).
- `Modal` : Dialogue superposé responsive avec en-tête, fermeture esc/bouton, tailles (`sm`, `md`, `lg`, `xl`).
- `ConfirmDialog` : Modal de confirmation d'action critique (suppression/récupération).
- `SearchBar` & `Select` & `Input` & `Textarea` & `Switch` / `Checkbox` & `UnitSelect`.
- `StatCard` & `EmptyState` & `Toast` (`toast.success()`, `toast.error()`).

---

## 🧪 INTERFACE 1 : PRODUCTION (GESTION DES BATCHES DE FABRICATION)

### 📂 Fichier : `src/pages/Production/index.tsx`
### 🎯 Rôle Métier
Gérer le lancement des fabrications de produits chimiques, la déduction automatique des stocks d'ingrédients bruts (ou semi-finis), la détection du stock insuffisant, la déclaration des pertes de production (évaporation, casse, non conformité), le calcul des coûts de revient, et le transfert vers le comptoir de vente.

### 📑 Structure & Composants UI
1. **Header de Page** :
   - Titre : `Production` avec icône `FlaskConical`.
   - Action : Bouton principal `+ Nouvelle Production` (Onglet Production) ou `+ Nouvelle Fiche Technique` (Onglet Formules).
2. **Barre de Navigation par Onglets (Tabs)** :
   - Tab 1 : `Productions` (`<FlaskConical size={16} />`)
   - Tab 2 : `Fiches Techniques (Formules)` (`<FileText size={16} />`)
3. **Barre de Filtrage & Recherche** :
   - Champ `SearchBar` (recherche par nom de produit).
   - Select Filtre Date (`Toutes`, `Aujourd'hui`, `Cette semaine`, `Ce mois`).
4. **Grille des Cartes de Production (`filteredProductions`)** :
   - **En-tête Carte** : Nom de la production, Badge Catégorie, Badge Alerte Perte si `hasLoss === true` (avec `<AlertTriangle />`).
   - **Sous-titre** : Date & heure de fabrication (`Clock`), Créateur (`User`).
   - **Encadré Calculs Récapitulatifs** :
     - Ingrédients consommés (nombre d'articles).
     - Quantité produite (`outputQuantity` + unité de détail si activée).
     - Si perte : Quantité prévue (`expectedQuantity`), Quantité perdue (`lossQuantity`) et Valeur financière de la perte (`lossValue`).
     - Reste en stock production : `outputQuantity - sentToComptoir`.
     - Coût total de production (`totalCost` en DA).
     - Valeur estimée à la vente (`totalValue` en DA).
     - **Gains Nets Estimés** : `totalValue - totalCost` (Différencié selon que le gain est `>= 0` ou `< 0`).
   - **Bouton d'Action Rapide** : `Mettre au comptoir (reste)` (si `outputQuantity - sentToComptoir > 0`).
   - **Pied de Carte** : Bouton `Détails` (`<Eye />`) et Bouton `Supprimer` (`<Trash2 />`).

### ➕ Workflow Modal : "Lancer une Production" (`CreateProductionForm`)
- **Étape 1 : Sélection de la Formule de Base (Fiche Technique)**
  - Champ de recherche autocomplété pour trouver une Fiche Technique enregistrée.
- **Étape 2 : Recalcul d'Échelle Proportionnel (Scale Ratio)**
  - Champ numérique : `Modifier la Quantité à Produire`.
  - Calcul dynamique du ratio d'échelle : `ratio = productionQuantity / selectedFt.outputQuantity`.
  - Recalcul instantané du dosage de chaque ingrédient (`scaledQty = ingredient.quantityUsed * ratio`).
- **Étape 3 : Vérification du Stock en Temps Réel**
  - Comparaison avec `currentQuantity` dans `stockStore`.
  - Si stock requis > stock disponible : affichage d'une bannière animée **"Stock Insuffisant !"** avec mise en évidence de la ligne d'ingrédient et **désactivation du bouton de validation**.
  - Prise en compte des ingrédients semi-finis (`sourceType === 'fiche'`) qui ne bloquent pas le stock de matière première brute.
- **Étape 4 : Gestion des Pertes (Perte de Production / Evaporation / Réduction de Rendement)**
  - Interrupteur `Switch` : `Déclarer une perte de production`.
  - Saisie de la `Quantité réellement produite` (`realQuantity`).
  - Calcul automatique : `lossQuantity = expectedQuantity - realQuantity`, `lossValue = lossQuantity * costPerUnit`.
  - Zone de texte `Description de la perte` (Ex: évaporation lors de la cuisson, résidus cuve, casse flacon).
- **Étape 5 : Validation & Impact Stock**
  - Sur confirmation : Déduction automatique des quantités d'ingrédients dans le stock brut (`stockStore.deductStock`).
  - Enregistrement de la production dans `productionStore` avec statut "disponible en stock production" en attente de transfert au comptoir.

### 📦 Workflow Modal : "Mettre au Comptoir" (`TransferToComptoirModal`)
- Affiche le produit, la quantité produite totale, la quantité déjà envoyée au comptoir, et le reste en stock de production.
- Champ de saisie de la quantité à transférer (avec bouton `Max`).
- Validation : augmente le stock de vente du comptoir (`comptoirStore.addFromProduction`) et met à jour `sentToComptoir` dans la production.

---

## 📄 INTERFACE 2 : FICHE TECHNIQUE / FORMULES (`FicheTechnicForm`)

### 📂 Modèle de Données : `FicheTechnic` (`src/store/ficheTechnicStore.ts`)
```typescript
export interface FicheTechnic {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  description?: string;
  usedProducts: UsedProduct[];
  sellByUnit?: boolean;
  sellUnit?: string;
  usableInProduction?: boolean; // Permet de la réutiliser comme composant semi-fini
  productUnit?: string;
  outputQuantity: number; // Rendement de base
  unitPrice: number;     // Prix de vente par unité
  totalCost: number;     // Coût total des ingrédients
  costPerUnit: number;   // Coût de revient unitaire
  totalValue: number;    // Valeur brute vente
  gainsPerUnit: number;  // Gain net par unité
  totalGains: number;    // Gain net total
  createdAt: string;
}
```

### 🎯 Rôle Métier
Créer le modèle/la recette théorique de fabrication chimique. Permet d'associer des matières premières brutes (du stock) ET/OU des produits semi-finis (d'autres Fiches Techniques réutilisables) pour fabriquer un produit fini.

### 📑 Formulaire de Création / Édition (`FicheTechnicForm`)
1. **Panneau Gauche : Informations Générales**
   - Champ `Nom du Produit *`.
   - Sélecteur de Catégorie de Formule avec mini-modal création/suppression de catégorie inline.
   - Textarea `Description / Procédé de fabrication`.
2. **Panneau Droit : Rendement & Tarification**
   - Interrupteur `Vendre avec unité de détail` + `UnitSelect` (Ex: Litre, Kg, Flacon 500ml, Bidon 5L).
   - Interrupteur `Utilisable comme ingrédient dans une autre production` + `UnitSelect` de produit. *(Ex: Solution Acide préparée réutilisée dans la formule d'un nettoyant complexe)*.
   - Champ `Rendement (Quantité de base produite)`.
   - Champ `Prix de vente unitaire (DA)`.
   - **Bloc de Calculs Financiers en Temps Réel** :
     - Coût des ingrédients total (`totalCost`).
     - Coût de revient unitaire (`costPerUnit = totalCost / outputQuantity`).
     - Valeur de vente totale (`totalValue = outputQuantity * unitPrice`).
     - Gain net unitaire (`gainsPerUnit = unitPrice - costPerUnit`).
     - **Gain net total de la formule** (`totalGains = totalValue - totalCost`).
3. **Section Ingrédients & Dosages**
   - Barre de recherche hybride recherchant à la fois dans :
     a. Les produits en stock brut (`Products`).
     b. Les Fiches Techniques réutilisables (`reusableFiches`) marquées comme `usableInProduction`.
   - **Liste des Ingrédients Ajoutés** :
     - Badge "Production" distinctif si l'ingrédient provient d'une formule semi-finie.
     - Affichage du prix d'achat ou du coût de revient unitaire.
     - Input de la quantité dosée avec unité.
     - Calcul automatique du coût de ligne (`quantityUsed * unitCost`).
     - Bouton suppression d'ingrédient (`<X />`).

---

## 🏪 INTERFACE 3 : COMPTOIR DE VENTE (`src/pages/Comptoir/index.tsx`)

### 🎯 Rôle Métier
Gérer le stock des produits finis prêts à la vente directe (transférés depuis la production), visualiser les valeurs en comptoir, et enregistrer l'historique des destructions/invendus/perte sur comptoir avec possibilité de récupération.

### 📑 Structure & Composants UI
1. **Header de Page** :
   - Titre : `Comptoir` avec icône `Beaker`.
   - Action : Bouton vers Statistiques Comptoir (`/caisse/statistics`).
2. **Barre de Navigation par Onglets (Tabs)** :
   - Onglet 1 : `Disponible` (Stock actif au comptoir)
   - Onglet 2 : `Historique des Destructions` (Produits jetés ou gâtés)
3. **Onglet 1 : Produits Disponibles**
   - Filtres : Barre de recherche + Filtre par Catégorie de Production.
   - **Grille des Cartes Produits (`Card`)** :
     - Nom du produit, badge catégorie.
     - Date de transfert/production.
     - Quantité disponible avec son unité.
     - Prix unitaire & Valeur totale du stock comptoir.
     - Bouton d'action : `<Flame /> Destruction` (ouvre le modal de destruction).
4. **Onglet 2 : Historique des Destructions**
   - Bannière KPI : **Total Valeur Détruite**.
   - Barre d'actions groupées (Bulk actions si éléments sélectionnés) : Bouton `Récupérer` (`<RotateCcw />`) et Bouton `Supprimer` (`<Trash2 />`).
   - Tableau complet des destructions :
     - Checkbox sélection, Date, Nom produit, Quantité détruite, Valeur perdue, Motif de destruction, Agent créateur, Actions individuelles (`Récupérer`, `Supprimer`).

### 🔥 Modal de Destruction (`Modal`)
- Affiche le nom du produit et la quantité max disponible.
- Input numérique : Quantité à détruire.
- Input texte : Motif de destruction (Ex: Peremption, Flacon fêlé, Échantillon offert, Renversé).
- Calcul dynamique en direct de la valeur détruite (`destroyQty * unitPrice`).
- Confirmation : retire la quantité du stock comptoir et enregistre la ligne dans `destructions`.

---

## 💰 INTERFACE 4 : CAISSE & MOUVEMENTS (`src/pages/Caisse/index.tsx`)

### 🎯 Rôle Métier
Superviser le solde de caisse en temps réel, la trésorerie globale de l'entreprise, les flux d'entrées/sorties de fonds, la ventilation par catégorie de dépenses et dépôts, et l'historique détaillé des opérations de caisse.

### 📑 Structure & Composants UI

#### 1. Hero Banners Trésorerie & Solde (2 Cartes Geantes)
- **Carte 1 : Solde de Caisse Actuel**
  - Icône `Wallet`, libellé "Solde de Caisse".
  - Chiffre géant animé avec hook `useCountUp` (`formatCurrency(balance)`).
  - Deux sous-cartes translucides :
    - `Encaissements Totaux` (Ventes payées + Dépôts).
    - `Décaissements Totaux` (Achats payés + Dépôts/Retraits + Charges + Salaires).
- **Carte 2 : Trésorerie Globale Entreprise**
  - Icône `PiggyBank`, libellé "Trésorerie Globale".
  - Calcul : **`Trésorerie = Solde Caisse + Valeur Stock Comptoir + Valeur Stock Matière Première`**.
  - Ventilation en 3 lignes avec icônes : Solde Caisse, Valeur Comptoir, Valeur Stock Brut.

#### 2. Sélecteur de Période Temporelle (`Period`)
- Boutons puces animés : `Aujourd'hui`, `Cette semaine`, `Ce mois`, `Cette année`, `Tout`, `Période personnalisée` (ouvre deux inputs date `Du` / `Au`).

#### 3. Cartes de Flux de la Période (`FlowCard`)
- **Entrées d'argent** (`+ DA`).
- **Sorties d'argent** (`- DA`).
- **Flux Net de la période** (`Entrées - Sorties` avec indicateur d'état).

#### 4. Ventilation des Dépôts & Retraits par Catégorie (`CategoryTotalsCard`)
- 2 Cartes côte à côte :
  - Dépôts par Catégorie (Barres de progression des entrées).
  - Retraits par Catégorie (Barres de progression des sorties).
  - Filtre interactif au clic sur une catégorie pour filtrer l'historique des transactions.

#### 5. Grille des 8 Cartes Statistiques Métier (`StatCard`)
- Ventes Totales, Achats Totaux, Charges / Dépenses, Salaires Employés, Valeur Productions, Nombre Produits Comptoir, Valeur Stock Comptoir, Valeur Stock Matière Première.

#### 6. Tableaux Comparatifs : Ventes Produits vs Reste Comptoir
- Tableau 1 : Top Ventes Produits de la période (Nom, Quantité vendue, Chiffre d'affaires).
- Tableau 2 : Reste Actuel au Comptoir (Nom, Quantité disponible, Valeur financière).

#### 7. Accordéons Détaillés Ingrédients & Achats
- **Accordéon 1 : Ingrédients Consommés par Production**
  - Liste repliable par batch de production. Sous-tableau avec : Ingrédient, Quantité utilisée, P.U Achat, Coût total ligne.
- **Accordéon 2 : Achats Groupés par Catégorie de Matière Première**
  - Liste repliable par catégorie de stock. Sous-tableau avec : Produit, Quantité achetée, Prix Unitaire Moyen, Total Achat.

#### 8. Historique des Transactions de Caisse
- Liste animée des dépôts/retraits manuels avec date, heure, créateur, catégorie, montant, boutons édition/suppression.

#### 💵 Modal Dépôt / Retrait (`Modal`)
- Switch Toggle : `Dépôt (Entrée)` vs `Retrait (Sortie)`.
- Input Montant, Input Date, Select Catégorie avec composant `CategorySelect` (création/suppression inline), Textarea Description.

---

## 📊 INTERFACE 5 : RAPPORTS DE CAISSE ET CLÔTURE (`src/pages/Caisse/CaisseReports.tsx`)

### 🎯 Rôle Métier
Permettre aux gérants/caissiers de réaliser les clôtures de caisse (journalières ou par période), de saisir le comptage physique des espèces (`declaredAmount`), d'analyser le décalage/l'écart de caisse (Surplus ou Déficit par rapport au solde théorique), et d'imprimer un rapport complet et infalsifiable.

### 📑 Structure & Composants UI

#### 1. Vue Liste des Rapports de Caisse
- Barre de filtres par date (`Tout`, `Aujourd'hui`, `Semaine`, `Mois`, `Personnalisé`).
- Bouton `+ Nouveau Rapport de Caisse`.
- **Grille des Cartes Rapports (`CaisseReport Card`)** :
  - Badge type : `Rapport Journalier` (`Calendar`) ou `Rapport de Période` (`CalendarRange`).
  - Date & Heure du rapport, Auteur créateur.
  - Montant Déclaré (Comptage espèces) vs Montant Théorique calculé par le système.
  - **Badge de Réconciliation** :
    - `Caisse Juste` (Aucun décalage, écart < 0.01 DA).
    - `Surplus : + X DA` (Si déclaré > théorique).
    - `Déficit : - X DA` (Si déclaré < théorique).
  - Boutons d'actions : `Détails` (`<Eye />`), `Imprimer` (`<Printer />`), `Éditer`, `Supprimer`.

#### 🕒 Modal de Création / Clôture de Caisse (`CaisseReport Form`)
- Toggle Type de Rapport : `Rapport Journalier` vs `Rapport de Période`.
- **Horloge Digitale Live (`LiveClock`)** : Affiche la date et l'heure courante à la seconde près.
- Inputs Date & Heure (ou Date Début / Date Fin si Période).
- Input Numérique Obligatoire : **`Montant compté en caisse (Espèces physiques en DA) *`**.
- Textarea Description (Ex: Clôture de fin de journée par Amine).

#### 📜 Vue Détail du Rapport (`ReportDetail`)
Vue ultra-complète et détaillée affichant l'intégralité du bilan financier et opérationnel couvert par le rapport :
1. **Barre d'Actions** : Bouton `Imprimer le Rapport PDF`, Bouton `Mouvements de Caisse`, Bouton `Retour`.
2. **En-tête & Cartes KPI Principales** (7 Tuiles : Ventes, Achats, Production, Dépenses, Salaires, Destructions, Pertes Production).
3. **Tableaux Détaillés par Section (16 Sections)** :
   - **Section 1 : Synthèse Financière Générale** (Ventes brutes, ventes encaissées, achats, valeur production, coût production, gains nets production, valeur pertes, dépenses, salaires, destructions, dépôts, retraits, gain net global).
   - **Section 2 : État Général du Stock** (Produits, catégories, quantité en stock, seuil min, prix d'achat, valorisation du stock).
   - **Section 3 : Achats Détaillés par Catégorie** (Groupés par Catégorie -> Produit -> Lignes de facture avec ref, fournisseur, date, quantité, prix unitaire, total).
   - **Section 4 : Productions Détaillées par Catégorie** (Groupées par Catégorie -> Batches -> Ingrédients consommés, rendement théorique, coût, chiffre d'affaires, gain).
   - **Section 4b : Productions avec Perte / Evaporation** (Détail des pertes : quantité prévue vs réelle, quantité perdue, valeur financière perdue, motif/description).
   - **Section 5 : Ventes par Catégorie** (Nom produit, quantité vendue avec unité, chiffre d'affaires généré).
   - **Section 6 : Détail Facture par Facture** (Réf, client, date, total, montant payé, reste dû).
   - **Section 7 : Dépenses / Charges par Catégorie**.
   - **Section 8 & 9 : Dettes Clients et Dettes Fournisseurs**.
   - **Section 10 : Paiements des Employés** (Salaires et Acomptes).
   - **Section 11 & 12 : Dépôts et Retraits de Caisse par Catégorie**.
   - **Section 13 : Historique des Destructions**.
   - **Section 14 : Reste du Stock au Comptoir par Catégorie**.
   - **Section 15 : Calcul du Gain Net Économique**.
   - **Section 16 : Réconciliation et Écart de Caisse** (Montant Déclaré vs Solde Théorique de Caisse vs Décalage).

### 🖨️ Moteur d'Impression PDF (`lib/reportPrint.ts`)
Toutes les fonctions d'impression génèrent un document HTML/CSS imprimable professionnel avec en-tête d'entreprise, logo, date d'impression, tableaux stylisés, numérotation de page, et mise en page optimisée pour l'impression A4/Thermal.

---

## 🧮 LOGIQUE DE CALCUL ET FORMULES METIER EXACTES

### 1. Formule de Coût de Revenir & Gains de Production
```typescript
// Coût total des ingrédients d'une production
const totalCost = usedProducts.reduce((sum, u) => sum + (u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0))), 0);

// Coût de revient unitaire
const costPerUnit = outputQuantity > 0 ? totalCost / outputQuantity : 0;

// Chiffre d'affaires estimé / Valeur totale à la vente
const totalValue = outputQuantity * unitPrice;

// Gains nets de la batch de production
const totalGains = totalValue - totalCost;
```

### 2. Formule de Perte de Production (Evaporation / Cassage)
```typescript
// Quantité perdue
const lossQuantity = hasLoss ? Math.max(0, expectedQuantity - realQuantity) : 0;

// Valeur financière perdue (valeur de la matière première gâchée)
const lossValue = lossQuantity * costPerUnit;

// Quantité finale réelle enregistrée en stock
const finalOutputQuantity = hasLoss ? realQuantity : expectedQuantity;
```

### 3. Formule de Solde Théorique de Caisse (`theoretical`)
```typescript
// Le solde théorique récapitule l'intégralité du flux de trésorerie réel (cash flow en espèces) jusqu'à la date du rapport :
const theoretical = cumDeposits + cumSalesPaid - cumWithdrawals - cumPurchasesPaid - cumExpenses - cumWorkerPayments;

// Écart / Décalage de caisse :
const decalage = declaredAmount - theoretical;
// Si decalage === 0 : Caisse parfaite
// Si decalage > 0   : Surplus de caisse (espèces en trop)
// Si decalage < 0   : Déficit de caisse (manque d'espèces)
```

### 4. Formule de Gain Net Économique Globale (`gains`)
```typescript
const netGains = totalSalesGross - totalPurchases - totalWorkerPayments - totalExpenses - totalDestroyedValue;
```

---

## 📋 DIRECTIVES DE GENERATION DE CODE POUR CLAUDE

Lorsque vous générez ces interfaces, vous devez vous assurer de :
1. Importer et utiliser les stores Zustand appropriés (`useProductionStore`, `useFicheTechnicStore`, `useComptoirStore`, `useCaisseStore`, `useCaisseReportStore`, `useStockStore`, `useSalesStore`, `usePurchaseStore`, `useExpenseStore`, `useWorkerStore`).
2. Utiliser les hooks de langue (`useLanguage`) et de permissions (`usePermissions`).
3. Gérer les états de recherche, de filtres par date, de sélection multiple, et les fenêtres modales avec un état React propre (`useState`, `useMemo`).
4. Appliquer des coins arrondis `rounded-2xl`, des ombres douces et une mise en page fluide.
5. Formater tous les montants monétaires avec `formatCurrency(val)` (affichant `DA` ou `د.ج`), et toutes les dates avec `formatDate(date, language)`.
