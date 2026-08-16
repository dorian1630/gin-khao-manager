// ============================================================
// RELAIS IMPRESSION — Commandes BORNE — Gin Khao
// ============================================================
// Surveille la table impressions_borne et imprime :
//   - BON CUISINE  -> plats chauds
//   - BON SUSHI    -> makis / californias / crispys / poke
//   - TICKET COMPTOIR -> récap complet avec prix
// Tourne à côté de serveur-impression.js et relais-online.js.
// Lancement : node relais-borne.js
// ============================================================

const net = require('net');
const { createClient } = require('@supabase/supabase-js');

const CONFIG = {
  supabaseUrl: 'https://szpgbdnijyoquqmjhhjj.supabase.co',
  serviceRoleKey: require('fs').readFileSync(__dirname + '/cle.txt', 'utf8').trim(),
  restaurantId: 'gin-khao',
  intervalMs: 5000,
  modeTest: false,            // ⚠️ true = simulation console. Passer à false pour imprimer.
  ticketComptoir: true,      // récap complet sur l'imprimante comptoir
  // ⚠️ À VÉRIFIER avant déploiement : mêmes IP que serveur-impression.js
  //    (ping depuis le Pi : 192.168.1.245 / .149 / .246 doivent répondre).
  imprimantes: {
    cuisine:  { ip: '192.168.1.245', port: 9100, nom: 'Cuisine' },
    sushi:    { ip: '192.168.1.149', port: 9100, nom: 'Sushi' },
    comptoir: { ip: '192.168.1.246', port: 9100, nom: 'Comptoir' },
  },
  largeur: 42,
  // Mentions légales / TVA — mêmes valeurs que la caisse (pos.html)
  resto: {
    nom: 'Gin Khao',
    sousTitre: 'Street Food Thai',
    adresse: 'Saint Just · Marseille',
    tvaNum: 'FR76922266960',
    naf: '5610C',
    siret: '',
    tauxTVA: 5.5,
  },
};

const ESC = '\x1B', GS = '\x1D';
const CMD = {
  init: ESC + '@', alignLeft: ESC + 'a' + '\x00', alignCenter: ESC + 'a' + '\x01',
  alignRight: ESC + 'a' + '\x02',
  boldOn: ESC + 'E' + '\x01', boldOff: ESC + 'E' + '\x00',
  doubleOn: GS + '!' + '\x11', doubleOff: GS + '!' + '\x00',
  largeOn: GS + '!' + '\x01', largeOff: GS + '!' + '\x00',
  taille3: GS + '!' + '\x22', taille2: GS + '!' + '\x11', hauteur2: GS + '!' + '\x01',
  cut: GS + 'V' + '\x00', feed: (n) => ESC + 'd' + String.fromCharCode(n),
};

// ⚠️ Les ligatures (œ, æ) ne sont PAS décomposées par normalize('NFD') :
// sans les traiter avant, "bœuf" devenait "buf". D'où les remplacements explicites.
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
function ligneGD(g, d, largeur = CONFIG.largeur) {
  const total = g.length + d.length;
  return total >= largeur ? g + ' ' + d : g + ' '.repeat(largeur - total) + d;
}
function separateur(car = '-', l = CONFIG.largeur) { return car.repeat(l); }
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
// Ventilation TVA à partir d'un total TTC (taux unique)
function calculerTVA(ttc, taux) {
  const t = Number(ttc) || 0, tx = Number(taux) || 0;
  const ht = t / (1 + tx / 100);
  return { taux: tx, ht: Math.round(ht * 100) / 100, montant: Math.round((t - ht) * 100) / 100, ttc: Math.round(t * 100) / 100 };
}

// BON DE PRÉPARATION (cuisine ou sushi)
// Mise en page identique à celle de la caisse :
//   numéro géant / mode service / poste + date / origine ou client / nb articles
//   puis les plats en gros avec leurs options en dessous.
function bonPreparationEscPos(cmd, items, titre) {
  const A = versAscii;
  const d = new Date(cmd.cree_le);
  const dateBon = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' +
                  d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const modeLbl = cmd.mode_service === 'sur_place' ? 'Sur place' : 'A emporter';
  const poste = titre === 'BON SUSHI' ? 'sushi' : 'cuisine';
  // À la place du caissier : le prénom du client s'il est connu, sinon "Borne"
  const signature = cmd.client_prenom || cmd.client_nom || 'Borne';

  let s = CMD.init;

  // Numéro en très gros, centré
  s += CMD.alignCenter + CMD.taille3 + CMD.boldOn;
  s += A(cmd.numero) + '\n';
  s += CMD.boldOff + CMD.doubleOff;

  // Mode de service
  s += CMD.taille2 + CMD.boldOn + modeLbl + '\n' + CMD.boldOff + CMD.largeOff;

  // Poste à gauche, date+heure à droite
  s += CMD.alignLeft + separateur('-') + '\n';
  s += ligneGD(poste, dateBon) + '\n';

  // Origine / client, centré
  s += CMD.alignCenter + A(signature) + '\n' + CMD.alignLeft;

  // Nombre total d'articles, à droite
  const nbArticles = items.reduce((n, it) => n + (Number(it.quantite) || 1), 0);
  s += CMD.alignRight + CMD.boldOn + String(nbArticles) + '\n' + CMD.boldOff + CMD.alignLeft;
  s += separateur('-') + '\n' + CMD.feed(1);

  // Les plats : quantité + nom en gros, options en dessous
  items.forEach((it) => {
    // Nom du plat en TRÈS GROS (x2) — largeur utile = 21 caractères
    s += CMD.taille2 + CMD.boldOn;
    const titre = (it.quantite || 1) + '  ' + A(String(it.nom_cuisine || it.nom).toUpperCase());
    wrap(titre, 20).split('\n').forEach((ln, i) => {
      s += (i === 0 ? '' : '   ') + ln + '\n';
    });
    s += CMD.boldOff + CMD.largeOff;
    // Options en hauteur double (largeur normale = 42 caractères)
    (it.details || []).forEach((det) => {
      s += CMD.hauteur2 + '   ' + A(String(det).toUpperCase()) + '\n' + CMD.largeOff;
    });
    s += CMD.feed(1);
  });

  s += CMD.feed(5) + CMD.cut;
  return s;
}

// TICKET COMPTOIR (récap complet avec prix)
function ticketComptoirEscPos(cmd) {
  const date = new Date(cmd.cree_le).toLocaleString('fr-FR');
  const modeLbl = cmd.mode_service === 'sur_place' ? 'SUR PLACE' : 'A EMPORTER';
  let s = CMD.init + CMD.alignCenter + CMD.doubleOn + versAscii(CONFIG.resto.nom.toUpperCase()) + '\n' + CMD.doubleOff;
  s += versAscii(CONFIG.resto.sousTitre) + '\n' + versAscii(CONFIG.resto.adresse) + '\n' + CMD.feed(1) + 'Commande BORNE\n' + CMD.feed(1);
  s += CMD.boldOn + '[' + modeLbl + ']\n' + CMD.boldOff;
  s += CMD.feed(1) + separateur('=') + '\n' + 'NUMERO\n';
  s += CMD.doubleOn + '#' + cmd.numero + '\n' + CMD.doubleOff + separateur('=') + '\n';
  s += CMD.alignLeft;
  if (cmd.client_nom) s += CMD.boldOn + 'Client : ' + versAscii(cmd.client_nom) + '\n' + CMD.boldOff;
  s += 'Date : ' + versAscii(date) + '\n' + separateur('-') + '\n';
  // ⚠️ Le payload borne v26.07-e regroupe DEUX familles dans cmd.lignes :
  //    les items de BONS (station cuisine/sushi, prix 0, pas de details_comptoir)
  //    et les lignes CLIENT (station comptoir, prix réels). Sans ce filtre, les
  //    items de bons ressortaient en lignes fantômes "0,00 EUR" sur ce ticket.
  //    Les anciens payloads (une ligne par article, prix réels) passent intacts.
  const lignesClient = (cmd.lignes || []).filter((it) =>
    !(it.station && it.station !== 'comptoir'
      && !(Number(it.prix) || 0)
      && !((it.details_comptoir || []).length)));
  lignesClient.forEach((it) => {
    const st = (Number(it.prix) || 0) * (it.quantite || 1);
    // 🥤 Boisson seule → pas de "1x"
    const prefixe = (it.est_boisson && (it.quantite || 1) === 1) ? '' : (it.quantite + 'x ');
    s += ligneGD(versAscii(prefixe + it.nom), euro(st)) + '\n';
    // Détails comptoir : sans les suppléments/sauces déjà facturés sur leur propre ligne
    const detsComptoir = it.details_comptoir || it.details || [];
    detsComptoir.forEach((d) => { s += '   > ' + versAscii(d) + '\n'; });
  });
  s += separateur('-') + '\n' + CMD.boldOn + CMD.largeOn;
  s += ligneGD('TOTAL', euro(cmd.total), Math.floor(CONFIG.largeur / 2)) + '\n';
  s += CMD.largeOff + CMD.boldOff;

  // ---- Ventilation TVA (pour les clients qui demandent un justificatif) ----
  const R = CONFIG.resto;
  const tva = calculerTVA(cmd.total, R.tauxTVA);
  s += separateur('-') + '\n' + CMD.boldOn + 'DETAIL TVA\n' + CMD.boldOff;
  s += 'Taux'.padEnd(9) + 'Base HT'.padStart(11) + 'TVA'.padStart(10) + 'Total TTC'.padStart(12) + '\n';
  s += (String(tva.taux).replace('.', ',') + ' %').padEnd(9)
     + eur(tva.ht).padStart(11) + eur(tva.montant).padStart(10) + eur(tva.ttc).padStart(12) + '\n';

  // ---- Mentions légales ----
  const legal = [];
  if (R.tvaNum) legal.push('TVA intracom : ' + R.tvaNum);
  if (R.siret)  legal.push('SIRET : ' + R.siret);
  if (R.naf)    legal.push('NAF/APE : ' + R.naf);
  if (legal.length) { s += separateur('-') + '\n'; legal.forEach((l) => { s += l + '\n'; }); }

  s += CMD.feed(1) + CMD.alignCenter;
  const paiementLbl = cmd.mode_paiement === 'comptoir'
    ? '*** A REGLER AU COMPTOIR ***'
    : '*** PAYE PAR CARTE ***';
  s += CMD.boldOn + paiementLbl + '\n' + CMD.boldOff;
  s += CMD.feed(5) + CMD.cut;
  return s;
}

function envoyerVersImprimante(imprimante, escpos) {
  if (CONFIG.modeTest) {
    const lisible = escpos.replace(/\x1B@/g, '').replace(/\x1B./g, '').replace(/\x1D../g, '').replace(/[\x00-\x08\x0E-\x1F]/g, '');
    console.log('\n----- [SIMULATION] ' + imprimante.nom + ' -----');
    console.log(lisible.trim());
    console.log('----- (fin) -----');
    return Promise.resolve({ ok: true });
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

// 🖨️ Impression PAR STATION avec mémorisation (colonne stations_ok text[]).
//    Chaque bon (cuisine / sushi / comptoir) est suivi individuellement :
//    - un bon déjà sorti ne ressort JAMAIS (fini les doublons en cuisine)
//    - un bon en échec est le SEUL à être retenté au cycle suivant
//    - le ticket comptoir n'est plus jamais perdu silencieusement
async function imprimerCommande(supabase, cmd) {
  const lignes = cmd.lignes || [];
  const cuisine = lignes.filter((l) => l.station === 'cuisine');
  const sushi = lignes.filter((l) => l.station === 'sushi');
  const faites = Array.isArray(cmd.stations_ok) ? cmd.stations_ok.slice() : [];

  // Les bons attendus pour CETTE commande
  const cibles = [];
  if (cuisine.length) cibles.push('cuisine');
  if (sushi.length) cibles.push('sushi');
  if (CONFIG.ticketComptoir) cibles.push('comptoir');

  const restantes = cibles.filter((st) => !faites.includes(st));
  if (restantes.length) console.log('→ #' + cmd.numero + ' — à imprimer : ' + restantes.join(', '));

  const marquer = async (station) => {
    faites.push(station);
    const { error: e2 } = await supabase.from('impressions_borne')
      .update({ stations_ok: faites }).eq('id', cmd.id);
    if (e2) console.warn('   (stations_ok non enregistré : ' + e2.message
      + ' — lancer : alter table impressions_borne add column if not exists stations_ok text[];)');
  };

  let erreurs = 0;
  for (const station of restantes) {
    try {
      if (station === 'cuisine') await envoyerVersImprimante(CONFIG.imprimantes.cuisine, bonPreparationEscPos(cmd, cuisine, 'BON CUISINE'));
      else if (station === 'sushi') await envoyerVersImprimante(CONFIG.imprimantes.sushi, bonPreparationEscPos(cmd, sushi, 'BON SUSHI'));
      else if (station === 'comptoir') await envoyerVersImprimante(CONFIG.imprimantes.comptoir, ticketComptoirEscPos(cmd));
      await marquer(station);
      console.log('  ✓ #' + cmd.numero + ' — ' + station + ' OK');
    } catch (e) {
      erreurs++;
      console.warn('  ! #' + cmd.numero + ' — ' + station + ' KO (' + e.message + ') — retenté au prochain cycle');
    }
  }

  // Tout est sorti → commande terminée
  if (cibles.every((st) => faites.includes(st))) {
    await supabase.from('impressions_borne').update({ imprimee: true }).eq('id', cmd.id);
    console.log('  ✓ #' + cmd.numero + ' complète' + (CONFIG.modeTest ? ' (simulation)' : ''));
  }
  return erreurs;
}

// ⏳ Au-delà de cet âge, une commande incomplète est ABANDONNÉE (marquée) :
//    on ne rejoue jamais un vieux ticket pendant le service d'un autre client.
const AGE_MAX_MS = 15 * 60 * 1000;   // 15 minutes

async function boucle(supabase) {
  const { data, error } = await supabase
    .from('impressions_borne')
    .select('*')
    .eq('restaurant_id', CONFIG.restaurantId)
    .eq('imprimee', false)
    .order('cree_le', { ascending: true })
    .limit(20);
  if (error) { console.error('Erreur lecture :', error.message); return; }
  for (const cmd of data || []) {
    // Trop ancienne → on abandonne proprement (plus de vieux tickets surprises)
    if (cmd.cree_le && (Date.now() - new Date(cmd.cree_le).getTime()) > AGE_MAX_MS) {
      await supabase.from('impressions_borne').update({ imprimee: true }).eq('id', cmd.id);
      console.warn('  ⏳ #' + cmd.numero + ' trop ancienne (>15 min) — abandonnée, non imprimée');
      continue;
    }
    try { await imprimerCommande(supabase, cmd); }
    catch (e) { console.warn('  ! #' + cmd.numero + ' erreur inattendue : ' + e.message); }
  }
}

async function main() {
  const supabase = createClient(CONFIG.supabaseUrl, CONFIG.serviceRoleKey, { auth: { persistSession: false } });

  // Rattrapage au démarrage : on n'abandonne QUE ce qui date de plus de 15 min.
  // ⚠️ Avant, TOUT était marqué imprimé : un redémarrage (PM2, tablette, Pi)
  //    faisait disparaître des commandes PAYÉES pas encore sorties en cuisine.
  const limiteDemarrage = new Date(Date.now() - AGE_MAX_MS).toISOString();
  await supabase.from('impressions_borne').update({ imprimee: true })
    .eq('restaurant_id', CONFIG.restaurantId).eq('imprimee', false)
    .lt('cree_le', limiteDemarrage);

  console.log('=================================================');
  console.log('  RELAIS IMPRESSION BORNE v26.08-PI — ' + CONFIG.restaurantId);
  console.log('  Mode : ' + (CONFIG.modeTest ? 'TEST (console)' : 'IMPRESSION RÉELLE'));
  console.log('  En attente de nouvelles commandes…  (Ctrl+C)');
  console.log('=================================================\n');

  boucle(supabase);
  setInterval(() => boucle(supabase), CONFIG.intervalMs);
}

main().catch((e) => { console.error('Erreur fatale :', e.message); process.exit(1); });
