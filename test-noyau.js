const NC = require('./noyau-commande.js');

// ===== CATALOGUE RÉEL (extrait de la base Gin Khao) =====
const categories = [
  { id: 'c-formules', nom: 'Formules', parent_id: null },
  { id: 'c-sushi',    nom: 'Sushi',    parent_id: null },
  { id: 'c-loclac',   nom: 'Loc Lac',  parent_id: null },
  { id: 'c-f-loclac', nom: 'Formule Loc Lac',  parent_id: 'c-formules' },
  { id: 'c-poke',     nom: 'Pokébowl', parent_id: null },
  { id: 'c-f-poke',   nom: 'Formule Pokébowl', parent_id: 'c-formules' },
  { id: 'c-makis',    nom: 'Makis',    parent_id: 'c-sushi' },
  { id: 'c-crousty',  nom: 'Crousty Khao', parent_id: null },
  { id: 'c-rizsauce', nom: 'Riz en sauce', parent_id: null },
  { id: 'c-boissons', nom: 'Boissons', parent_id: null },
  { id: 'c-desserts', nom: 'Desserts', parent_id: null },
  { id: 'c-entrees',  nom: 'Entrées',  parent_id: null },
  { id: 'c-supp',     nom: 'Suppléments', parent_id: null },
  { id: 'c-sauces',   nom: 'Sauces',   parent_id: null },
];

const OB_LOCLAC = [
  { choix: ['Riz', 'Nouilles'], groupe: 'Féculent', obligatoire: true },
  { choix: ['Normal', 'Spicy'], groupe: 'Niveau épicé', obligatoire: true },
];

const produits = [
  { id: 'p-loclac',   nom: 'Poulet Loc Lac (Formule)', prix: 13.9, categorie_id: 'c-f-loclac', options_base: OB_LOCLAC, est_formule: true },
  { id: 'p-poke',     nom: 'Pokébowl Saumon (Formule)', prix: 14.9, categorie_id: 'c-f-poke', est_formule: true },
  { id: 'p-makis',    nom: 'Makis Saumon', prix: 6.5, categorie_id: 'c-makis' },
  { id: 'p-crousty',  nom: 'Crousty Khao Crevettes', prix: 12.5, categorie_id: 'c-crousty', sauces_incluses: true },
  { id: 'p-rizsauce', nom: 'Riz en sauce', prix: 9.5, categorie_id: 'c-rizsauce',
    options_base: [
      { choix: ['Oignons','Courgettes','Curry Coco','Curry Jaune','Curry Vert','Sauce Piquante'], groupe: 'Sauce Riz', obligatoire: true },
      { choix: ['Normal','Spicy'], groupe: 'Niveau épicé', obligatoire: true },
    ] },
  { id: 'p-coca',     nom: 'Coca 33cl', prix: 1.5, categorie_id: 'c-boissons' },
  { id: 'p-nems',     nom: 'Nems Poulet', prix: 3.99, categorie_id: 'c-entrees', visible_formule: true,
    variantes: [{prix:3.9,pieces:2},{prix:6.9,pieces:4},{prix:7.9,pieces:6},{prix:9.9,pieces:8}] },
  { id: 'p-suppoul',  nom: 'Suppl. Poulet riz', prix: 3.0, categorie_id: 'c-supp' },
  { id: 'p-dynamite', nom: 'Sauce Dynamite', prix: 1.0, categorie_id: 'c-sauces' },
  { id: 'p-aigre',    nom: 'Sauce Aigre-Douce + Dynamite', prix: 1.0, categorie_id: 'c-sauces' },
  { id: 'p-tapioka',  nom: 'Perle de Tapioka', prix: 4.0, categorie_id: 'c-desserts' },
];

NC.init({ produits, categories });

let ok = 0, ko = 0;
function verif(titre, reel, attendu) {
  const a = JSON.stringify(reel), b = JSON.stringify(attendu);
  if (a === b) { ok++; console.log('  ✓ ' + titre); }
  else { ko++; console.log('  ✗ ' + titre + '\n      attendu : ' + b + '\n      obtenu  : ' + a); }
}

// ============================================================
console.log('\n=== 1. ROUTAGE (le bug Formule Pokébowl) ===');
verif('Makis (sous-cat de Sushi)      -> sushi', NC.stationCategorie('c-makis'), 'sushi');
verif('Pokébowl                       -> sushi', NC.stationCategorie('c-poke'), 'sushi');
verif('Formule Pokébowl               -> sushi', NC.stationCategorie('c-f-poke'), 'sushi');
verif('Formule Loc Lac                -> cuisine', NC.stationCategorie('c-f-loclac'), 'cuisine');
verif('Boissons                       -> comptoir', NC.stationCategorie('c-boissons'), 'comptoir');
verif('Desserts                       -> comptoir', NC.stationCategorie('c-desserts'), 'comptoir');
verif('Sauces (vendue seule)          -> comptoir', NC.stationCategorie('c-sauces'), 'comptoir');
verif('Suppléments (vendu seul)       -> cuisine', NC.stationCategorie('c-supp'), 'cuisine');
verif('Riz en sauce (piège "sauce")   -> cuisine', NC.stationCategorie('c-rizsauce'), 'cuisine');

console.log('\n  -- avec la colonne categories.station renseignée --');
const catsAvecStation = categories.map(c => c.id === 'c-f-poke' ? { ...c, station: 'sushi' } : c);
NC.init({ produits, categories: catsAvecStation });
verif('colonne station prioritaire', NC.stationCategorie('c-f-poke'), 'sushi');
NC.init({ produits, categories });

// ============================================================
console.log('\n=== 2. DEUX LOC LAC : un Riz, un Nouilles (le bug principal) ===');
const uidA = 'L-A', uidB = 'L-B';
const panier2 = [
  { ligne_uid: uidA, produit_id: 'p-loclac', nom: 'Poulet Loc Lac (Formule)', prix: 13.9, quantite: 1,
    categorie_id: 'c-f-loclac', est_formule: true,
    options_base: { 'Féculent': 'Riz', 'Niveau épicé': 'Normal' },
    formule_boisson_id: 'p-coca', formule_entree_id: 'p-nems', formule_entree_label: 'Nems Poulet' },
  { ligne_uid: 'sl1', lien_plat: uidA, produit_id: 'p-coca', nom: '  ↳ Coca 33cl (formule)', prix: 0, quantite: 1, categorie_id: 'c-boissons' },
  { ligne_uid: 'sl2', lien_plat: uidA, produit_id: 'p-nems', nom: '  ↳ Nems Poulet (formule)', prix: 0, quantite: 1, categorie_id: 'c-entrees' },

  { ligne_uid: uidB, produit_id: 'p-loclac', nom: 'Poulet Loc Lac (Formule)', prix: 13.9, quantite: 1,
    categorie_id: 'c-f-loclac', est_formule: true,
    options_base: { 'Féculent': 'Nouilles', 'Niveau épicé': 'Spicy' },
    formule_boisson_id: 'p-coca', formule_entree_id: 'p-nems', formule_entree_label: 'Nems Poulet' },
  { ligne_uid: 'sl3', lien_plat: uidB, produit_id: 'p-coca', nom: '  ↳ Coca 33cl (formule)', prix: 0, quantite: 1, categorie_id: 'c-boissons' },
  { ligne_uid: 'sl4', lien_plat: uidB, produit_id: 'p-nems', nom: '  ↳ Nems Poulet (formule)', prix: 0, quantite: 1, categorie_id: 'c-entrees' },
];

const imp2 = NC.construireImpression(panier2, { numero: 101, total: 27.8 });
// RÈGLE : l'entrée de formule sort en LIGNE À PART (pas en détail)
verif('bon cuisine : 2 plats + 2 entrées', imp2.bonCuisine.items.map(i => i.nom),
  ['Riz Poulet Loc Lac', 'Nems Poulet (2 pcs)', 'Nouilles Poulet Loc Lac', 'Nems Poulet (2 pcs)']);
verif('plat 1 : aucun détail (Normal masqué)', imp2.bonCuisine.items[0].details, []);
verif('entrée : ligne propre, sans détail', imp2.bonCuisine.items[1].details, []);
verif('plat 2 : Spicy visible', imp2.bonCuisine.items[2].details, ['Spicy']);
// Boisson + entrée de formule = LIGNES À PART sur le ticket client
verif('ticket client : 2 plats + 4 inclus = 6 lignes', imp2.ticketClient.lignes.length, 6);
verif('ticket ligne 1 = Riz seul (pas de doublon)', imp2.ticketClient.lignes[0].details, ['Riz']);
verif('ticket ligne 2 = Coca en ligne', imp2.ticketClient.lignes[1].nom, '  \u21b3 Coca 33cl (formule)');
verif('Coca marqué inclus', imp2.ticketClient.lignes[1].inclus, true);
verif('ticket ligne 3 = Nems avec pcs', imp2.ticketClient.lignes[2].nom, '  \u21b3 Nems Poulet (2 pcs) (formule)');
verif('plat 2 = Nouilles + Spicy, sans doublon', imp2.ticketClient.lignes[3].details, ['Nouilles', 'Spicy']);

// ============================================================
console.log('\n=== 3. FORMULE POKÉBOWL : caisse et borne doivent router pareil ===');
const ligneCaisse = { ligne_uid: 'x1', produit_id: 'p-poke', nom: 'Pokébowl Saumon (Formule)', prix: 14.9, quantite: 1, categorie_id: 'c-f-poke' };
const ligneBorne  = { ligne_uid: 'x1', produit_id: 'p-poke', nom: 'Pokébowl Saumon (Formule)', prix: 14.9, quantite: 1,
                      options: { options_base: {}, retirable: [], supplements: [], sauces: [] } };
verif('format caisse -> sushi', NC.stationPourLigne(ligneCaisse), 'sushi');
verif('format borne  -> sushi', NC.stationPourLigne(ligneBorne), 'sushi');
const impPoke = NC.construireImpression([ligneCaisse], { numero: 102, total: 14.9 });
verif('bon cuisine vide', impPoke.bonCuisine, null);
verif('bon sushi rempli', impPoke.bonSushi.items.length, 1);

// ============================================================
console.log('\n=== 4. CROUSTY KHAO : ses sauces montent en cuisine ===');
const crousty = { ligne_uid: 'y1', produit_id: 'p-crousty', nom: 'Crousty Khao Crevettes', prix: 12.5, quantite: 1,
                  categorie_id: 'c-crousty', sauces_sel: ['p-dynamite', 'p-aigre'] };
verif('sauces en cuisine', NC.detailsLigne(crousty, 'cuisine'), ['Sauce Dynamite', 'Sauce Aigre-Douce + Dynamite']);
const makiSauce = { ligne_uid: 'y2', produit_id: 'p-makis', nom: 'Makis Saumon', prix: 6.5, quantite: 1,
                    categorie_id: 'c-makis', sauces_sel: ['p-dynamite'] };
verif('autre plat : pas de sauce en cuisine', NC.detailsLigne(makiSauce, 'cuisine'), []);
// Sauce PAYANTE : elle a déjà sa propre ligne avec son prix → pas répétée en détail
verif('autre plat : sauce payante non répétée au comptoir', NC.detailsLigne(makiSauce, 'comptoir'), []);
// Sauce INCLUSE : aucune ligne facturée → elle doit apparaître en détail
const crousInc = { ligne_uid: 'y3', produit_id: 'p-crousty', nom: 'Crousty Khao Crevettes', prix: 12.5, quantite: 1,
                   categorie_id: 'c-crousty', sauces_sel: ['p-dynamite'] };
verif('sauce incluse : visible au comptoir', NC.detailsLigne(crousInc, 'comptoir'), ['Sauce Dynamite']);

// ============================================================
console.log('\n=== 5. RIZ EN SAUCE + SUPPLÉMENT PAYANT ===');
const rizSauce = { ligne_uid: 'z1', produit_id: 'p-rizsauce', nom: 'Riz en sauce', prix: 9.5, quantite: 1,
                   categorie_id: 'c-rizsauce',
                   options_base: { 'Sauce Riz': 'Sauce Piquante', 'Niveau épicé': 'Normal' },
                   supplements_sel: ['p-suppoul', 'p-suppoul'] };
// "Suppl. Poulet riz" -> "+ Poulet x2" (sans le libellé commercial ni l'accompagnement)
verif('cuisine : sauce riz + supplément x2', NC.detailsLigne(rizSauce, 'cuisine'), ['Sauce Piquante', '+ Poulet x2']);
verif('comptoir : supplément pas répété (ligne à part)', NC.detailsLigne(rizSauce, 'comptoir'), ['Sauce Piquante']);

// ============================================================
console.log('\n=== 6. ANTI-RÉGRESSION : la boisson gratuite à répétition ===');
const panier6 = [
  { ligne_uid: 'f1', produit_id: 'p-loclac', nom: 'Poulet Loc Lac (Formule)', prix: 13.9, quantite: 1, categorie_id: 'c-f-loclac', est_formule: true },
  { ligne_uid: 's1', lien_plat: 'f1', produit_id: 'p-coca', nom: '  ↳ Coca 33cl (formule)', prix: 0, quantite: 1, categorie_id: 'c-boissons' },
];
const coca = produits.find(p => p.id === 'p-coca');
const fusionnable = panier6.filter(l => NC.memeLigne(l, coca));
verif('aucune fusion avec la sous-ligne à 0 €', fusionnable.length, 0);

console.log('\n=== 7. SUPPRESSION : la ligne emporte ses sous-lignes ===');
verif('retirerLigne(f1) vide tout', NC.retirerLigne(panier6, 'f1').length, 0);
verif('les 2 Loc Lac : retirer A garde B', NC.retirerLigne(panier2, uidA).map(l => l.ligne_uid), [uidB, 'sl3', 'sl4']);

// ============================================================
console.log('\n=== 8. DESSERT + BOISSON SEULS : jamais en cuisine ===');
const panier8 = [
  { ligne_uid: 'd1', produit_id: 'p-tapioka', nom: 'Perle de Tapioka', prix: 4.0, quantite: 1, categorie_id: 'c-desserts' },
  { ligne_uid: 'd2', produit_id: 'p-coca', nom: 'Coca 33cl', prix: 1.5, quantite: 2, categorie_id: 'c-boissons' },
];
const imp8 = NC.construireImpression(panier8, { numero: 108, total: 7.0 });
verif('aucun bon cuisine', imp8.bonCuisine, null);
verif('aucun bon sushi', imp8.bonSushi, null);
verif('mais bien sur le ticket client', imp8.ticketClient.lignes.length, 2);


console.log('\n=== 9. BOX : composants restent en détail (pas de lignes 0€) ===');
const prodBox = { id:'p-box', nom:'Box Coupe du Monde', prix:19.9, categorie_id:'c-f-loclac',
  formule_etapes:[{produit_id:'p-nems', type:'fixe', label:'Nems Poulet'},{produit_id:'p-suppoul', type:'fixe', label:'Poulet riz'}] };
NC.init({ produits: produits.concat([prodBox]), categories });
const panier9 = [
  { ligne_uid:'b1', produit_id:'p-box', nom:'Box Coupe du Monde', prix:19.9, quantite:1, categorie_id:'c-f-loclac' },
  { ligne_uid:'b2', lien_plat:'b1', produit_id:'p-nems', nom:'  ↳ Nems Poulet (box)', prix:0, quantite:1, categorie_id:'c-entrees' },
  { ligne_uid:'b3', lien_plat:'b1', produit_id:'p-suppoul', nom:'  ↳ Poulet riz (box)', prix:0, quantite:1, categorie_id:'c-supp' },
];
const imp9 = NC.construireImpression(panier9, { numero: 109, total: 19.9 });
verif('ticket client : 1 seule ligne (box compacte)', imp9.ticketClient.lignes.length, 1);
verif('composants en détail', imp9.ticketClient.lignes[0].details, ['Nems Poulet','Poulet riz']);
verif('box : composants restent en détail', imp9.bonCuisine.items[0].details, ['Nems Poulet','Poulet riz']);


console.log('\n=== 10. PIÈCES DES ENTRÉES — données réelles Gin Khao ===');
const ENTREES_REELLES = [
  { id:'e-riz',      nom:'Riz Blanc',                      prix:2.50, categorie_id:'c-entrees', variantes:[] },
  { id:'e-dynpo',    nom:'Dynamite Poulet',                prix:6.90, categorie_id:'c-entrees', variantes:[] },
  { id:'e-temppo',   nom:'Tempura Poulet',                 prix:6.90, categorie_id:'c-entrees', variantes:[{prix:7.9,label:'4 pièces'}] },
  { id:'e-tempcr',   nom:'Tempura Crevettes',              prix:7.90, categorie_id:'c-entrees', variantes:[{prix:7.9,label:'4 pièces'}] },
  { id:'e-brocara',  nom:'Brochette Poulet Caramélisé',    prix:4.90, categorie_id:'c-entrees', variantes:[{prix:4.9,pieces:2},{prix:9.9,pieces:5},{prix:17.9,pieces:10}] },
  { id:'e-nemspo',   nom:'Nems Poulet',                    prix:3.99, categorie_id:'c-entrees', variantes:[{prix:3.9,pieces:2},{prix:6.9,pieces:4},{prix:7.9,pieces:6},{prix:9.9,pieces:8}] },
  { id:'e-samou',    nom:'Samoussa Bœuf',                  prix:3.99, categorie_id:'c-entrees', variantes:[{prix:3.9,pieces:2},{prix:6.9,pieces:4},{prix:7.9,pieces:6},{prix:9.9,pieces:8}] },
];
NC.init({ produits: produits.concat(ENTREES_REELLES), categories });
verif('Nems Poulet (2/4/6/8)      -> 2 pcs', NC.labelEntreeFormule('e-nemspo', null), 'Nems Poulet (2 pcs)');
verif('Samoussa Bœuf (2/4/6/8)    -> 2 pcs', NC.labelEntreeFormule('e-samou', null), 'Samoussa Bœuf (2 pcs)');
verif('Brochette (2/5/10)         -> 2 pcs', NC.labelEntreeFormule('e-brocara', null), 'Brochette Poulet Caramélisé (2 pcs)');
verif('Tempura Poulet (4 seul)    -> 4 pcs', NC.labelEntreeFormule('e-temppo', null), 'Tempura Poulet (4 pcs)');
verif('Tempura Crevettes (4 seul) -> 4 pcs', NC.labelEntreeFormule('e-tempcr', null), 'Tempura Crevettes (4 pcs)');
verif('Riz Blanc (pas à la pièce) -> nom nu', NC.labelEntreeFormule('e-riz', null), 'Riz Blanc');
verif('Dynamite (pas à la pièce)  -> nom nu', NC.labelEntreeFormule('e-dynpo', null), 'Dynamite Poulet');
verif('libellé 8 pcs corrigé en 2', NC.labelEntreeFormule('e-nemspo', 'Nems Poulet (8 pièces)'), 'Nems Poulet (2 pcs)');
verif('libellé parasite sur Riz nettoyé', NC.labelEntreeFormule('e-riz', 'Riz Blanc (2 pièces)'), 'Riz Blanc');
verif('hors formule : 6 pcs conservés', NC.labelVariante({prix:7.9, pieces:6}), '6 pcs');

const panier10 = [
  { ligne_uid:'m1', produit_id:'p-loclac', nom:'Poulet Loc Lac (Formule)', prix:13.9, quantite:1,
    categorie_id:'c-f-loclac', est_formule:true, options_base:{'Féculent':'Riz'},
    formule_entree_id:'e-temppo' },   // label NON transmis (cas commande borne)
  { ligne_uid:'m2', lien_plat:'m1', produit_id:'e-temppo', nom:'  ↳ Tempura Poulet (formule)', prix:0, quantite:1, categorie_id:'c-entrees' },
];
const imp10 = NC.construireImpression(panier10, { numero:110, total:13.9 });
verif('bon cuisine : Tempura en ligne propre', imp10.bonCuisine.items.map(i => i.nom),
  ['Riz Poulet Loc Lac', 'Tempura Poulet (4 pcs)']);
verif('ticket client : Tempura 4 pcs', imp10.ticketClient.lignes[1].nom, '  ↳ Tempura Poulet (4 pcs) (formule)');

console.log('\n=== 11. ENTRÉES PROPOSABLES EN FORMULE ===');
const ENTREES_V2 = ENTREES_REELLES.map(e =>
  /^tempura/i.test(e.nom) ? Object.assign({}, e, { visible_formule: false }) : e);
// on écarte le 'Nems Poulet' factice des premiers tests pour ne garder que les entrées réelles
NC.init({ produits: produits.filter(x => x.id !== 'p-nems').concat(ENTREES_V2), categories });
const dispo = NC.entreesFormule();
verif('Tempura exclus des formules', dispo.filter(d => /tempura/i.test(d.label)).length, 0);
verif('liste proposée', dispo.map(d => d.label),
  ['Riz Blanc', 'Dynamite Poulet', 'Brochette Poulet Caramélisé (2 pcs)',
   'Nems Poulet (2 pcs)', 'Samoussa Bœuf (2 pcs)']);
verif('Riz Blanc reste proposable, sans pièces', NC.labelEntreeFormule('e-riz', null), 'Riz Blanc');

console.log('\n=== 12. CHECKLIST LIVREUR (itemsLivraison) ===');
NC.init({ produits: [
  { id: 'L1', nom: 'Bœuf Loc Lac', prix: 12.9, categorie_id: 'cl' },
  { id: 'S1', nom: 'Suppl. Poulet', prix: 3, categorie_id: 'cs' },
  { id: 'F1', nom: 'Formule LL', prix: 15.9, categorie_id: 'cf', est_formule: true },
  { id: 'N1', nom: 'Nems Poulet', prix: 3.99, categorie_id: 'ce',
    visible_formule: true, variantes: [{ prix: 3.9, pieces: 2 }] },
  { id: 'C1', nom: 'Coca 33cl', prix: 1.5, categorie_id: 'cb' },
  { id: 'D1', nom: 'Perle Coco', prix: 4.5, categorie_id: 'cd' } ],
  categories: [
  { id: 'cl', nom: 'Loc Lac', station: 'cuisine' },
  { id: 'cs', nom: 'Suppléments', station: 'cuisine' },
  { id: 'cf', nom: 'Formule Loc Lac', station: 'cuisine' },
  { id: 'ce', nom: 'Entrées', station: 'cuisine' },
  { id: 'cb', nom: 'Boissons', station: 'comptoir' },
  { id: 'cd', nom: 'Desserts', station: 'comptoir' } ] });
const cartLiv = [
  { ligne_uid: 'a', produit_id: 'L1', nom: 'Bœuf Loc Lac', prix: 12.9, quantite: 1,
    categorie_id: 'cl', options_base: { 'Féculent': 'Riz' }, supplements_sel: ['S1'] },
  { ligne_uid: 'a1', produit_id: 'S1', nom: '  ↳ Suppl. Poulet', prix: 3, quantite: 1,
    categorie_id: 'cs', lien_plat: 'a' },
  { ligne_uid: 'f', produit_id: 'F1', nom: 'Formule LL', prix: 15.9, quantite: 1,
    categorie_id: 'cf', est_formule: true, formule_entree_id: 'N1', formule_boisson_id: 'C1' },
  { ligne_uid: 'f1', produit_id: 'C1', nom: '  ↳ Coca 33cl (formule)', prix: 0, quantite: 1,
    categorie_id: 'cb', lien_plat: 'f' },
  { ligne_uid: 'f2', produit_id: 'N1', nom: '  ↳ Nems Poulet (formule)', prix: 0, quantite: 1,
    categorie_id: 'ce', lien_plat: 'f' },
  { ligne_uid: 'd', produit_id: 'D1', nom: 'Perle Coco', prix: 4.5, quantite: 2, categorie_id: 'cd' },
  { ligne_uid: 'b', produit_id: 'C1', nom: 'Coca 33cl', prix: 1.5, quantite: 1, categorie_id: 'cb' },
  { produit_id: null, nom: '🚗 Frais de livraison (4,2 km)', prix: 4, quantite: 1 },
  { produit_id: 'D1', nom: '🎁 Dessert offert', prix: -4.5, quantite: 1 } ];
const impLiv = NC.construireImpression(cartLiv, { numero: 1 });
verif('livreur : la checklist complète (boissons + desserts + coca formule)',
  impLiv.itemsLivraison.map(i => i.quantite + 'x ' + i.nom),
  ['1x Riz Bœuf Loc Lac', '1x Formule LL', '1x Coca 33cl', '1x Nems Poulet (2 pcs)',
   '2x Perle Coco', '1x Coca 33cl']);
verif('livreur : suppléments, frais et remises exclus',
  impLiv.itemsLivraison.filter(i => /Suppl|Frais|offert/i.test(i.nom)).length, 0);
verif('livreur : bons cuisine INCHANGÉS (pas de coca/dessert)',
  (impLiv.bonCuisine.items || []).filter(i => /coca|coco/i.test(i.nom)).length, 0);

console.log('\n============================================');
console.log(`  ${ok} réussis · ${ko} échoués`);
console.log('============================================\n');
process.exit(ko ? 1 : 0);
