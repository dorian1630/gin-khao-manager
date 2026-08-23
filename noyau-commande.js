/* ============================================================
 * NOYAU COMMANDE — Gin Khao                          v1.0
 * ------------------------------------------------------------
 * SOURCE UNIQUE DE VÉRITÉ pour :
 *   - le routage cuisine / sushi / comptoir
 *   - les détails imprimés sous chaque plat
 *   - la construction des bons et du ticket client
 *
 * Chargé par pos.html ET borne.html :
 *     <script src="noyau-commande.js"></script>
 *
 * ⚠️ RÈGLE D'OR : aucune fonction ici ne cherche une ligne par son NOM
 *    ni par son produit_id. Tout passe par ligne_uid. C'est ce qui
 *    évitait de mélanger deux plats identiques aux options différentes.
 * ============================================================ */
(function (global) {
  'use strict';

  // ============================================================
  //  CATALOGUE (injecté au démarrage)
  // ============================================================
  var CAT = { produits: [], categories: [] };

  function init(opts) {
    CAT.produits = (opts && opts.produits) || [];
    CAT.categories = (opts && opts.categories) || [];
  }

  function produit(id) {
    if (!id) return null;
    for (var i = 0; i < CAT.produits.length; i++) if (CAT.produits[i].id === id) return CAT.produits[i];
    return null;
  }
  function categorie(id) {
    if (!id) return null;
    for (var i = 0; i < CAT.categories.length; i++) if (CAT.categories[i].id === id) return CAT.categories[i];
    return null;
  }

  // Minuscules + accents retirés : "Formule Pokébowl" -> "formule pokebowl"
  function norm(s) {
    return (s == null ? '' : String(s)).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  // ============================================================
  //  ROUTAGE
  // ============================================================
  // Priorité 1 : colonne categories.station si elle existe en base.
  // Priorité 2 : repli par motifs — IDENTIQUE pour la caisse et la borne,
  //              c'est précisément ce qui divergeait avant.
  // Motifs par INCLUSION (pas égalité) + test de la catégorie parente :
  //   "Formule Pokébowl" -> sushi   (contient "poke")
  //   "Makis" (parent Sushi) -> sushi
  var MOTIFS_SUSHI = ['sushi', 'maki', 'california', 'crispy', 'tiger', 'poke'];
  // ⚠️ Comptoir = correspondance EXACTE, surtout pas par inclusion :
  //    la catégorie "Riz en sauce" contient le mot "sauce" et partirait au
  //    comptoir alors que c'est un plat que la cuisine prépare.
  // ⚠️ "Suppléments" n'y figure PAS : un supplément vendu seul (Suppl. Poulet)
  //    doit être cuisiné, il sort donc sur le bon cuisine.
  var RE_COMPTOIR = /^(boissons?|desserts?|sauces?|extras?)$/;

  function stationCategorie(catId) {
    var cat = categorie(catId);
    if (!cat) return 'cuisine';
    if (cat.station) return cat.station;
    var parent = cat.parent_id ? categorie(cat.parent_id) : null;
    if (parent && parent.station) return parent.station;

    var noms = [norm(cat.nom), parent ? norm(parent.nom) : ''];
    for (var i = 0; i < noms.length; i++) {
      if (!noms[i]) continue;
      for (var s = 0; s < MOTIFS_SUSHI.length; s++) if (noms[i].indexOf(MOTIFS_SUSHI[s]) !== -1) return 'sushi';
      if (RE_COMPTOIR.test(noms[i])) return 'comptoir';
    }
    return 'cuisine';
  }

  // Une sous-ligne "item de formule" (entrée choisie) est un ARTICLE À PART
  // ENTIÈRE pour la cuisine : elle suit sa propre catégorie.
  // Les autres sous-lignes (supplément, sauce, composant de box) appartiennent
  // au plat : elles sont reprises dans ses détails et ne sortent pas seules.
  function stationPourLigne(ligne, parent) {
    var l = normaliser(ligne);
    if (!l) return 'comptoir';
    if (!l.produit_id) return 'comptoir';        // remise, frais, fidélité
    if (l.lien_plat && !estEntreeDeFormule(l, parent)) return 'comptoir';
    return stationCategorie(l.categorie_id);
  }

  function estEntreeDeFormule(l, parent) {
    if (!l || !l.lien_plat) return false;
    var p = normaliser(parent);
    if (p && p.formule_entree_id) return p.formule_entree_id === l.produit_id;
    // Repli : la boisson est exclue, le reste des items "(formule)" compte
    if (p && p.formule_boisson_id === l.produit_id) return false;
    return /\(formule\)/i.test(l.nom || '') &&
           stationCategorie(l.categorie_id) !== 'comptoir';
  }

  // ============================================================
  //  NORMALISATION — accepte le format caisse ET le format borne
  // ============================================================
  //   caisse : options_base / retirables / supplements_sel / sauces_sel
  //   borne  : options:{ options_base, retirable, supplements, sauces }
  function normaliser(l) {
    if (!l) return null;
    if (l.__nc) return l;
    var o = l.options || {};
    var p = produit(l.produit_id);
    return {
      __nc: true,
      ligne_uid: l.ligne_uid || null,
      lien_plat: l.lien_plat || null,
      produit_id: l.produit_id || null,
      nom: l.nom || (p ? p.nom : ''),
      prix: Number(l.prix) || 0,
      quantite: Number(l.quantite) || 1,
      categorie_id: l.categorie_id || (p ? p.categorie_id : null),
      variante: l.variante || null,
      options_base: l.options_base || o.options_base || {},
      retirables: l.retirables || o.retirable || o.retirables || [],
      supplements_sel: l.supplements_sel || o.supplements || [],
      sauces_sel: l.sauces_sel || o.sauces || [],
      details_precalcules: Array.isArray(l.details) ? l.details : null,
      est_formule: !!(l.est_formule || (p && p.est_formule)),
      formule_boisson_id: l.formule_boisson_id || null,
      formule_entree_id: l.formule_entree_id || null,
      formule_entree_label: l.formule_entree_label || null,
      recompense: l.recompense || null
    };
  }

  // ============================================================
  //  HELPERS MENU
  // ============================================================
  function composantsFixes(p) {
    if (!p || !Array.isArray(p.formule_etapes)) return [];
    return p.formule_etapes.filter(function (c) {
      return c && c.produit_id && (c.type === 'fixe' || c.fixe === true);
    });
  }

  function grouperIds(arr) {
    var out = [];
    (arr || []).forEach(function (id) {
      var e = null;
      for (var i = 0; i < out.length; i++) if (out[i].id === id) { e = out[i]; break; }
      if (e) e.qte++; else out.push({ id: id, qte: 1 });
    });
    return out;
  }

  function labelVariante(v) {
    if (!v) return '';
    if (v.label) return v.label;
    if (v.pieces !== undefined && v.pieces !== null) {
      return v.pieces + SUFFIXE_PIECES;   // même unité que les entrées de formule
    }
    return '';
  }

  // Boisson de formule : incluse si ≤ 1,50 €, sinon +1 € de supplément.
  var SUPPLEMENT_BOISSON = 1;
  var PRIX_BOISSON_INCLUSE_MAX = 1.50;
  function prixBoissonFormule(b) {
    if (!b) return 0;
    return (parseFloat(b.prix) || 0) <= PRIX_BOISSON_INCLUSE_MAX ? 0 : SUPPLEMENT_BOISSON;
  }

  // ============================================================
  //  NOMBRE DE PIÈCES DES ENTRÉES  ->  "Nems Poulet (4 pcs)"
  // ============================================================
  // La cuisine doit savoir combien de pièces sortir. Le libellé transmis le
  // contient déjà quand l'entrée a été choisie à l'écran, mais il se perd sur
  // les commandes borne et l'ajout direct : on le recalcule depuis les variantes.
  var SUFFIXE_PIECES = ' pcs';   // mettre ' pieces' pour la forme longue
  var PIECES_FORMULE = 2;        // une formule inclut TOUJOURS 2 pièces
  var RE_PIECES = /\(\s*\d+\s*(?:pcs?|pi[e\u00e8]ces?)\s*\)/i;

  function labelPieces(n) { return '(' + n + SUFFIXE_PIECES + ')'; }

  // "Suppl. Poulet riz" -> "Poulet" : la cuisine veut l'ingrédient, pas le
  // libellé commercial ni l'accompagnement (déjà connu par le plat).
  function nomSupplement(p) {
    return String((p && p.nom) || '')
      .replace(/^suppl?\.?\s*/i, '')
      .replace(/\s+(riz|nouilles?)\s*$/i, '')
      .trim();
  }

  // Nombre de pièces d'une variante, quel que soit le format en base :
  //   {prix, pieces: 2}            -> 2
  //   {prix, label: "4 pièces"}    -> 4     (cas des Tempura)
  function piecesDeVariante(v) {
    if (!v) return null;
    if (v.pieces != null) return Number(v.pieces);
    var m = String(v.label || '').match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // Portion incluse dans une formule :
  //   - 2 pièces si l'entrée en propose (Nems, Samoussa, Brochettes)
  //   - sinon sa portion réelle       (Tempura : n'existe qu'en 4)
  //   - null si l'article n'est pas à la pièce (Riz Blanc, Dynamite)
  function piecesFormule(p) {
    if (!p) return null;
    // 🎯 pieces_formule (colonne produit) : portion en formule SANS créer de
    //    variante à la carte (ex. Tempura : carte = 4 pièces, formule = 2).
    if (p.pieces_formule != null && Number(p.pieces_formule) > 0)
      return Number(p.pieces_formule);
    if (!Array.isArray(p.variantes) || !p.variantes.length) return null;
    var dispo = [];
    for (var i = 0; i < p.variantes.length; i++) {
      var n = piecesDeVariante(p.variantes[i]);
      if (n != null) dispo.push(n);
    }
    if (!dispo.length) return null;
    return dispo.indexOf(PIECES_FORMULE) !== -1 ? PIECES_FORMULE : dispo[0];
  }

  // Une entrée est-elle proposable en formule ?
  //   visible_formule = false  -> exclue (Tempura)
  //   actif = false            -> exclue
  function entreeAutoriseeEnFormule(p) {
    return !!p && p.actif !== false && p.visible_formule !== false;
  }

  // Liste unique des entrées proposables en formule, avec leur libellé final.
  // Utilisée par la caisse ET la borne : les deux proposent donc exactement
  // les mêmes choix (avant, une modale de la caisse proposait les Tempura).
  function entreesFormule() {
    var catEntrees = null;
    for (var i = 0; i < CAT.categories.length; i++) {
      if (norm(CAT.categories[i].nom) === 'entrees') { catEntrees = CAT.categories[i]; break; }
    }
    if (!catEntrees) return [];
    return CAT.produits
      .filter(function (p) { return p.categorie_id === catEntrees.id && entreeAutoriseeEnFormule(p); })
      .map(function (p) { return { id: p.id, label: labelEntreeFormule(p.id, null) }; });
  }

  // Libellé d'une entrée DANS UNE FORMULE.
  // Hors formule, la portion vient de la variante choisie (cf. labelVariante).
  function labelEntreeFormule(produitId, labelFourni) {
    var p = produit(produitId);
    var base = labelFourni || (p ? p.nom : '');
    if (!base) return '';
    var n = piecesFormule(p);
    if (n == null) return base.replace(RE_PIECES, '').replace(/\s+/g, ' ').trim();
    if (RE_PIECES.test(base)) {
      return base.replace(RE_PIECES, labelPieces(n)).replace(/\s+/g, ' ').trim();
    }
    return base + ' ' + labelPieces(n);
  }

  // ============================================================
  //  ACCOMPAGNEMENT (Riz / Nouilles) — collé au nom sur le bon cuisine
  // ============================================================
  function accompagnementDe(ligne) {
    var l = normaliser(ligne);
    var ob = l && l.options_base;
    if (!ob) return null;
    // 1) Groupe explicitement nommé "Féculent" (structure actuelle du menu)
    for (var k in ob) {
      if (!Object.prototype.hasOwnProperty.call(ob, k)) continue;
      if (norm(k) === 'feculent' && ob[k]) return String(ob[k]).trim();
    }
    // 2) Repli : une valeur qui EST un féculent, quel que soit le nom du groupe
    var vals = Object.keys(ob).map(function (kk) { return ob[kk]; });
    for (var i = 0; i < vals.length; i++) {
      if (/^(riz|nouilles?)\b/i.test(String(vals[i] || '').trim())) return String(vals[i]).trim();
    }
    return null;
  }

  // ============================================================
  //  DÉTAILS D'UNE LIGNE
  // ============================================================
  //  'cuisine'  : tout ce qui sert à PRÉPARER le plat.
  //               L'accompagnement n'y figure pas : il est déjà dans le nom.
  //  'comptoir' : tout ce qui sert à VÉRIFIER la commande, sans répéter
  //               ce qui est déjà facturé sur une ligne à part.
  //
  //  Exception CROUSTY KHAO : ses sauces font partie de la préparation,
  //  elles montent donc aussi sur le bon cuisine.
  var MOTIF_SAUCES_EN_CUISINE = /crousty/i;

  function detailsLigne(ligne, pour) {
    var l = normaliser(ligne);
    var d = [];
    if (!l) return d;
    var p = produit(l.produit_id);
    var acc = accompagnementDe(l);

    // --- Options de base (Féculent, Niveau épicé, Sauce Riz…) ---
    var ob = l.options_base || {};
    Object.keys(ob).forEach(function (k) {
      var v = ob[k];
      if (!v) return;
      // L'accompagnement est déjà collé au nom du plat en cuisine
      if (pour === 'cuisine' && acc && String(v).trim() === acc) return;
      // "Normal" = préparation habituelle → inutile de l'écrire
      if (/^normal$/i.test(String(v).trim())) return;
      d.push(String(v));
    });

    // --- Ingrédients retirés ---
    (l.retirables || []).forEach(function (r) { d.push('Sans ' + r); });

    // --- Suppléments : facturés à part au comptoir, donc détail cuisine seulement ---
    if (pour === 'cuisine') {
      grouperIds(l.supplements_sel).forEach(function (g) {
        var sp = produit(g.id);
        if (sp) d.push('+ ' + nomSupplement(sp) + (g.qte > 1 ? ' x' + g.qte : ''));
      });
    }

    // --- Sauces ---
    var saucesEnCuisine = MOTIF_SAUCES_EN_CUISINE.test(l.nom || '');
    if (pour !== 'cuisine' || saucesEnCuisine) {
      (l.sauces_sel || []).forEach(function (id) {
        var sc = produit(id);
        if (!sc) return;
        var facturee = p && !p.sauces_incluses && parseFloat(sc.prix) > 0;
        if (pour === 'comptoir' && facturee) return;   // a déjà sa ligne avec son prix
        d.push(sc.nom.replace(/^Sauce\s+/i, 'Sauce '));
      });
    }

    // --- Contenu d'une box (composants fixes) : pas de quantité, composition connue ---
    composantsFixes(p).forEach(function (c) {
      var prod = produit(c.produit_id);
      d.push(c.label || (prod ? prod.nom : 'Composant'));
    });

    // --- Entrée / boisson de formule : JAMAIS en détail ---
    //  L'entrée sort en LIGNE À PART, en gros, sur l'imprimante de SA propre
    //  catégorie (des nems dans une formule Pokébowl vont en cuisine pendant
    //  que le pokébowl part au sushi). Le cuisinier n'a pas à savoir qu'il
    //  s'agit d'une formule : il voit "1 NEMS POULET (2 PCS)".
    //  La boisson, elle, reste au comptoir.
    //  Ne figure ici que ce qui APPARTIENT AU PLAT : options, sans X,
    //  suppléments, sauces.

    return d.filter(Boolean);
  }

  // Nom tel qu'il doit apparaître sur le bon de préparation :
  //  - accompagnement collé devant (RIZ / NOUILLES)
  //  - mentions "(formule)/(box)" retirées : le cuisinier n'a pas à le savoir
  //  - nombre de pièces de la variante ajouté (le sushi doit savoir 6 ou 12)
  function nomPourPreparation(ligne) {
    var l = normaliser(ligne);
    if (!l) return '';
    var base = String(l.nom || '')
      .replace(/^\s*[↳>]\s*/, '')
      .replace(/\s*\((?:formule|box|supplément|supplement)\)\s*$/i, '')
      .trim();
    var acc = accompagnementDe(l);
    // ⚠️ IDEMPOTENT : si l'appelant a déjà collé l'accompagnement au nom
    //    (ancien code de la caisse), ne pas le recoller → "Riz Riz Bœuf…".
    var dejaColle = acc && norm(base).indexOf(norm(acc) + ' ') === 0;
    var nom = (acc && !l.lien_plat && !dejaColle) ? acc + ' ' + base : base;
    // Le nombre de pièces des sushis est écrit DANS LE NOM ("... (6 pièces)")
    // et les variantes sont vides : on le préserve tel quel, on ne force jamais
    // un nombre (un "Sushi Saumon (4 pièces)" existe). On ne le complète depuis
    // la variante que si le nom n'en porte pas ET qu'une variante le précise.
    if (!RE_PIECES.test(nom) && l.variante) {
      var np = piecesDeVariante(l.variante);
      if (np) nom += ' ' + labelPieces(np);
    }
    return nom;
  }

  // Au poste SUSHI, chaque portion se roule individuellement : on éclate donc
  // "2 MAKIS SAUMON (6 PCS)" en deux lignes "1 MAKIS SAUMON (6 PCS)".
  // Regrouper obligeait le sushi à compter, et "2 ... (6 PCS)" se lit mal.
  var STATIONS_ECLATEES = ['sushi'];

  function eclaterPortions(items, station) {
    if (STATIONS_ECLATEES.indexOf(station) === -1) return items;
    var out = [];
    items.forEach(function (it) {
      var n = Number(it.quantite) || 1;
      for (var i = 0; i < n; i++) {
        var copie = {};
        for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) copie[k] = it[k];
        copie.quantite = 1;
        copie.ligne_uid = it.ligne_uid ? (it.ligne_uid + '#' + (i + 1)) : null;
        out.push(copie);
      }
    });
    return out;
  }

  // ============================================================
  //  CONSTRUCTION DES BONS + DU TICKET CLIENT
  // ============================================================
  // lignes : le panier complet (caisse ou borne), sous-lignes incluses.
  // meta   : { numero, date, caissier, modeService, refBorne, total, modePaiement }
  //
  // Retourne exactement la charge utile attendue par les relais d'impression.
  function construireImpression(lignes, meta) {
    meta = meta || {};
    var norms = (lignes || []).map(normaliser).filter(Boolean);

    // Index parent pour savoir à quel plat se rattache une sous-ligne
    var parUid = {};
    norms.forEach(function (l) { if (l.ligne_uid) parUid[l.ligne_uid] = l; });
    function parentDe(l) { return l.lien_plat ? parUid[l.lien_plat] : null; }

    // --- Bons de préparation ---
    //  Chaque article préparé = UNE ligne en gros. Les entrées de formule y
    //  figurent comme n'importe quel article, sur l'imprimante de leur propre
    //  catégorie. Les suppléments/sauces restent en détails sous leur plat.
    function itemsPour(station) {
      var items = norms
        .filter(function (l) { return stationPourLigne(l, parentDe(l)) === station; })
        .map(function (l) {
          var parent = parentDe(l);
          if (estEntreeDeFormule(l, parent)) {
            return {
              ligne_uid: l.ligne_uid,
              quantite: l.quantite,
              nom: labelEntreeFormule(l.produit_id,
                     (parent && parent.formule_entree_label) || null),
              details: []
            };
          }
          // Détails recalculés depuis les données brutes ; si la ligne vient de
          // la base (réimpression : plus d'options_base), repli sur les détails
          // stockés — sinon les bons de réimpression sortiraient nus.
          var dets = detailsLigne(l, 'cuisine');
          if (!dets.length && l.details_precalcules && l.details_precalcules.length) {
            dets = l.details_precalcules;
          }
          return {
            ligne_uid: l.ligne_uid,
            quantite: l.quantite,
            nom: nomPourPreparation(l),
            details: dets
          };
        });
      return eclaterPortions(items, station);
    }

    var itemsCuisine = itemsPour('cuisine');
    var itemsSushi = itemsPour('sushi');

    // --- 🛵 Checklist LIVREUR : tout ce qui part physiquement dans le sac ---
    //  Boissons et desserts n'ont AUCUN bon de préparation (station comptoir),
    //  mais le livreur doit les compter. Règles :
    //   · ligne principale (plat, boisson, dessert, box) → 1 entrée
    //   · entrée de formule → 1 entrée (avec ses pièces)
    //   · boisson de formule → 1 entrée (le client doit recevoir sa canette)
    //   · suppléments / sauces / composants box → DANS le plat → rien
    //   · remises (prix < 0) et lignes sans produit (frais, infos) → rien
    var itemsLivraison = [];
    norms.forEach(function (l) {
      if (!l.produit_id) return;
      if ((Number(l.prix) || 0) < 0) return;
      var parent = parentDe(l);
      if (!l.lien_plat) {
        itemsLivraison.push({ quantite: l.quantite || 1,
                              nom: nomPourPreparation(l), details: [] });
      } else if (estEntreeDeFormule(l, parent)) {
        itemsLivraison.push({ quantite: l.quantite || 1,
          nom: labelEntreeFormule(l.produit_id,
                 (parent && parent.formule_entree_label) || null),
          details: [] });
      } else if (parent && parent.formule_boisson_id === l.produit_id) {
        itemsLivraison.push({ quantite: l.quantite || 1,
          nom: String(l.nom || '').replace(/^\s*↳\s*/, '')
                                  .replace(/\s*\(formule\)\s*$/i, ''),
          details: [] });
      }
    });

    function bon(items, poste) {
      if (!items.length) return null;
      return {
        numero: meta.numero,
        heure: meta.heure || null,
        date: meta.date || null,
        poste: poste,
        caissier: meta.caissier || null,
        modeService: meta.modeService || null,
        items: items
      };
    }

    // --- Ticket client : tout, avec les prix ---
    //  Les inclus à 0 € se répartissent en deux familles :
    //    - boisson / entrée de FORMULE  -> ligne à part (le client veut les voir)
    //    - composants d'une BOX         -> masqués, déjà listés en détails du plat
    // Le nom des sous-lignes "entrée de formule" doit aussi porter le nb de pièces
    function nomLigneClient(l) {
      if (!l.lien_plat) return l.nom;
      var parent = parentDe(l);
      if (parent && parent.formule_entree_id === l.produit_id) {
        var pref = (l.nom.match(/^\s*[↳>]\s*/) || [''])[0];
        var suff = /\((?:formule|box)\)\s*$/i.test(l.nom) ? ' (formule)' : '';
        return pref + labelEntreeFormule(l.produit_id, parent.formule_entree_label) + suff;
      }
      return l.nom;
    }

    function estItemFormule(l) {
      if (!l.lien_plat) return false;
      var parent = parentDe(l);
      if (parent && ((parent.formule_boisson_id && parent.formule_boisson_id === l.produit_id) ||
                     (parent.formule_entree_id && parent.formule_entree_id === l.produit_id))) return true;
      return /\(formule\)/i.test(l.nom || '');
    }

    var lignesClient = norms
      .filter(function (l) { return !(l.lien_plat && l.prix === 0 && !estItemFormule(l)); })
      .map(function (l) {
        var inclus = l.lien_plat && l.prix === 0;
        return {
          ligne_uid: l.ligne_uid,
          nom_produit: nomLigneClient(l),
          nom: nomLigneClient(l),
          prix: l.prix,
          prix_unitaire: l.prix,
          quantite: l.quantite,
          sous_total: Math.round(l.prix * l.quantite * 100) / 100,
          lien_plat: l.lien_plat,
          inclus: !!inclus,          // le relais peut écrire "INCLUS" au lieu de 0,00 EUR
          est_boisson: stationCategorie(l.categorie_id) === 'comptoir' && !l.lien_plat,
          details: detailsLigne(l, 'comptoir')
        };
      });

    return {
      version: 'noyau-1.0',
      refBorne: meta.refBorne || null,
      itemsLivraison: itemsLivraison,
      bonCuisine: bon(itemsCuisine, 'cuisine'),
      bonSushi: bon(itemsSushi, 'sushi'),
      ticketClient: {
        numero: meta.numero,
        date: meta.date || null,
        lignes: lignesClient,
        total: meta.total,
        modePaiement: meta.modePaiement || null,
        modeService: meta.modeService || null
      }
    };
  }

  // ============================================================
  //  MANIPULATION DU PANIER — indexée par ligne_uid, jamais par nom
  // ============================================================
  function genUid() {
    return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function ligneParUid(panier, uid) {
    for (var i = 0; i < (panier || []).length; i++) if (panier[i].ligne_uid === uid) return panier[i];
    return null;
  }

  // Deux lignes fusionnent uniquement si elles sont STRICTEMENT identiques.
  // Sans ça, taper "Coca" alors qu'une formule contient déjà un Coca à 0 €
  // incrémentait la sous-ligne gratuite → deuxième Coca offert.
  function memeLigne(l, p) {
    var n = normaliser(l);
    return n.produit_id === p.id
      && !n.lien_plat
      && !n.variante
      && !n.est_formule
      && !l.remise_ligne
      && Object.keys(n.options_base || {}).length === 0
      && (n.retirables || []).length === 0
      && (n.supplements_sel || []).length === 0
      && (n.sauces_sel || []).length === 0
      && Number(n.prix) === parseFloat(p.prix);
  }

  // Retire une ligne ET toutes ses sous-lignes (sinon suppléments orphelins facturés)
  function retirerLigne(panier, uid) {
    return (panier || []).filter(function (l) {
      return l.ligne_uid !== uid && l.lien_plat !== uid;
    });
  }

  // ============================================================
  //  EXPORT
  // ============================================================
  global.NC = {
    init: init,
    // routage
    stationPourLigne: stationPourLigne,
    stationCategorie: stationCategorie,
    // contenu
    normaliser: normaliser,
    accompagnementDe: accompagnementDe,
    detailsLigne: detailsLigne,
    nomPourPreparation: nomPourPreparation,
    // impression
    construireImpression: construireImpression,
    // panier
    genUid: genUid,
    ligneParUid: ligneParUid,
    memeLigne: memeLigne,
    retirerLigne: retirerLigne,
    // utilitaires exposés (utilisés par pos.html / borne.html)
    composantsFixes: composantsFixes,
    grouperIds: grouperIds,
    labelVariante: labelVariante,
    labelEntreeFormule: labelEntreeFormule,
    labelPieces: labelPieces,
    piecesFormule: piecesFormule,
    entreesFormule: entreesFormule,
    entreeAutoriseeEnFormule: entreeAutoriseeEnFormule,
    prixBoissonFormule: prixBoissonFormule,
    _catalogue: CAT
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.NC;
})(typeof window !== 'undefined' ? window : globalThis);
