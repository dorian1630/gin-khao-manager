// netlify/functions/equipe.js
// ============================================================
// ⏱️ ÉQUIPE — corrections de pointage & clôture des oublis
//    GARDÉ par le login Manager (session Supabase du gérant)
// ============================================================
// Les pointages sont INALTÉRABLES (trigger) : on n'efface jamais, on trace.
// Ces deux opérations relaient les RPC réservées à service_role :
//   { op: "corriger", motif, annuler_id }                          → annule un pointage (tracé)
//   { op: "corriger", motif, employe, site, type, horodatage }     → ajoute un pointage manuel (tracé)
//   { op: "cloturer", site }                                       → cloturer_oublis(site) : ferme les journées > 14 h
// L'AUTEUR de chaque correction = l'email de la session (jamais déclaratif).
// Variables : SUPABASE_SERVICE_KEY (déjà en place)
// ============================================================
const { createClient } = require('@supabase/supabase-js');

const SITES = ['saint-just', 'la-capelette', 'saint-fereol', 'saint-antoine'];
const TYPES = ['entree', 'pause', 'reprise', 'sortie'];

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResp(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResp(405, { ok: false, erreur: 'Method not allowed' });

  const SUPA_URL = process.env.SUPABASE_URL || 'https://szpgbdnijyoquqmjhhjj.supabase.co';
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_KEY) return jsonResp(500, { ok: false, erreur: 'SUPABASE_SERVICE_KEY manquante' });

  // 🔐 Garde : seul un gérant CONNECTÉ (session Supabase valide) peut corriger
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResp(401, { ok: false, erreur: 'Connexion requise' });
  const sb = createClient(SUPA_URL, SUPA_KEY);
  const { data: udata, error: uerr } = await sb.auth.getUser(token);
  if (uerr || !udata || !udata.user) return jsonResp(401, { ok: false, erreur: 'Session invalide' });
  const auteur = udata.user.email || udata.user.id;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { ok: false, erreur: 'JSON invalide' }); }
  const op = String(body.op || '');

  try {
    // ── Clôture des oublis (> 14 h) d'un site ──
    if (op === 'cloturer') {
      const site = String(body.site || '').trim().toLowerCase();
      if (!SITES.includes(site)) return jsonResp(400, { ok: false, erreur: 'Site inconnu' });
      const { data, error } = await sb.rpc('cloturer_oublis', { p_site: site });
      if (error) return jsonResp(500, { ok: false, erreur: error.message });
      return jsonResp(200, data || { ok: true, clotures: 0 });
    }

    // ── Correction tracée : annulation OU ajout manuel ──
    if (op === 'corriger') {
      const motif = String(body.motif || '').trim();
      if (!motif) return jsonResp(400, { ok: false, erreur: 'Motif obligatoire' });

      const params = { p_auteur: auteur, p_motif: motif, p_annuler_id: null, p_employe: null, p_site: null, p_type: null, p_horodatage: null };

      if (body.annuler_id != null) {
        const id = Number(body.annuler_id);
        if (!Number.isInteger(id) || id <= 0) return jsonResp(400, { ok: false, erreur: 'annuler_id invalide' });
        params.p_annuler_id = id;
      } else {
        const site = String(body.site || '').trim().toLowerCase();
        const type = String(body.type || '').trim().toLowerCase();
        const horodatage = String(body.horodatage || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.employe || ''))) {
          return jsonResp(400, { ok: false, erreur: 'employe invalide' });
        }
        if (!SITES.includes(site)) return jsonResp(400, { ok: false, erreur: 'Site inconnu' });
        if (!TYPES.includes(type)) return jsonResp(400, { ok: false, erreur: 'Type invalide' });
        if (isNaN(Date.parse(horodatage))) return jsonResp(400, { ok: false, erreur: 'Horodatage invalide' });
        params.p_employe = String(body.employe).toLowerCase();
        params.p_site = site;
        params.p_type = type;
        params.p_horodatage = horodatage;
      }

      const { data, error } = await sb.rpc('corriger_pointage', params);
      if (error) return jsonResp(500, { ok: false, erreur: error.message });
      return jsonResp(200, data || { ok: true });
    }

    return jsonResp(400, { ok: false, erreur: 'Opération inconnue : ' + op });
  } catch (e) {
    return jsonResp(500, { ok: false, erreur: e.message });
  }
};

function jsonResp(code, obj) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(obj)
  };
}
