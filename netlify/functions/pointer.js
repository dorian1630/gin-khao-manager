// netlify/functions/pointer.js
// ============================================================
// ⏱️ POINTEUSE — la porte d'entrée serveur (patron « serrure »)
// ============================================================
// La caisse (clé anon) ne peut PAS appeler la RPC pointer() directement :
// son exécution est réservée à service_role. Cette fonction :
//   1. valide le colis (badge UUID, site connu, action autorisée)
//   2. appelle la RPC pointer(badge, site, action) avec la clé serveur
//   3. renvoie tel quel le verdict de la machine à états (jsonb)
//
// Colis attendu (POST JSON) :
//   { badge: "EMPLOYE:<uuid>" ou "<uuid>", site: "saint-just", action: null|"pause"|"sortie"|"reprise"|"entree" }
//   { op: "cloturer", site: "saint-just" }   → cloturer_oublis(site)   (Clôture Z)
//
// Variables d'environnement : SUPABASE_URL (facultative), SUPABASE_SERVICE_KEY
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITES = ['saint-just', 'la-capelette', 'saint-fereol', 'saint-antoine'];
const ACTIONS = [null, 'pause', 'sortie', 'reprise', 'entree'];

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResp(200, { ok: true });
  if (event.httpMethod !== 'POST') {
    return jsonResp(405, { ok: false, erreur: 'Method not allowed' });
  }

  const SUPA_URL = process.env.SUPABASE_URL || 'https://szpgbdnijyoquqmjhhjj.supabase.co';
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_KEY) return jsonResp(500, { ok: false, erreur: 'SUPABASE_SERVICE_KEY manquante' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, erreur: 'JSON invalide' }); }

  // ── site (commun aux deux opérations)
  const site = String(body.site || '').trim().toLowerCase();
  if (!SITES.includes(site)) {
    return jsonResp(400, { ok: false, erreur: 'Site inconnu : ' + (site || '(vide)') });
  }

  const sb = createClient(SUPA_URL, SUPA_KEY);

  // ── op = cloturer : la Clôture Z ferme les oublis du site
  if (body.op === 'cloturer') {
    const { data, error } = await sb.rpc('cloturer_oublis', { p_site: site });
    if (error) return jsonResp(500, { ok: false, erreur: error.message });
    return jsonResp(200, data);
  }

  // ── op = pointer (défaut)
  // le badge arrive tel que la douchette l'a tapé : "EMPLOYE:<uuid>" — on tolère aussi l'uuid nu
  let badge = String(body.badge || '').trim();
  if (/^EMPLOYE:/i.test(badge)) badge = badge.slice(8).trim();
  if (!UUID_RE.test(badge)) {
    return jsonResp(400, { ok: false, erreur: 'Badge illisible' });
  }
  const action = body.action == null ? null : String(body.action).trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    return jsonResp(400, { ok: false, erreur: 'Action invalide : ' + action });
  }

  try {
    const { data, error } = await sb.rpc('pointer', {
      p_badge: badge.toLowerCase(),
      p_site: site,
      p_action: action
    });
    if (error) {
      console.error('RPC pointer KO :', error);
      return jsonResp(500, { ok: false, erreur: error.message });
    }
    // le verdict de la machine à états, tel quel (ok/deja/choix/erreur…)
    return jsonResp(200, data);
  } catch (e) {
    console.error('Exception pointer :', e);
    return jsonResp(500, { ok: false, erreur: e.message });
  }
};

function jsonResp(code, obj) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(obj)
  };
}
