// ============================================================
// 💳 SumUp — Vérifier le statut d'une transaction Reader/Solo
// V2 : interroge l'API Transactions (client_transaction_id)
// La borne appelle cette fonction toutes les 3s pendant le paiement.
// Elle met aussi à jour paiements_sumup dans Supabase.
// ============================================================

const SUPABASE_URL = 'https://szpgbdnijyoquqmjhhjj.supabase.co';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
    const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) throw new Error('Config SumUp manquante');

    // client_transaction_id passé par la borne (?ctid=...)
    const params = event.queryStringParameters || {};
    let clientTransactionId = params.ctid;
    if (!clientTransactionId && event.body) {
      try { clientTransactionId = JSON.parse(event.body).ctid; } catch (e) {}
    }
    if (!clientTransactionId) throw new Error('ctid manquant');

    // Interroger l'API SumUp Transactions (Reader API)
    const url = 'https://api.sumup.com/v2.1/merchants/'
      + encodeURIComponent(SUMUP_MERCHANT_CODE)
      + '/transactions?client_transaction_id=' + encodeURIComponent(clientTransactionId);

    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + SUMUP_API_KEY }
    });
    const data = await resp.json();
    console.log('SumUp transaction lookup (HTTP ' + resp.status + '):', JSON.stringify(data));

    // Transaction pas encore visible côté SumUp → paiement toujours en cours
    if (resp.status === 404 || !data || (data.items && data.items.length === 0)) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, statut: 'PENDING' }) };
    }
    if (!resp.ok) {
      throw new Error(data.message || 'Erreur API SumUp ' + resp.status);
    }

    // Extraire le statut (réponse directe ou liste items)
    let tx = data.items ? data.items[0] : data;
    const statusBrut = (tx.status || '').toUpperCase();

    let statut = 'PENDING';
    if (statusBrut === 'SUCCESSFUL' || statusBrut.includes('PAID') || statusBrut.includes('SUCC')) {
      statut = 'PAID';
    } else if (statusBrut.includes('FAIL') || statusBrut.includes('CANCEL') || statusBrut.includes('REFUSED')) {
      statut = 'FAILED';
    }

    // 💳 Paiement accepté → on récupère le DÉTAIL de la transaction
    //    (4 derniers chiffres, type de carte, mode de saisie, n° d'autorisation)
    //    pour pouvoir imprimer un vrai reçu carte bancaire à la borne.
    let recu = null;
    if (statut === 'PAID') {
      try {
        // La liste ne donne qu'un résumé : on demande la fiche complète
        if (tx.id) {
          const urlDetail = 'https://api.sumup.com/v2.1/merchants/'
            + encodeURIComponent(SUMUP_MERCHANT_CODE)
            + '/transactions?id=' + encodeURIComponent(tx.id);
          const rd = await fetch(urlDetail, { headers: { 'Authorization': 'Bearer ' + SUMUP_API_KEY } });
          if (rd.ok) {
            const detail = await rd.json();
            tx = detail.items ? detail.items[0] : (detail || tx);
          }
        }
        const carte = tx.card || (Array.isArray(tx.events) && tx.events[0] && tx.events[0].card) || {};
        recu = {
          transaction_code: tx.transaction_code || null,
          horodatage: tx.timestamp || null,
          montant: tx.amount != null ? tx.amount : null,
          devise: tx.currency || 'EUR',
          carte_type: carte.type || tx.card_type || null,       // VISA, MASTERCARD…
          carte_last4: carte.last_4_digits || null,
          entry_mode: tx.entry_mode || null,                    // CONTACTLESS, CHIP…
          auth_code: tx.auth_code || tx.authorization_code || null,
          merchant_code: SUMUP_MERCHANT_CODE,
          payment_type: tx.payment_type || null
        };
        console.log('Détail transaction pour reçu :', JSON.stringify(recu));
      } catch (e) {
        console.warn('Détail transaction indisponible :', e.message);
      }
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

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, statut: statut, statusBrut: statusBrut, recu: recu }) };

  } catch (e) {
    console.error('Erreur check status:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, statut: 'PENDING', erreur: e.message }) };
  }
};
