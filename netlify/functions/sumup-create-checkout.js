// netlify/functions/sumup-create-checkout.js
// ============================================================
// SumUp Online Payments — Création d'un checkout
// ============================================================
// Variables d'environnement requises :
//   SUMUP_API_KEY        = ta clé API SumUp (sup_sk_...)
//   SUMUP_MERCHANT_CODE  = ton code marchand SumUp (MCXXXX)
// ============================================================

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResp(405, { ok: false, erreur: 'Method not allowed' });
  }

  const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
  const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;

  if (!SUMUP_API_KEY) return jsonResp(500, { ok: false, erreur: 'SUMUP_API_KEY manquante' });
  if (!SUMUP_MERCHANT_CODE) return jsonResp(500, { ok: false, erreur: 'SUMUP_MERCHANT_CODE manquant' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, erreur: 'JSON invalide' }); }

  const montant = parseFloat(body.montant);
  if (!montant || montant <= 0) {
    return jsonResp(400, { ok: false, erreur: 'Montant invalide' });
  }

  try {
    // Référence unique pour ce checkout
    const ref = 'GK-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();

    const res = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SUMUP_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        checkout_reference: ref,
        amount: montant,
        currency: 'EUR',
        merchant_code: SUMUP_MERCHANT_CODE,
        description: body.description || 'Gin Khao - Borne',
        return_url: body.return_url || null
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Erreur SumUp:', data);
      return jsonResp(500, { ok: false, erreur: data.message || data.error_code || 'Erreur SumUp', details: data });
    }

    return jsonResp(200, {
      ok: true,
      checkout_id: data.id,
      checkout_reference: ref,
      status: data.status,
      checkout_url: data.checkout_url || null
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
