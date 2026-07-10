// ============================================================
// 💳 SumUp — Vérifier le statut d'une transaction (polling actif)
// La borne appelle cette fonction toutes les 3s après le lancement
// du paiement. On interroge l'API SumUp et on met à jour Supabase.
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
    const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
    const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) throw new Error('Config SumUp manquante');

    // client_transaction_id passé par la borne
    const params = event.queryStringParameters || {};
    let clientTransactionId = params.ctid;
    if (!clientTransactionId && event.body) {
      try { clientTransactionId = JSON.parse(event.body).ctid; } catch (e) {}
    }
    if (!clientTransactionId) throw new Error('ctid manquant');

    // Interroger l'API SumUp Transactions
    const url = 'https://api.sumup.com/v2.1/merchants/'
      + encodeURIComponent(SUMUP_MERCHANT_CODE)
      + '/transactions?client_transaction_id=' + encodeURIComponent(clientTransactionId);

    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + SUMUP_API_KEY }
    });
    const data = await resp.json();
    console.log('SumUp transaction lookup (HTTP ' + resp.status + '):', JSON.stringify(data));

    // La transaction n'existe pas encore côté SumUp → toujours en cours
    if (resp.status === 404 || !data || (data.items && data.items.length === 0)) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, statut: 'PENDING' }) };
    }
    if (!resp.ok) {
      throw new Error(data.message || 'Erreur API SumUp ' + resp.status);
    }

    // Extraire le statut (réponse directe ou liste items)
    const tx = data.items ? data.items[0] : data;
    const statusBrut = (tx.status || '').toUpperCase();

    let statut = 'PENDING';
    if (statusBrut === 'SUCCESSFUL' || statusBrut.includes('PAID') || statusBrut.includes('SUCC')) {
      statut = 'PAID';
    } else if (statusBrut.includes('FAIL') || statusBrut.includes('CANCEL') || statusBrut.includes('REFUSED')) {
      statut = 'FAILED';
    }

    // Mettre à jour Supabase si statut définitif
    if (statut !== 'PENDING' && SUPABASE_SERVICE_KEY) {
      try {
        await fetch(
          SUPABASE_URL + '/rest/v1/paiements_sumup?client_transaction_id=eq.' + encodeURIComponent(clientTransactionId),
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ statut: statut })
          }
        );
      } catch (e) { console.error('Maj Supabase KO:', e); }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, statut: statut, statusBrut: statusBrut }) };

  } catch (e) {
    console.error('Erreur check status:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, statut: 'PENDING', erreur: e.message }) };
  }
};
