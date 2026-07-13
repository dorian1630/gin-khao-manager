// netlify/functions/borne-enregistrer-vente.js
// ============================================================
// Enregistrer une vente depuis la borne (sécurisé, service_role)
// ============================================================
// La borne utilise la clé anon publique (lecture seule).
// Pour ENREGISTRER une vente (qui nécessite d'incrémenter le compteur
// + insérer dans ventes/lignes_vente/journal_evenements), on passe par
// cette function qui utilise la SUPABASE_SERVICE_KEY (côté serveur).
//
// NOUVEAUTÉ v2 :
// - Si paiement carte (SumUp) → statut = 'validé' (vente OK immédiate)
// - Si paiement comptoir → statut = 'en_attente' (à valider par le caissier)
//
// Variables d'environnement requises :
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ============================================================

const { createClient } = require('@supabase/supabase-js');

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
  // 👋 Prénom du client fidélité (pour l'en-tête du ticket : "Commande de Karim")
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

  // Vérification : seuls comptoir / carte autorisés depuis la borne
  if (!['comptoir', 'carte'].includes(modePaiement)) {
    return jsonResp(400, { ok: false, erreur: 'mode_paiement invalide pour la borne' });
  }

  // Validation des lignes (limite anti-abus)
  if (lignes.length > 50) {
    return jsonResp(400, { ok: false, erreur: 'Trop de lignes (max 50)' });
  }
  let nbRecompenses = 0;
  for (const l of lignes) {
    // 🎁 Ligne récompense fidélité : produit_id null, prix négatif borné, quantité 1
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
  // Le total (lignes cumulées) ne peut jamais être négatif
  const totalCalc = lignes.reduce((s, l) => s + l.prix * l.quantite, 0);
  if (totalCalc < 0) {
    return jsonResp(400, { ok: false, erreur: 'Total négatif interdit' });
  }

  const sb = createClient(SUPA_URL, SUPA_KEY);

  // 🅱️ OPTION B — Comptoir : PAS de vente créée ici.
  //    La borne écrira la commande dans commandes_en_cours (cuisine + impression),
  //    et la VENTE (le CA) sera créée par la caisse à l'encaissement réel.
  if (modePaiement === 'comptoir') {
    // Numéro de commande simple pour l'affichage borne (Bxxx)
    const numero = 'B' + Math.floor(100 + Math.random() * 900);
    return jsonResp(200, {
      ok: true,
      vente_id: null,
      numero: numero,
      total: totalCalc,
      statut: 'comptoir'
    });
  }

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

    // 👋 Mémoriser le prénom sur la vente (pour le ticket) — best-effort
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
