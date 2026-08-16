// ============================================================
// SERVEUR RELAIS D'IMPRESSION — Gin Khao Caisse + Borne
// ============================================================
// Routage :
//   - bon cuisine        -> CUISINE
//   - bon sushi          -> SUSHI
//   - ticket client      -> COMPTOIR
//   - ticket borne client -> BORNE (à récupérer par le client)
// Lancement : node serveur-impression.js
// ============================================================

const http = require('http');
const net = require('net');

const CONFIG = {
  port: 9100,
  imprimantes: {
    cuisine:  { ip: '192.168.1.245', port: 9100, nom: 'Cuisine (SAGA)' },
    comptoir: { ip: '192.168.1.246', port: 9100, nom: 'Comptoir (Epson)' },
    sushi:    { ip: '192.168.1.149', port: 9100, nom: 'Station Sushi' },
    // ⚠️ À MODIFIER : remplacer XXX par la vraie IP de l'imprimante borne
    borne:    { ip: '192.168.123.100', port: 9100, nom: 'Borne client' }
  },
  largeur: 42
};

const ESC = '\x1B';
const GS = '\x1D';
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
  taille3: GS + '!' + '\x22',      // texte x3 (numéro des bons)
  taille2: GS + '!' + '\x11',      // texte x2 (mode service, plats)
  hauteur2: GS + '!' + '\x01',     // hauteur x2, largeur normale (options)
  tripleOn: GS + '!' + '\x33',     // ✨ Numéro géant pour borne
  tripleOff: GS + '!' + '\x00',
  cut: GS + 'V' + '\x00',
  feed: (n) => ESC + 'd' + String.fromCharCode(n)
};

function ligneGD(gauche, droite, largeur = CONFIG.largeur) {
  const total = gauche.length + droite.length;
  if (total >= largeur) return gauche + ' ' + droite;
  return gauche + ' '.repeat(largeur - total) + droite;
}
function separateur(car = '-', largeur = CONFIG.largeur) { return car.repeat(largeur); }
function wrap(txt, largeur = CONFIG.largeur) {
  if (txt.length <= largeur) return txt;
  const lignes = []; let courant = '';
  txt.split(' ').forEach(mot => {
    if ((courant + ' ' + mot).trim().length > largeur) { lignes.push(courant.trim()); courant = mot; }
    else { courant = (courant + ' ' + mot).trim(); }
  });
  if (courant) lignes.push(courant.trim());
  return lignes.join('\n');
}

// Nettoie les caractères que l'imprimante ne sait pas afficher
// (œ → OE, é → E, etc.) — évite les "buf" au lieu de "boeuf"
function versAscii(txt) {
  return String(txt == null ? '' : txt)
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // é → e
    .replace(/↳/g, '>').replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"')
    .replace(/[·•]/g, '-').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/€/g, 'EUR').replace(/°/g, 'o')
    .replace(/[^\x00-\x7F]/g, '');                      // emojis & reste
}

// BON DE PRÉPARATION (cuisine ou sushi)
// Mise en page identique au ticket de référence :
//   numéro géant / mode service / poste + date / caissier / nb articles
//   puis les plats en gros avec leurs options en dessous.
function genererBonPreparationEscPos(data, titre) {
  const { numero, heure, date, items, modeService, origine, caissier, poste, refBorne } = data;
  const A = versAscii;
  let s = CMD.init;

  // Numéro en très gros, centré
  s += CMD.alignCenter + CMD.taille3 + CMD.boldOn;
  s += A(numero) + '\n';
  s += CMD.boldOff + CMD.doubleOff;
  // 🔖 Référence borne (le client présente ce numéro-là)
  if (refBorne) s += CMD.boldOn + 'Borne ' + A(refBorne) + CMD.boldOff + '\n';

  // Mode de service (A emporter / Sur place)
  const modeLbl = modeService === 'sur_place' ? 'Sur place'
                : modeService === 'emporter' ? 'A emporter'
                : modeService === 'livraison' ? 'Livraison'
                : modeService ? A(modeService) : '';
  if (modeLbl) s += CMD.taille2 + CMD.boldOn + modeLbl + '\n' + CMD.boldOff + CMD.largeOff;
  if (origine === 'borne') s += '[BORNE]\n';

  // Ligne : poste (cuisine/sushi) à gauche, date+heure à droite
  s += CMD.alignLeft + separateur('-') + '\n';
  const posteLbl = poste || (titre === 'BON SUSHI' ? 'sushi' : 'cuisine');
  s += ligneGD(A(posteLbl), A(date || heure || '')) + '\n';

  // Caissier, centré
  if (caissier) s += CMD.alignCenter + A(caissier) + '\n' + CMD.alignLeft;

  // Nombre total d'articles, à droite
  const nbArticles = items.reduce((n, it) => n + (Number(it.quantite) || 1), 0);
  s += CMD.alignRight + CMD.boldOn + String(nbArticles) + '\n' + CMD.boldOff + CMD.alignLeft;
  s += separateur('-') + '\n' + CMD.feed(1);

  // Les plats : quantité + nom en gros, options en dessous
  items.forEach(it => {
    // Nom du plat en TRÈS GROS (x2) — largeur utile = 21 caractères
    s += CMD.taille2 + CMD.boldOn;
    const titre = (it.quantite || 1) + '  ' + A(String(it.nom).toUpperCase());
    wrap(titre, 20).split('\n').forEach((ln, i) => {
      s += (i === 0 ? '' : '   ') + ln + '\n';
    });
    s += CMD.boldOff + CMD.largeOff;
    // Options en hauteur double (largeur normale = 42 caractères)
    (it.details || []).forEach(d => {
      s += CMD.hauteur2 + '   ' + A(String(d).toUpperCase()) + '\n' + CMD.largeOff;
    });
    s += CMD.feed(1);
  });

  s += CMD.feed(5) + CMD.cut;
  return s;
}

// 📦 BON DE LIVRAISON — pour le livreur (imprimé au comptoir).
// Grand format : le livreur doit lire l'adresse d'un coup d'œil.
function genererBonLivraisonEscPos(data) {
  const { numero, date, client, items, total, modePaiement, fraisLivraison, appoint } = data;
  const A = versAscii;
  const c = client || {};
  let s = CMD.init;

  s += CMD.alignCenter + CMD.boldOn + CMD.doubleOn;
  s += 'LIVRAISON' + '\n';
  s += CMD.doubleOff + CMD.boldOff;
  s += CMD.largeOn + '#' + A(numero) + CMD.largeOff + '\n';
  s += A(date || '') + '\n';
  s += CMD.alignLeft + separateur('=') + '\n';

  // Client : nom + téléphone en gros (le livreur appelle depuis la rue)
  s += CMD.largeOn + CMD.boldOn;
  s += A((c.nom || 'Client').toUpperCase()) + '\n';
  if (c.telephone) s += A(c.telephone) + '\n';
  s += CMD.boldOff + CMD.largeOff;
  s += separateur('-') + '\n';

  // Adresse en gros
  s += CMD.boldOn + 'ADRESSE :' + CMD.boldOff + '\n';
  s += CMD.largeOn;
  if (c.adresse) wrap(A(c.adresse), 20).split('\n').forEach(l => { s += l + '\n'; });
  const villeCP = [c.code_postal, c.ville].filter(Boolean).join(' ');
  if (villeCP) s += A(villeCP) + '\n';
  s += CMD.largeOff;

  // Notes (interphone, code, étage…) — essentiel pour le livreur
  if (c.notes) {
    s += separateur('-') + '\n' + CMD.boldOn + 'NOTES :' + CMD.boldOff + '\n';
    s += CMD.largeOn;
    wrap(A(c.notes), 20).split('\n').forEach(l => { s += l + '\n'; });
    s += CMD.largeOff;
  }

  // Contenu de la commande
  s += separateur('=') + '\n' + CMD.boldOn + 'COMMANDE :' + CMD.boldOff + '\n';
  (items || []).forEach(it => {
    s += (it.quantite || 1) + 'x ' + A(it.nom) + '\n';
    (it.details || []).forEach(d => { s += '   > ' + A(d) + '\n'; });
  });

  // Montant à encaisser (ou déjà payé)
  s += separateur('=') + '\n';
  if (Number(fraisLivraison) > 0) {
    s += ligneGD('dont livraison', Number(fraisLivraison).toFixed(2).replace('.', ',') + ' EUR') + '\n';
  }
  s += CMD.boldOn + CMD.largeOn;
  s += ligneGD('TOTAL', Number(total).toFixed(2).replace('.', ',') + ' EUR', Math.floor(CONFIG.largeur / 2)) + '\n';
  s += CMD.largeOff + CMD.boldOff;
  // 💳 Mode de paiement — le livreur doit savoir quoi faire en arrivant
  s += CMD.alignCenter + CMD.boldOn + CMD.largeOn;
  // ⚠️ Commande prise par téléphone : le LIVREUR encaisse dans tous les cas
  //    (espèces, carte via TPE mobile, TR…). Seules les commandes déjà réglées
  //    en ligne (site) arrivent payées.
  const encaisser = (modePaiement !== 'plateforme');
  const modeLbl = modePaiement === 'especes' ? 'ESPECES'
                : modePaiement === 'carte' ? 'CARTE BANCAIRE'
                : modePaiement === 'ticket_resto' || modePaiement === 'ticket_resto_papier' ? 'TICKET RESTO'
                : modePaiement === 'comptoir' ? 'A REGLER'
                : modePaiement === 'mixte' ? 'PAIEMENT MIXTE'
                : modePaiement === 'plateforme' ? 'PAYE EN LIGNE'
                : A(String(modePaiement || '').toUpperCase());
  s += modeLbl + '\n';
  s += CMD.largeOff;
  s += encaisser ? '*** A ENCAISSER ***\n' : '*** DEJA PAYE ***\n';
  s += CMD.boldOff;

  // 💵 Espèces : le livreur doit-il emporter de la monnaie ?
  if (modePaiement === 'especes' && appoint !== null && appoint !== undefined) {
    s += CMD.feed(1) + CMD.largeOn + CMD.boldOn;
    s += appoint ? 'CLIENT A L\'APPOINT\n' : 'PREVOIR LA MONNAIE\n';
    s += CMD.boldOff + CMD.largeOff;
  }

  s += CMD.feed(5) + CMD.cut;
  return s;
}

// 🔒 TICKET Z — rapport de clôture de journée
function genererTicketZEscPos(z) {
  const A = versAscii;
  const eur = (m) => Number(m || 0).toFixed(2).replace('.', ',') + ' EUR';
  const dt = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('fr-FR'); };
  let s = CMD.init;
  s += CMD.alignCenter + CMD.doubleOn + 'Gin Khao' + '\n' + CMD.doubleOff;
  s += 'Street Food Thai' + '\n';
  s += '78 Av. de Saint-Just, 13013 Marseille' + '\n';
  s += CMD.feed(1);
  s += CMD.taille2 + CMD.boldOn + 'CLOTURE Z' + '\n' + CMD.boldOff + CMD.doubleOff;
  s += CMD.taille3 + CMD.boldOn + 'Z n.' + A(String(z.numero_z)) + '\n' + CMD.boldOff + CMD.doubleOff;
  s += CMD.feed(1) + CMD.alignLeft + separateur('=') + '\n';
  if (z.periode_debut) s += ligneGD('Debut periode', A(dt(z.periode_debut))) + '\n';
  s += ligneGD('Fin periode', A(dt(z.periode_fin))) + '\n';
  s += ligneGD('Imprime le', A(new Date().toLocaleString('fr-FR'))) + '\n';
  s += separateur('-') + '\n';
  s += ligneGD('Ventes validees', String(z.nb_ventes != null ? z.nb_ventes : '-')) + '\n';
  s += ligneGD('Ventes annulees', String(z.nb_annulees != null ? z.nb_annulees : '-')) + '\n';
  s += separateur('-') + '\n';
  s += CMD.boldOn + 'REGLEMENTS' + '\n' + CMD.boldOff;
  s += ligneGD('Especes (tiroir)', eur(z.total_especes)) + '\n';
  const carteCaisse = z.total_carte_caisse != null ? z.total_carte_caisse : z.total_carte;
  s += ligneGD('Carte comptoir (TPE)', eur(carteCaisse)) + '\n';
  s += ligneGD('Carte borne (SumUp)', eur(z.total_carte_borne)) + '\n';
  s += separateur('=') + '\n';
  s += CMD.boldOn + CMD.taille2;
  s += ligneGD('TOTAL Z', eur(z.total_ttc), Math.floor(CONFIG.largeur / 2)) + '\n';
  s += CMD.doubleOff + CMD.boldOff;
  s += separateur('=') + '\n';
  s += CMD.alignCenter;
  s += 'TVA intracom FR76922266960' + '\n';
  s += 'NAF/APE 5610C' + '\n';
  s += 'Document de gestion - a conserver' + '\n';
  s += CMD.feed(5) + CMD.cut;
  return s;
}

// TICKET CLIENT — avec prix + ventilation TVA
function genererTicketClientEscPos(data) {
  const { numero, date, lignes, total, modePaiement, restoNom, restoSousTitre, restoAdresse, annulee, tva, tvaNum, naf, siret, tel, masquerReglement, modeService } = data;
  const A = versAscii;
  let s = CMD.init;
  if (annulee) { s += CMD.alignCenter + CMD.boldOn + '*** TICKET ANNULE ***\n' + CMD.boldOff + CMD.feed(1); }
  s += CMD.alignCenter + CMD.doubleOn + A(restoNom || 'Gin Khao') + '\n' + CMD.doubleOff;
  if (restoSousTitre) s += A(restoSousTitre) + '\n';
  if (restoAdresse) s += A(restoAdresse) + '\n';
  if (tel) s += 'Tel : ' + A(tel) + '\n';
  // 🍽️ Mode de service bien visible (sur place / à emporter / …)
  const svc = modeService === 'sur_place' ? 'SUR PLACE'
            : modeService === 'emporter' ? 'A EMPORTER'
            : modeService === 'livraison' ? 'LIVRAISON'
            : (modeService === 'cc_comptoir' || modeService === 'cc_enligne' || modeService === 'click_collect') ? 'CLICK & COLLECT'
            : '';
  if (svc) {
    s += CMD.feed(1) + CMD.largeOn + CMD.boldOn + svc + '\n' + CMD.boldOff + CMD.largeOff;
  }
  s += CMD.feed(1) + CMD.alignLeft + separateur('-') + '\n';
  if (data.refBorne) {
    s += CMD.alignCenter + CMD.largeOn + CMD.boldOn + A(data.refBorne) + '\n' + CMD.boldOff + CMD.largeOff;
    s += 'Ticket #' + A(numero) + '\n';
    s += CMD.alignLeft + ligneGD('Date', A(date)) + '\n' + separateur('-') + '\n';
  } else {
    s += ligneGD('Ticket no', '#' + numero) + '\n';
    s += ligneGD('Date', A(date)) + '\n' + separateur('-') + '\n';
  }
  lignes.forEach(l => {
    const qte = l.quantite || 1;
    const nom = A(l.nom_produit || l.nom);
    const st = Number(l.sous_total != null ? l.sous_total : (l.prix_unitaire != null ? l.prix_unitaire : l.prix || 0) * qte);
    // 🥤 Une boisson seule s'écrit sans "1x" (juste son nom) ;
    //    à partir de 2, la quantité reste affichée.
    const sansQte = (l.prix_unitaire < 0 || st < 0) || (l.est_boisson && qte === 1);
    const debut = sansQte ? nom : qte + 'x ' + nom;
    const prix = (st < 0 ? '-' : '') + Math.abs(st).toFixed(2).replace('.', ',') + ' EUR';
    if (debut.length + prix.length + 1 > CONFIG.largeur) {
      const w = wrap(debut, CONFIG.largeur - prix.length - 1).split('\n');
      w.slice(0, -1).forEach(ln => s += ln + '\n');
      s += ligneGD(w.at(-1), prix) + '\n';
    } else { s += ligneGD(debut, prix) + '\n'; }
    // Options du plat (Riz/Spicy, Sans X, suppléments, sauces) — une par ligne dessous
    (l.details || []).forEach(d => { s += '   > ' + A(d) + '\n'; });
  });
  s += separateur('-') + '\n' + CMD.boldOn + CMD.largeOn;
  s += ligneGD('TOTAL', Number(total).toFixed(2).replace('.', ',') + ' EUR', Math.floor(CONFIG.largeur / 2)) + '\n';
  s += CMD.largeOff + CMD.boldOff;
  // 🛵 En livraison, rien n'est encaissé au comptoir → on n'affiche pas de règlement
  if (!masquerReglement) {
    const modeLbl = modePaiement === 'carte' ? 'Carte bancaire'
                  : modePaiement === 'especes' ? 'Especes'
                  : modePaiement === 'comptoir' ? 'A regler au comptoir'
                  : modePaiement === 'plateforme' ? 'Paye en ligne' : (modePaiement || '');
    s += ligneGD('Reglement', modeLbl) + '\n';
  }

  // ---- Ventilation TVA (pour les clients qui demandent un justificatif) ----
  if (tva) {
    const eur = (n) => Number(n || 0).toFixed(2).replace('.', ',');
    s += separateur('-') + '\n' + CMD.boldOn + 'DETAIL TVA\n' + CMD.boldOff;
    // Colonnes : Taux(9) | Base HT(11) | TVA(10) | Total TTC(12) = 42
    s += 'Taux'.padEnd(9) + 'Base HT'.padStart(11) + 'TVA'.padStart(10) + 'Total TTC'.padStart(12) + '\n';
    s += (String(tva.taux).replace('.', ',') + ' %').padEnd(9)
       + eur(tva.ht).padStart(11)
       + eur(tva.montant).padStart(10)
       + eur(tva.ttc != null ? tva.ttc : total).padStart(12) + '\n';
  }

  // ---- Mentions légales ----
  const legal = [];
  if (tvaNum) legal.push('TVA intracom : ' + tvaNum);
  if (siret)  legal.push('SIRET : ' + siret);
  if (naf)    legal.push('NAF/APE : ' + naf);
  if (legal.length) {
    s += separateur('-') + '\n';
    legal.forEach(l => { s += l + '\n'; });
  }

  s += CMD.feed(2) + CMD.alignCenter;
  s += 'Merci de votre visite !\n';
  s += 'A tres bientot chez ' + A(restoNom || 'Gin Khao') + '\n' + CMD.feed(5) + CMD.cut;
  return s;
}

// ✨ TICKET BORNE CLIENT — Numéro GÉANT à récupérer
function genererTicketBorneClientEscPos(data) {
  const { numero, date, lignes, total, modePaiement, modeService, restoNom, clientNom } = data;
  const A = versAscii;
  let s = CMD.init;

  // En-tête
  s += CMD.alignCenter + CMD.doubleOn + A(restoNom || 'Gin Khao') + '\n' + CMD.doubleOff;
  s += 'Street Food Thai\n' + CMD.feed(1);

  // Mode service
  if (modeService) {
    const icone = modeService === 'sur_place' ? 'SUR PLACE' : 'A EMPORTER';
    s += CMD.boldOn + '[' + icone + ']\n' + CMD.boldOff;
  }

  // Numéro de commande GÉANT
  s += CMD.feed(1) + separateur('=') + '\n';
  s += CMD.alignCenter + 'VOTRE NUMERO\n' + CMD.feed(1);
  s += CMD.tripleOn + '#' + numero + '\n' + CMD.tripleOff;
  s += separateur('=') + '\n' + CMD.feed(1);

  // Date et client
  s += CMD.alignLeft;
  if (clientNom) {
    s += CMD.boldOn + 'Client : ' + A(clientNom) + '\n' + CMD.boldOff;
  }
  s += 'Date : ' + A(date || new Date().toLocaleString('fr-FR')) + '\n';
  s += separateur('-') + '\n';

  // Détail des plats
  lignes.forEach(l => {
    const qte = l.quantite || 1;
    const nom = A(l.nom_produit || l.nom);
    const st = Number(l.sous_total != null ? l.sous_total : (l.prix_unitaire != null ? l.prix_unitaire : l.prix || 0) * qte);
    const prix = Math.abs(st).toFixed(2).replace('.', ',') + ' EUR';
    const debut = qte + 'x ' + nom;
    if (debut.length + prix.length + 1 > CONFIG.largeur) {
      const w = wrap(debut, CONFIG.largeur - prix.length - 1).split('\n');
      w.slice(0, -1).forEach(ln => s += ln + '\n');
      s += ligneGD(w.at(-1), prix) + '\n';
    } else { s += ligneGD(debut, prix) + '\n'; }
  });

  // Total
  s += separateur('-') + '\n' + CMD.boldOn + CMD.largeOn;
  s += ligneGD('TOTAL', Number(total).toFixed(2).replace('.', ',') + ' EUR', Math.floor(CONFIG.largeur / 2)) + '\n';
  s += CMD.largeOff + CMD.boldOff;

  // Instructions selon mode de paiement
  s += CMD.feed(1) + CMD.alignCenter;
  if (modePaiement === 'comptoir') {
    s += CMD.boldOn + '*** A REGLER AU COMPTOIR ***\n' + CMD.boldOff;
    s += 'Presentez ce ticket au comptoir\n';
    s += 'pour regler votre commande.\n';
  } else if (modePaiement === 'carte') {
    s += CMD.boldOn + '*** PAIEMENT VALIDE ***\n' + CMD.boldOff;
    s += 'Patientez, nous preparons\n';
    s += 'votre commande.\n';
    s += 'Vous serez appele(e) par votre numero.\n';
  }

  s += CMD.feed(2) + 'Merci pour votre commande !\n';
  s += CMD.feed(5) + CMD.cut;
  return s;
}

function envoyerVersImprimante(imprimante, donneesEscPos) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let resolved = false;
    client.setTimeout(5000);
    client.connect(imprimante.port, imprimante.ip, () => {
      client.write(donneesEscPos, 'binary', () => {
        setTimeout(() => {
          client.end();
          if (!resolved) { resolved = true; resolve({ ok: true, imprimante: imprimante.nom }); }
        }, 200);
      });
    });
    client.on('timeout', () => {
      client.destroy();
      if (!resolved) { resolved = true; reject(new Error('Imprimante ' + imprimante.nom + ' injoignable (timeout) - vérifie qu\'elle est allumée et sur le bon réseau')); }
    });
    client.on('error', (err) => {
      if (!resolved) { resolved = true; reject(new Error('Erreur ' + imprimante.nom + ' : ' + err.message)); }
    });
  });
}

const serveur = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><head><title>Relais Gin Khao</title>
      <style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:20px;background:#1a1a1a;color:#eee}
      h1{color:#E4B860}.ok{color:#A8E10C}</style></head><body>
      <h1>🖨️ Relais d'impression Gin Khao</h1>
      <p class="ok">✓ Serveur en marche sur le port ${CONFIG.port}</p>
      <h3>Imprimantes :</h3><ul>
      <li><b>Cuisine</b> : ${CONFIG.imprimantes.cuisine.nom} → ${CONFIG.imprimantes.cuisine.ip}</li>
      <li><b>Sushi</b> : ${CONFIG.imprimantes.sushi.nom} → ${CONFIG.imprimantes.sushi.ip}</li>
      <li><b>Comptoir</b> : ${CONFIG.imprimantes.comptoir.nom} → ${CONFIG.imprimantes.comptoir.ip}</li>
      <li><b>Borne</b> : ${CONFIG.imprimantes.borne.nom} → ${CONFIG.imprimantes.borne.ip}</li>
      </ul><p>Tests :
      <a href="/test-cuisine" style="color:#E4B860">cuisine</a> ·
      <a href="/test-sushi" style="color:#E4B860">sushi</a> ·
      <a href="/test-borne" style="color:#E4B860">borne</a>
      </p></body></html>`);
    return;
  }

  if (req.method === 'GET' && req.url === '/test-cuisine') {
    const escpos = genererBonPreparationEscPos({ numero: 'TEST', heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      items: [{ quantite: 1, nom: 'Pad Thai Poulet' }, { quantite: 2, nom: 'Curry Vert Boeuf' }] }, 'BON CUISINE');
    envoyerVersImprimante(CONFIG.imprimantes.cuisine, escpos)
      .then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, message: 'Envoyé à ' + r.imprimante })); })
      .catch(e => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, erreur: e.message })); });
    return;
  }

  if (req.method === 'GET' && req.url === '/test-sushi') {
    const escpos = genererBonPreparationEscPos({ numero: 'TEST', heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      items: [{ quantite: 1, nom: 'California Saumon' }, { quantite: 2, nom: 'Maki Concombre' }] }, 'BON SUSHI');
    envoyerVersImprimante(CONFIG.imprimantes.sushi, escpos)
      .then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, message: 'Envoyé à ' + r.imprimante })); })
      .catch(e => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, erreur: e.message })); });
    return;
  }

  if (req.method === 'GET' && req.url === '/test-borne') {
    const escpos = genererTicketBorneClientEscPos({
      numero: 42,
      date: new Date().toLocaleString('fr-FR'),
      lignes: [
        { quantite: 1, nom: 'Pad Thai Poulet', prix: 12.50, sous_total: 12.50 },
        { quantite: 1, nom: 'Coca Zero', prix: 2.50, sous_total: 2.50 }
      ],
      total: 15.00,
      modePaiement: 'comptoir',
      modeService: 'sur_place',
      restoNom: 'Gin Khao',
      clientNom: 'Dorian'
    });
    envoyerVersImprimante(CONFIG.imprimantes.borne, escpos)
      .then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, message: 'Envoyé à ' + r.imprimante })); })
      .catch(e => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, erreur: e.message })); });
    return;
  }

  if (req.method === 'POST' && req.url === '/imprimer') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const resultats = [];

        if (data.bonCuisine) {
          const escpos = genererBonPreparationEscPos(Object.assign({}, data.bonCuisine, { refBorne: data.refBorne }), 'BON CUISINE');
          try { const r = await envoyerVersImprimante(CONFIG.imprimantes.cuisine, escpos); resultats.push({ type: 'cuisine', ok: true, imprimante: r.imprimante }); }
          catch (e) { resultats.push({ type: 'cuisine', ok: false, erreur: e.message }); }
        }

        if (data.bonSushi) {
          const escpos = genererBonPreparationEscPos(Object.assign({}, data.bonSushi, { refBorne: data.refBorne }), 'BON SUSHI');
          try { const r = await envoyerVersImprimante(CONFIG.imprimantes.sushi, escpos); resultats.push({ type: 'sushi', ok: true, imprimante: r.imprimante }); }
          catch (e) { resultats.push({ type: 'sushi', ok: false, erreur: e.message }); }
        }

        // 🔎 Trace de ce que la caisse envoie (utile pour diagnostiquer)
        console.log('→ Version caisse :', data.version || '⛔ ANCIENNE VERSION (pos.html pas à jour)');
        console.log('→ Impression reçue :',
          [data.bonCuisine && 'cuisine', data.bonSushi && 'sushi',
           data.bonLivraison && 'LIVRAISON', data.ticketClient && 'client',
           data.ticketBorne && 'borne'].filter(Boolean).join(' + ') || '(rien)');
        if (data.bonCuisine) {
          console.log('   Bon cuisine →', JSON.stringify(
            (data.bonCuisine.items || []).map(i => ({ nom: i.nom, details: i.details }))));
        }
        if (data.bonLivraison) {
          console.log('   Bon livreur → paiement:', data.bonLivraison.modePaiement,
                      '| appoint:', JSON.stringify(data.bonLivraison.appoint),
                      '| frais:', data.bonLivraison.fraisLivraison);
        }

        // 📦 Bon de livraison (livreur) → comptoir
        if (data.bonLivraison) {
          const escpos = genererBonLivraisonEscPos(data.bonLivraison);
          try { const r = await envoyerVersImprimante(CONFIG.imprimantes.comptoir, escpos); resultats.push({ type: 'livraison', ok: true, imprimante: r.imprimante }); }
          catch (e) { resultats.push({ type: 'livraison', ok: false, erreur: e.message }); }
        }

        // 🔒 Ticket Z (clôture de journée) → comptoir
        if (data.ticketZ) {
          const escpos = genererTicketZEscPos(data.ticketZ);
          try { const r = await envoyerVersImprimante(CONFIG.imprimantes.comptoir, escpos); resultats.push({ type: 'ticketZ', ok: true, imprimante: r.imprimante }); }
          catch (e) { resultats.push({ type: 'ticketZ', ok: false, erreur: e.message }); }
        }

        if (data.ticketClient) {
          // 🔖 Injecter la référence borne (B###) comme pour les bons cuisine/sushi —
          //    sans ça, le ticket client ne recevait jamais data.refBorne.
          const escpos = genererTicketClientEscPos(Object.assign({}, data.ticketClient, { refBorne: data.refBorne }));
          try { const r = await envoyerVersImprimante(CONFIG.imprimantes.comptoir, escpos); resultats.push({ type: 'client', ok: true, imprimante: r.imprimante }); }
          catch (e) { resultats.push({ type: 'client', ok: false, erreur: e.message }); }
        }

        // ✨ NOUVEAU : Ticket borne client (numéro géant à récupérer)
        if (data.ticketBorne) {
          const escpos = genererTicketBorneClientEscPos(data.ticketBorne);
          try { const r = await envoyerVersImprimante(CONFIG.imprimantes.borne, escpos); resultats.push({ type: 'borne', ok: true, imprimante: r.imprimante }); }
          catch (e) { resultats.push({ type: 'borne', ok: false, erreur: e.message }); }
        }

        const toutOK = resultats.length > 0 && resultats.every(r => r.ok);
        res.writeHead(toutOK ? 200 : 207, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: toutOK, resultats }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erreur: 'Requête invalide : ' + e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, erreur: 'Route inconnue' }));
});

serveur.listen(CONFIG.port, () => {
  console.log('\n=================================================');
  console.log('   RELAIS D\'IMPRESSION GIN KHAO');
  console.log('=================================================\n');
  console.log('  Serveur en marche sur : http://localhost:' + CONFIG.port + '\n');
  console.log('  Imprimantes configurées :');
  console.log('   - Cuisine   : ' + CONFIG.imprimantes.cuisine.nom + ' → ' + CONFIG.imprimantes.cuisine.ip);
  console.log('   - Sushi     : ' + CONFIG.imprimantes.sushi.nom + ' → ' + CONFIG.imprimantes.sushi.ip);
  console.log('   - Comptoir  : ' + CONFIG.imprimantes.comptoir.nom + ' → ' + CONFIG.imprimantes.comptoir.ip);
  console.log('   - Borne     : ' + CONFIG.imprimantes.borne.nom + ' → ' + CONFIG.imprimantes.borne.ip);
  console.log('\n  Pour arrêter : Ctrl+C');
  console.log('=================================================\n');
});
