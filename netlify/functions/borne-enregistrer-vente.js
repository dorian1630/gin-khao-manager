// netlify/functions/borne-enregistrer-vente.js
// ============================================================
// Enregistrer une vente depuis la borne — v3 « serrure du coffre »
// ============================================================
// La borne utilise la clé anon publique (lecture seule).
// Pour ENREGISTRER une vente, on passe par cette function (service_role).
//
// v2 : carte → 'validé' immédiat · comptoir → Option B (pas de vente ici)
//
// v3 (audit n°24/25) — TROIS verrous sur le chemin CARTE :
//   🔐 1. VÉRITÉ SUMUP : on interroge l'API SumUp elle-même (jamais notre
//         miroir paiements_sumup, falsifiable via le webhook public) :
//         la transaction doit être SUCCESSFUL **et du bon montant**.
//   💶 2. RECALCUL DES PRIX : chaque ligne est confrontée à la base —
//         prix autorisés = prix du produit ∪ prix de ses variantes
//         ∪ {0 €, 1 €} pour les sous-lignes (inclus formule / boisson +1).
//         La règle n°1 du contrat borne, enfin réalisée.
//   🎫 3. ANTI-DOUBLE : le ctid ne peut enregistrer qu'UNE vente
//         (claim atomique de paiements_sumup.vente_id, NULL requis).
//
// Variables d'environnement requises :
//   SUPABASE_URL (facultative, secours intégré)
//   SUPABASE_SERVICE_KEY
//   SUMUP_API_KEY, SUMUP_MERCHANT_CODE   (chemin carte)
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResp(405, { ok: false, erreur: 'Method not allowed' });
  }

  const SUPA_URL = process.env.SUPABASE_URL || 'https://szpgbdnijyoquqmjhhjj.supabase.co';
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_KEY) {
    return jsonResp(500, { ok: false, erreur: 'SUPABASE_SERVICE_KEY manquante' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, erreur: 'JSON invalide' }); }

  const restaurantId = body.restaurant_id;
  const modePaiement = body.mode_paiement;
  const lignes = body.lignes;
  const modeService = body.mode_service || 'sur_place';
  const clientId = body.client_id || null;
  const ctid = body.client_transaction_id || null;   // 🎫 v3
  // 👋 Prénom du client fidélité (pour l'en-tête du ticket)
  let clientPrenom = null;
  if (typeof body.client_prenom === 'string') {
    clientPrenom = body.client_prenom.replace(/[^\p{L}\s'-]/gu, '').trim().slice(0, 20) || null;
  }

  // Validation basique
  if (!restaurantId) return jsonResp(400, { ok: false, erreur: 'restaurant_id manquant' });
  if (!modePaiement) return jsonResp(400, { ok: false, erreur: 'mode_paiement manquant' });
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return jsonResp(400, { ok: false, erreur: 'lignes manquantes' });
  }
  if (!['comptoir', 'carte'].includes(modePaiement)) {
    return jsonResp(400, { ok: false, erreur: 'mode_paiement invalide pour la borne' });
  }
  if (lignes.length > 50) {
    return jsonResp(400, { ok: false, erreur: 'Trop de lignes (max 50)' });
  }
  let nbRecompenses = 0;
  for (const l of lignes) {
    if (l.recompense) {
      nbRecompenses++;
      if (nbRecompenses > 1) {
        return jsonResp(400, { ok: false, erreur: 'Une seule récompense par commande' });
      }
      if (l.produit_id !== null || typeof l.prix !== 'number' ||
          l.prix >= 0 || l.prix < -100 || l.quantite !== 1 ||
          ![50, 100, 200, 300].includes(l.recompense)) {
        return jsonResp(400, { ok: false, erreur: 'Ligne récompense invalide' });
      }
      continue;
    }
    if (!l.produit_id || typeof l.prix !== 'number' || typeof l.quantite !== 'number') {
      return jsonResp(400, { ok: false, erreur: 'Ligne invalide' });
    }
    if (l.prix < 0 || l.quantite < 1 || l.quantite > 50) {
      return jsonResp(400, { ok: false, erreur: 'Prix ou quantite invalide' });
    }
  }
  const totalCalc = Math.round(lignes.reduce((s, l) => s + l.prix * l.quantite, 0) * 100) / 100;
  if (totalCalc < 0) {
    return jsonResp(400, { ok: false, erreur: 'Total négatif interdit' });
  }

  const sb = createClient(SUPA_URL, SUPA_KEY);

  // 🅱️ OPTION B — Comptoir : pas de vente ici (la caisse la créera à l'encaissement)
  if (modePaiement === 'comptoir') {
    const numero = 'B' + Math.floor(100 + Math.random() * 900);
    return jsonResp(200, {
      ok: true, vente_id: null, numero: numero, total: totalCalc, statut: 'comptoir'
    });
  }

  // ════════════════════ CHEMIN CARTE — LES TROIS VERROUS ════════════════════
  if (!ctid) {
    return jsonResp(400, { ok: false, erreur: 'client_transaction_id manquant (paiement carte)' });
  }

  // ── 💶 Verrou 2 : RECALCUL DES PRIX depuis la base ──
  const ids = [...new Set(lignes.filter(l => !l.recompense).map(l => l.produit_id))];
  const { data: prods, error: errProds } = await sb
    .from('produits').select('id, nom, prix, variantes, actif').in('id', ids);
  if (errProds) {
    return jsonResp(500, { ok: false, erreur: 'Lecture produits impossible : ' + errProds.message });
  }
  const parId = {};
  (prods || []).forEach(p => { parId[p.id] = p; });
  for (const l of lignes) {
    if (l.recompense) continue;                     // déjà validée (bornée) plus haut
    const p = parId[l.produit_id];
    if (!p) return jsonResp(400, { ok: false, erreur: 'Produit inconnu : ' + l.produit_id });
    if (p.actif === false) return jsonResp(400, { ok: false, erreur: 'Produit inactif : ' + p.nom });
    const cents = Math.round(l.prix * 100);
    const autorises = new Set([Math.round(Number(p.prix) * 100)]);
    (Array.isArray(p.variantes) ? p.variantes : []).forEach(v => {
      if (v && v.prix != null) autorises.add(Math.round(Number(v.prix) * 100));
    });
    if (l.lien_plat) { autorises.add(0); autorises.add(100); }  // inclus formule / boisson +1 €
    if (!autorises.has(cents)) {
      return jsonResp(400, {
        ok: false,
        erreur: 'Prix non conforme pour « ' + p.nom + ' » (' + l.prix.toFixed(2) + ' €)'
      });
    }
  }

  // ── 🔐 Verrou 1 : LA VÉRITÉ SUMUP (statut + montant) ──
  const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
  const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
  if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) {
    return jsonResp(500, { ok: false, erreur: 'Config SumUp manquante' });
  }
  let tx = null;
  try {
    const r = await fetch(
      'https://api.sumup.com/v2.1/merchants/' + encodeURIComponent(SUMUP_MERCHANT_CODE)
      + '/transactions?client_transaction_id=' + encodeURIComponent(ctid),
      { headers: { 'Authorization': 'Bearer ' + SUMUP_API_KEY } });
    const d = await r.json();
    tx = d && d.items ? d.items[0] : d;
  } catch (e) {
    return jsonResp(502, { ok: false, erreur: 'Vérification SumUp impossible : ' + e.message });
  }
  const statusBrut = ((tx && tx.status) || '').toUpperCase();
  if (!(statusBrut === 'SUCCESSFUL' || statusBrut.includes('PAID') || statusBrut.includes('SUCC'))) {
    return jsonResp(402, { ok: false, erreur: 'Paiement non confirmé par SumUp (' + (statusBrut || 'introuvable') + ')' });
  }
  const montantPaye = tx && tx.amount != null ? Math.round(Number(tx.amount) * 100) : null;
  if (montantPaye === null || montantPaye !== Math.round(totalCalc * 100)) {
    return jsonResp(402, {
      ok: false,
      erreur: 'Montant payé (' + (montantPaye === null ? '?' : (montantPaye / 100).toFixed(2))
        + ' €) différent de la commande (' + totalCalc.toFixed(2) + ' €)'
    });
  }

  // ── 🎫 Verrou 3 : ANTI-DOUBLE (claim atomique du ctid) ──
  const claimId = crypto.randomUUID();
  const restHeaders = {
    'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY,
    'Content-Type': 'application/json', 'Prefer': 'return=representation'
  };
  try {
    const g = await fetch(SUPA_URL + '/rest/v1/paiements_sumup?select=vente_id&client_transaction_id=eq.'
      + encodeURIComponent(ctid), { headers: restHeaders });
    const rows = await g.json();
    if (Array.isArray(rows) && rows.length && rows[0].vente_id) {
      return jsonResp(409, { ok: false, erreur: 'Paiement déjà enregistré (anti-double)' });
    }
    if (Array.isArray(rows) && rows.length) {
      // claim : vente_id doit être NULL au moment du claim (atomique côté Postgres)
      const c = await fetch(SUPA_URL + '/rest/v1/paiements_sumup?client_transaction_id=eq.'
        + encodeURIComponent(ctid) + '&vente_id=is.null',
        { method: 'PATCH', headers: restHeaders, body: JSON.stringify({ vente_id: claimId }) });
      const claimed = await c.json();
      if (!Array.isArray(claimed) || claimed.length === 0) {
        return jsonResp(409, { ok: false, erreur: 'Paiement déjà enregistré (anti-double)' });
      }
    } else {
      // trace absente (insert du checkout raté) : on la crée, claim inclus
      await fetch(SUPA_URL + '/rest/v1/paiements_sumup', {
        method: 'POST', headers: restHeaders,
        body: JSON.stringify({
          restaurant_id: restaurantId, client_transaction_id: ctid,
          montant: totalCalc, statut: 'PAID', vente_id: claimId
        })
      });
    }
  } catch (e) {
    return jsonResp(500, { ok: false, erreur: 'Verrou anti-double indisponible : ' + e.message });
  }

  // ════════════════════ ENREGISTREMENT (inchangé) ════════════════════
  try {
    const { data, error } = await sb.rpc('enregistrer_vente', {
      p_restaurant_id: restaurantId,
      p_mode_paiement: modePaiement,
      p_lignes: lignes,
      p_origine: 'borne',
      p_mode_service: modeService,
      p_canal: 'borne',
      p_client_id: clientId
    });

    if (error) {
      console.error('Erreur Supabase RPC:', error);
      return jsonResp(500, { ok: false, erreur: error.message });
    }

    const venteId = data?.vente_id;

    // 🔗 Lier le paiement à la vente (remplace le claim) — best-effort
    if (venteId) {
      try {
        await fetch(SUPA_URL + '/rest/v1/paiements_sumup?client_transaction_id=eq.'
          + encodeURIComponent(ctid),
          { method: 'PATCH', headers: restHeaders, body: JSON.stringify({ vente_id: venteId }) });
      } catch (e) { console.warn('Liaison paiement↔vente non écrite :', e.message); }
    }

    // 👋 Prénom sur la vente — best-effort
    if (venteId && clientPrenom) {
      const { error: errNom } = await sb
        .from('ventes')
        .update({ client_prenom: clientPrenom })
        .eq('id', venteId);
      if (errNom) console.warn('client_prenom non enregistré :', errNom.message);
    }

    return jsonResp(200, {
      ok: true,
      vente_id: venteId,
      numero: data?.numero,
      total: data?.total,
      hash_ticket: data?.hash_ticket,
      statut: 'validé'
    });

  } catch (e) {
    console.error('Exception:', e);
    return jsonResp(500, { ok: false, erreur: e.message });
  }
};

function jsonResp(code, obj) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}
