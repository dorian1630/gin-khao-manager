// ============================================================
// RELAIS IMPRESSION — Commandes EN LIGNE (site web) — Gin Khao
// ============================================================
// Surveille les nouvelles commandes en ligne d'UN magasin et les
// imprime automatiquement :
// - BON CUISINE -> imprimante cuisine (articles à préparer)
// - TICKET COMPTOIR -> récap client (retrait / livraison)
//
// Tourne à côté de serveur-impression.js (il ne le remplace pas).
// Lancement : node relais-online.js
// ============================================================

const net = require('net');
const { createClient } = require('@supabase/supabase-js');

// ---------------- CONFIG À REMPLIR ----------------
const CONFIG = {
supabaseUrl: 'https://szpgbdnijyoquqmjhhjj.supabase.co',
// Clé SERVICE ROLE lue depuis le fichier cle.txt (placé à côté de ce fichier).
serviceRoleKey: require('fs').readFileSync(__dirname + '/cle.txt', 'utf8').trim(),

resto: 'saint-just', // magasin de CETTE tablette
intervalMs: 8000, // fréquence de vérification (8 s)
modeTest: false, // true = affiche le ticket dans la console (aucune impression)

// ✅ IP alignées sur serveur-impression.js EN PRODUCTION (source de vérité :
//    il imprime chaque jour). Ping depuis le Pi : .245 / .149 / .246.
imprimantes: {
cuisine: { ip: '192.168.1.245', port: 9100, nom: 'Cuisine' },
sushi: { ip: '192.168.1.149', port: 9100, nom: 'Sushi' },
comptoir: { ip: '192.168.1.246', port: 9100, nom: 'Comptoir' },
},
largeur: 42,
// Mentions légales / TVA — mêmes valeurs que la caisse et la borne
resto_infos: {
nom: 'Gin Khao',
sousTitre: 'Street Food Thai',
adresse: 'Saint Just · Marseille',
tvaNum: 'FR76922266960',
naf: '5610C',
siret: '',
tauxTVA: 5.5,
},
};
// --------------------------------------------------

const MODE_LABEL = { sur_place: 'SUR PLACE', collect: 'A EMPORTER', livraison: 'LIVRAISON' };

// ---------- ROUTAGE — ALIGNÉ SUR LE NOYAU (caisse + borne) ----------
// La station vient de la colonne categories.station en base (chargée au
// démarrage). Repli par motifs IDENTIQUE au noyau si la colonne est vide.
// ⚠️ Avant : liste à correspondance EXACTE → "Formule Pokébowl" partait en
//    CUISINE, et AUCUN filtre comptoir → les Coca sortaient sur le bon cuisine.
function norm(s) {
return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
const MOTIFS_SUSHI = ['sushi', 'maki', 'california', 'crispy', 'tiger', 'poke'];
const RE_COMPTOIR = /^(boissons?|desserts?|sauces?|extras?)$/;   // exact — "Riz en sauce" reste cuisine
let STATIONS_PAR_NOM = {};   // { nomCategorieNormalisé: 'cuisine'|'sushi'|'comptoir' }

async function chargerStations(supabase) {
  const { data, error } = await supabase.from('categories')
    .select('nom, station, parent_id, id').eq('restaurant_id', 'gin-khao');
  if (error || !data) { console.warn('Stations non chargées (' + (error && error.message) + ') — repli motifs.'); return; }
  const parId = {}; data.forEach((c) => { parId[c.id] = c; });
  data.forEach((c) => {
    let st = c.station;
    if (!st && c.parent_id && parId[c.parent_id]) st = parId[c.parent_id].station;
    if (st) STATIONS_PAR_NOM[norm(c.nom)] = st;
  });
  console.log('Stations chargées : ' + Object.keys(STATIONS_PAR_NOM).length + ' catégories.');
}

function stationDeCategorie(catNom) {
  const nc = norm(catNom);
  if (STATIONS_PAR_NOM[nc]) return STATIONS_PAR_NOM[nc];
  for (let i = 0; i < MOTIFS_SUSHI.length; i++) if (nc.indexOf(MOTIFS_SUSHI[i]) !== -1) return 'sushi';
  if (RE_COMPTOIR.test(nc)) return 'comptoir';
  return 'cuisine';
}

// ---------- ESC/POS ----------
const ESC = '\x1B', GS = '\x1D';
const CMD = {
init: ESC + '@',
alignLeft: ESC + 'a' + '\x00',
alignCenter: ESC + 'a' + '\x01',
alignRight: ESC + 'a' + '\x02',
boldOn: ESC + 'E' + '\x01',
boldOff: ESC + 'E' + '\x00',
doubleOn: GS + '!' + '\x11',
doubleOff: GS + '!' + '\x00',
largeOn: GS + '!' + '\x01',
largeOff: GS + '!' + '\x00',
taille3: GS + '!' + '\x22',
taille2: GS + '!' + '\x11',
hauteur2: GS + '!' + '\x01',
cut: GS + 'V' + '\x00',
feed: (n) => ESC + 'd' + String.fromCharCode(n),
};

function ligneGD(g, d, largeur = CONFIG.largeur) {
const total = g.length + d.length;
return total >= largeur ? g + ' ' + d : g + ' '.repeat(largeur - total) + d;
}
function separateur(car = '-', largeur = CONFIG.largeur) { return car.repeat(largeur); }
function wrap(txt, largeur = CONFIG.largeur) {
if (txt.length <= largeur) return txt;
const lignes = []; let courant = '';
txt.split(' ').forEach((mot) => {
if ((courant + ' ' + mot).trim().length > largeur) { lignes.push(courant.trim()); courant = mot; }
else { courant = (courant + ' ' + mot).trim(); }
});
if (courant) lignes.push(courant.trim());
return lignes.join('\n');
}
function euro(n) { return Number(n || 0).toFixed(2).replace('.', ',') + ' EUR'; }
function eur(n) { return Number(n || 0).toFixed(2).replace('.', ','); }
function nomOf(o) { return (o && (o.fr || o.en)) || ''; }

// ⚠️ Les ligatures (œ, æ) ne sont PAS décomposées par normalize('NFD') :
// sans les traiter avant, "bœuf" devenait "buf".
function versAscii(str) {
return (str || '').toString()
.replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
.replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
.replace(/↳/g, '>').replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"')
.replace(/[·•]/g, '-').replace(/[–—]/g, '-').replace(/…/g, '...')
.replace(/€/g, 'EUR').replace(/°/g, 'o')
.replace(/[^\x00-\x7F]/g, '');
}
// Ventilation TVA à partir d'un total TTC (taux unique)
function calculerTVA(ttc, taux) {
const t = Number(ttc) || 0, tx = Number(taux) || 0;
const ht = t / (1 + tx / 100);
return { taux: tx, ht: Math.round(ht * 100) / 100, montant: Math.round((t - ht) * 100) / 100, ttc: Math.round(t * 100) / 100 };
}
// Accompagnement choisi (Riz / Nouilles) → intégré au NOM sur le bon cuisine
function accompagnementDe(it) {
const c = (it.choices || []).find((ch) => ch && /^(riz|nouilles?)$/i.test(String(ch.valeur || '').trim()));
return c ? String(c.valeur).trim() : null;
}
// Détails d'un article.
//   'cuisine'  : options (sauf l'accompagnement, déjà dans le nom) + suppléments
//   'comptoir' : options seules (les suppléments sont déjà facturés en lignes)
function detailsDe(it, pour) {
const d = [];
const acc = accompagnementDe(it);
(it.choices || []).forEach((ch) => {
if (!ch || !ch.valeur) return;
if (pour === 'cuisine' && acc && String(ch.valeur).trim() === acc) return;
// "Normal" = préparation habituelle → jamais imprimé (même règle que la caisse/borne)
if (/^normal$/i.test(String(ch.valeur).trim())) return;
d.push(String(ch.valeur));
});
if (pour === 'cuisine') {
(it.upsells || []).forEach((u) => d.push('+ ' + nomOf(u.nom)));
}
return d;
}

// ---------- Générateurs ----------
function bonPreparationEscPos(cmd, items, titre) {
const A = versAscii;
const d = new Date(cmd.cree_le);
const dateBon = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' +
d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const modeLbl = cmd.mode === 'sur_place' ? 'Sur place'
: cmd.mode === 'livraison' ? 'Livraison' : 'A emporter';
const poste = titre === 'BON SUSHI' ? 'sushi' : 'cuisine';
// À la place du caissier : le prénom du client, sinon "En ligne"
const signature = (cmd.client_nom ? String(cmd.client_nom).trim().split(/\s+/)[0] : null) || 'En ligne';

let s = CMD.init;

// Numéro en très gros, centré
s += CMD.alignCenter + CMD.taille3 + CMD.boldOn;
s += A(cmd.numero) + '\n';
s += CMD.boldOff + CMD.doubleOff;

// Mode de service
s += CMD.taille2 + CMD.boldOn + modeLbl + '\n' + CMD.boldOff + CMD.largeOff;
s += CMD.boldOn + '[EN LIGNE]\n' + CMD.boldOff;

// Poste à gauche, date+heure à droite
s += CMD.alignLeft + separateur('-') + '\n';
s += ligneGD(poste, dateBon) + '\n';

// Client, centré
s += CMD.alignCenter + A(signature) + '\n' + CMD.alignLeft;

// Nombre total d'articles, à droite
const nbArticles = (items || []).reduce((n, it) => n + (Number(it.qty) || 1), 0);
s += CMD.alignRight + CMD.boldOn + String(nbArticles) + '\n' + CMD.boldOff + CMD.alignLeft;
s += separateur('-') + '\n' + CMD.feed(1);

// Les plats : quantité + nom en gros (accompagnement inclus), options en dessous
(items || []).forEach((it) => {
const acc = accompagnementDe(it);
const nomPlat = (acc ? acc + ' ' : '') + nomOf(it.nom);
s += CMD.taille2 + CMD.boldOn;
const ligne = (it.qty || 1) + '  ' + A(nomPlat.toUpperCase());
wrap(ligne, 20).split('\n').forEach((ln, i) => { s += (i === 0 ? '' : '   ') + ln + '\n'; });
s += CMD.boldOff + CMD.largeOff;
detailsDe(it, 'cuisine').forEach((det) => {
s += CMD.hauteur2 + '   ' + A(String(det).toUpperCase()) + '\n' + CMD.largeOff;
});
s += CMD.feed(1);
});

s += CMD.feed(5) + CMD.cut;
return s;
}

function ticketComptoirEscPos(cmd) {
const A = versAscii;
const R = CONFIG.resto_infos;
const date = new Date(cmd.cree_le).toLocaleString('fr-FR');
let s = CMD.init + CMD.alignCenter + CMD.doubleOn + A(R.nom.toUpperCase()) + '\n' + CMD.doubleOff;
s += A(R.sousTitre) + '\n' + A(R.adresse) + '\n' + CMD.feed(1) + 'Commande en ligne\n' + CMD.feed(1);
const modeLbl = MODE_LABEL[cmd.mode] || cmd.mode || '';
if (modeLbl) s += CMD.boldOn + '[' + modeLbl + ']\n' + CMD.boldOff;
s += CMD.feed(1) + separateur('=') + '\n' + CMD.alignCenter + 'NUMERO\n';
s += CMD.doubleOn + A(cmd.numero) + '\n' + CMD.doubleOff + separateur('=') + '\n';
s += CMD.alignLeft;
if (cmd.client_nom) s += CMD.boldOn + 'Client : ' + A(cmd.client_nom) + '\n' + CMD.boldOff;
if (cmd.client_tel) s += 'Tel : ' + A(cmd.client_tel) + '\n';
if (cmd.mode === 'livraison' && cmd.client_adresse) {
s += CMD.boldOn + 'Livraison :\n' + CMD.boldOff + wrap(A(cmd.client_adresse)) + '\n';
}
s += 'Date : ' + A(date) + '\n' + separateur('-') + '\n';
(cmd.items || []).forEach((it) => {
s += ligneGD(A(it.qty + 'x ' + nomOf(it.nom)), euro(it.total)) + '\n';
// Options sous le plat (les suppléments restent des lignes facturées ci-dessous)
detailsDe(it, 'comptoir').forEach((d) => { s += '   > ' + A(d) + '\n'; });
(it.upsells || []).forEach((u) => { s += ligneGD(A('   + ' + nomOf(u.nom)), euro(u.prix)) + '\n'; });
});
if (Number(cmd.remise) > 0) s += ligneGD('Recompense fidelite', '-' + euro(cmd.remise)) + '\n';
if (Number(cmd.frais_livraison) > 0) s += ligneGD('Livraison', euro(cmd.frais_livraison)) + '\n';
s += separateur('-') + '\n' + CMD.boldOn + CMD.largeOn;
s += ligneGD('TOTAL', euro(cmd.total), Math.floor(CONFIG.largeur / 2)) + '\n';
s += CMD.largeOff + CMD.boldOff;

// ---- Ventilation TVA ----
const tva = calculerTVA(cmd.total, R.tauxTVA);
s += separateur('-') + '\n' + CMD.boldOn + 'DETAIL TVA\n' + CMD.boldOff;
s += 'Taux'.padEnd(9) + 'Base HT'.padStart(11) + 'TVA'.padStart(10) + 'Total TTC'.padStart(12) + '\n';
s += (String(tva.taux).replace('.', ',') + ' %').padEnd(9)
+ eur(tva.ht).padStart(11) + eur(tva.montant).padStart(10) + eur(tva.ttc).padStart(12) + '\n';

// ---- Mentions légales ----
const legal = [];
if (R.tvaNum) legal.push('TVA intracom : ' + R.tvaNum);
if (R.siret) legal.push('SIRET : ' + R.siret);
if (R.naf) legal.push('NAF/APE : ' + R.naf);
if (legal.length) { s += separateur('-') + '\n'; legal.forEach((l) => { s += l + '\n'; }); }

s += CMD.feed(1) + CMD.alignCenter;
s += CMD.boldOn + '*** PAYE EN LIGNE ***\n' + CMD.boldOff;
s += CMD.feed(2) + 'Merci pour votre commande !\n' + CMD.feed(5) + CMD.cut;
return s;
}

// ---------- Envoi imprimante (ou simulation console) ----------
function envoyerVersImprimante(imprimante, escpos) {
if (CONFIG.modeTest) {
const lisible = escpos
.replace(/\x1B@/g, '').replace(/\x1B./g, '').replace(/\x1D../g, '')
.replace(/[\x00-\x08\x0E-\x1F]/g, '');
console.log('\n----- [SIMULATION] ' + imprimante.nom + ' -----');
console.log(lisible.trim());
console.log('----- (fin) -----');
return Promise.resolve({ ok: true, imprimante: imprimante.nom + ' (simulation)' });
}
return new Promise((resolve, reject) => {
const client = new net.Socket();
let resolved = false;
client.setTimeout(5000);
client.connect(imprimante.port, imprimante.ip, () => {
client.write(escpos, 'binary', () => {
setTimeout(() => { client.end(); if (!resolved) { resolved = true; resolve({ ok: true }); } }, 200);
});
});
client.on('timeout', () => { client.destroy(); if (!resolved) { resolved = true; reject(new Error(imprimante.nom + ' injoignable (timeout)')); } });
client.on('error', (err) => { if (!resolved) { resolved = true; reject(new Error(imprimante.nom + ' : ' + err.message)); } });
});
}

// ---------- Impression d'une commande ----------
async function imprimerCommande(supabase, cmd) {
const items = cmd.items || [];
const sushi = items.filter((it) => stationDeCategorie(it.categorie) === 'sushi');
// ⚠️ Boissons / desserts / sauces = comptoir : EXCLUS des bons de préparation
//    (avant, un Coca commandé en ligne sortait sur le bon cuisine).
const cuisine = items.filter((it) => stationDeCategorie(it.categorie) === 'cuisine');
console.log('→ ' + cmd.numero + ' (' + (cmd.client_nom || 'client') + ') — cuisine:' + cuisine.length + ' sushi:' + sushi.length);

// 🖨️ Impression PAR STATION avec mémorisation (colonne stations_ok text[]) —
//    même mécanique que relais-borne : un bon déjà sorti ne ressort JAMAIS
//    (avant : sushi en panne → le bon CUISINE ressortait à chaque cycle).
//    Prérequis SQL (une fois) :
//      alter table commandes add column if not exists stations_ok text[];
const faites = Array.isArray(cmd.stations_ok) ? cmd.stations_ok.slice() : [];
const cibles = [];
if (cuisine.length) cibles.push('cuisine');
if (sushi.length) cibles.push('sushi');
cibles.push('comptoir');

const marquer = async (station) => {
  faites.push(station);
  const { error: e2 } = await supabase.from('commandes')
    .update({ stations_ok: faites }).eq('id', cmd.id);
  if (e2) console.warn('   (stations_ok non enregistré : ' + e2.message + ' — lancer le ALTER TABLE)');
};

let erreurs = 0;
for (const station of cibles.filter((st) => !faites.includes(st))) {
  try {
    if (station === 'cuisine') await envoyerVersImprimante(CONFIG.imprimantes.cuisine, bonPreparationEscPos(cmd, cuisine, 'BON CUISINE'));
    else if (station === 'sushi') await envoyerVersImprimante(CONFIG.imprimantes.sushi, bonPreparationEscPos(cmd, sushi, 'BON SUSHI'));
    else if (station === 'comptoir') await envoyerVersImprimante(CONFIG.imprimantes.comptoir, ticketComptoirEscPos(cmd));
    await marquer(station);
    console.log('  ✓ ' + cmd.numero + ' — ' + station + ' OK');
  } catch (e) {
    erreurs++;
    console.warn('  ! ' + cmd.numero + ' — ' + station + ' KO (' + e.message + ') — retenté au prochain cycle');
  }
}
if (cibles.every((st) => faites.includes(st))) {
  await supabase.from('commandes').update({ imprimee: true }).eq('id', cmd.id);
  console.log(' ✓ ' + cmd.numero + ' complète' + (CONFIG.modeTest ? ' (simulation)' : ''));
}
}

// ---------- Boucle de surveillance ----------
async function boucle(supabase) {
const { data, error } = await supabase
.from('commandes')
.select('*')
.eq('resto', CONFIG.resto)
.eq('statut_paiement', 'paye')
.eq('imprimee', false)
.order('cree_le', { ascending: true })
.limit(20);
if (error) { console.error('Erreur lecture :', error.message); return; }
for (const cmd of data || []) {
try { await imprimerCommande(supabase, cmd); }
catch (e) { console.warn(' ! ' + cmd.numero + ' non imprimée (' + e.message + ') — nouvel essai au prochain cycle'); }
}
}

async function main() {
if (CONFIG.serviceRoleKey.startsWith('COLLE_')) {
console.error('\n⛔ Renseigne CONFIG.serviceRoleKey (clé service_role Supabase) avant de lancer.\n');
process.exit(1);
}
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.serviceRoleKey, { auth: { persistSession: false } });

// Rattrapage au démarrage : on n'abandonne QUE ce qui date de plus de 15 min.
// ⚠️ Avant, TOUT était marqué imprimé : un redémarrage de tablette faisait
//    disparaître des commandes PAYÉES en ligne — le client attendait, la
//    cuisine ne voyait rien.
const AGE_MAX_MS = 15 * 60 * 1000;
const limiteDemarrage = new Date(Date.now() - AGE_MAX_MS).toISOString();
const { error: rattrapErr } = await supabase
.from('commandes')
.update({ imprimee: true })
.eq('resto', CONFIG.resto)
.eq('statut_paiement', 'paye')
.eq('imprimee', false)
.lt('cree_le', limiteDemarrage);
if (rattrapErr) console.warn('Rattrapage démarrage :', rattrapErr.message);

// Charger le routage (colonne categories.station) — repli motifs si absent
await chargerStations(supabase);

console.log('=================================================');
console.log(' RELAIS IMPRESSION EN LIGNE — ' + CONFIG.resto);
console.log(' Mode : ' + (CONFIG.modeTest ? 'TEST (console)' : 'IMPRESSION RÉELLE'));
console.log(' Vérification toutes les ' + (CONFIG.intervalMs / 1000) + ' s');
console.log(' En attente de nouvelles commandes… (Ctrl+C pour arrêter)');
console.log('=================================================\n');

boucle(supabase);
setInterval(() => boucle(supabase), CONFIG.intervalMs);
}

main().catch((e) => { console.error('Erreur fatale :', e.message); process.exit(1); });
