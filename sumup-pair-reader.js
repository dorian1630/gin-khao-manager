// netlify/functions/sumup-pair-reader.js
// ============================================================
// 💳 SumUp — Appairage des Solo (Cloud API) — GARDÉ par le login Manager
// ============================================================
// Opérations (POST JSON, header Authorization: Bearer <access_token Supabase du gérant>) :
//   { op: "list" }                                  → liste des readers du compte
//   { op: "pair", code: "ABC12345", nom: "Borne Saint-Just" } → crée le reader (code affiché par le Solo)
//   { op: "unpair", reader_id: "rdr_..." }          → supprime le reader côté SumUp
//   { op: "save", site: "saint-just", reader_id, nom, device_id } → enregistre le reader du site (table sumup_readers)
// Variables : SUMUP_API_KEY, SUMUP_MERCHANT_CODE, SUPABASE_SERVICE_KEY (toutes déjà en place)
// ============================================================
const { createClient } = require('@supabase/supabase-js');

const SITES = ['saint-just', 'la-capelette', 'saint-fereol', 'saint-antoine'];

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResp(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResp(405, { ok: false, erreur: 'Method not allowed' });

  const SUPA_URL = process.env.SUPABASE_URL || 'https://szpgbdnijyoquqmjhhjj.supabase.co';
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
  const MC = process.env.SUMUP_MERCHANT_CODE;
  if (!SUPA_KEY) return jsonResp(500, { ok: false, erreur: 'SUPABASE_SERVICE_KEY manquante' });
  if (!SUMUP_API_KEY || !MC) return jsonResp(500, { ok: false, erreur: 'Config SumUp manquante' });

  // 🔐 Garde : seul un gérant CONNECTÉ (session Supabase valide) peut appairer
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResp(401, { ok: false, erreur: 'Connexion requise' });
  const sb = createClient(SUPA_URL, SUPA_KEY);
  const { data: udata, error: uerr } = await sb.auth.getUser(token);
  if (uerr || !udata || !udata.user) return jsonResp(401, { ok: false, erreur: 'Session invalide' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { ok: false, erreur: 'JSON invalide' }); }
  const op = String(body.op || 'list');
  const H = { 'Authorization': 'Bearer ' + SUMUP_API_KEY, 'Content-Type': 'application/json' };
  const base = 'https://api.sumup.com/v0.1/merchants/' + encodeURIComponent(MC) + '/readers';

  try {
    if (op === 'list') {
      const r = await fetch(base, { headers: H });
      const d = await r.json();
      if (!r.ok) return jsonResp(r.status, { ok: false, erreur: d.message || d.title || 'Erreur API ' + r.status });
      // + les readers enregistrés par site
      const { data: sites } = await sb.from('sumup_readers').select('*');
      return jsonResp(200, { ok: true, readers: d.items || d.readers || d, sites: sites || [] });
    }

    if (op === 'pair') {
      const code = String(body.code || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9]{8,9}$/.test(code)) return jsonResp(400, { ok: false, erreur: 'Code d\'appairage attendu : 8-9 caractères' });
      const r = await fetch(base, { method: 'POST', headers: H,
        body: JSON.stringify({ pairing_code: code, name: String(body.nom || 'Borne Gin Khao').slice(0, 60) }) });
      const d = await r.json();
      if (!r.ok) return jsonResp(r.status, { ok: false, erreur: d.message || d.title || d.detail || 'Erreur API ' + r.status, details: d });
      return jsonResp(200, { ok: true, reader: d });
    }

    if (op === 'unpair') {
      const id = String(body.reader_id || '');
      if (!/^rdr_[A-Za-z0-9]+$/.test(id)) return jsonResp(400, { ok: false, erreur: 'reader_id invalide' });
      const r = await fetch(base + '/' + encodeURIComponent(id), { method: 'DELETE', headers: H });
      return jsonResp(200, { ok: r.status < 300 || r.status === 404, status: r.status });
    }

    if (op === 'save') {
      const site = String(body.site || '').toLowerCase();
      const id = String(body.reader_id || '');
      if (!SITES.includes(site)) return jsonResp(400, { ok: false, erreur: 'Site inconnu' });
      if (!/^rdr_[A-Za-z0-9]+$/.test(id)) return jsonResp(400, { ok: false, erreur: 'reader_id invalide' });
      const { error } = await sb.from('sumup_readers').upsert({
        site, reader_id: id, nom: body.nom || null, device_id: body.device_id || null, actif: true, maj_le: new Date().toISOString()
      });
      if (error) return jsonResp(500, { ok: false, erreur: error.message });
      return jsonResp(200, { ok: true, site, reader_id: id });
    }

    return jsonResp(400, { ok: false, erreur: 'op inconnue : ' + op });
  } catch (e) {
    console.error('sumup-pair-reader :', e);
    return jsonResp(500, { ok: false, erreur: e.message });
  }
};

function jsonResp(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
    body: JSON.stringify(obj) };
}
