// ============================================================
// 💳 SumUp — Webhook (réceptionne les notifications de paiement)
// V2 : PATCH uniquement statut (colonnes sûres), ignore UNKNOWN
// ============================================================

const SUPABASE_URL = 'https://szpgbdnijyoquqmjhhjj.supabase.co';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_SERVICE_KEY) {
      console.error('SUPABASE_SERVICE_KEY manquante');
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, erreur: 'Config DB' }) };
    }

    // SumUp peut envoyer en POST (webhook body) ou en GET (return_url avec query)
    let payload = {};
    if (event.httpMethod === 'POST' && event.body) {
      try { payload = JSON.parse(event.body); } catch (e) { payload = {}; }
    }
    // Fusionner aussi la query string (notre ?ref=... y est toujours)
    const query = event.queryStringParameters || {};

    // Log complet pour debug
    console.log('Webhook SumUp reçu:', JSON.stringify({ method: event.httpMethod, payload, query }));

    // Extraire les infos clés (formats SumUp variables)
    const clientTransactionId =
      payload.client_transaction_id ||
      payload.transaction_id ||
      (payload.event && payload.event.client_transaction_id) ||
      (payload.data && payload.data.client_transaction_id) ||
      query.client_transaction_id;

    const reference =
      payload.foreign_transaction_id ||
      payload.checkout_reference ||
      query.ref;

    // Statut brut
    let statutBrut = (
      payload.status ||
      payload.transaction_status ||
      payload.event_type ||
      (payload.event && payload.event.status) ||
      (payload.data && payload.data.status) ||
      query.status ||
      ''
    ).toUpperCase();

    // Normaliser
    let statut = null;
    if (statutBrut.includes('SUCC') || statutBrut.includes('PAID')) {
      statut = 'PAID';
    } else if (statutBrut.includes('FAIL') || statutBrut.includes('CANCEL') || statutBrut.includes('DECLIN')) {
      statut = 'FAILED';
    }

    // ✨ Statut inconnu → on n'écrit RIEN (surtout pas UNKNOWN qui écraserait)
    if (!statut) {
      console.log('Statut non définitif, ignoré:', statutBrut);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ignore: true, statutBrut }) };
    }

    // Trouver le paiement par client_transaction_id OU par reference
    let filterUrl = '';
    if (clientTransactionId) {
      filterUrl = 'client_transaction_id=eq.' + encodeURIComponent(clientTransactionId);
    } else if (reference) {
      filterUrl = 'reference=eq.' + encodeURIComponent(reference);
    } else {
      console.error('Pas de client_transaction_id ni reference pour identifier');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, msg: 'Pas d\'identifiant' }) };
    }

    // ✨ UPDATE : UNIQUEMENT la colonne statut (les colonnes inexistantes font échouer tout le PATCH)
    const updateResp = await fetch(
      SUPABASE_URL + '/rest/v1/paiements_sumup?' + filterUrl,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ statut: statut })
      }
    );

    const updateData = await updateResp.json();
    console.log('Update DB (HTTP ' + updateResp.status + '):', JSON.stringify(updateData));

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, statut, updated: updateData }) };

  } catch (e) {
    console.error('Erreur webhook:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, erreur: e.message }) };
  }
};
