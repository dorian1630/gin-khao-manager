// ============================================================
// 💳 SumUp — Reader Checkout (envoyer paiement DIRECT au Solo)
// ============================================================
// Cette fonction utilise l'endpoint Reader Checkout de SumUp
// qui envoie un paiement DIRECTEMENT à un Solo appairé.
// Le client voit le montant sur le Solo et tape sa carte.
// 
// Doc : POST /v0.1/merchants/{code}/readers/{id}/checkout
// ============================================================

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, erreur: 'Méthode non autorisée' })
    };
  }

  try {
    const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
    const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
    
    if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) {
      throw new Error('Configuration manquante (SUMUP_API_KEY / SUMUP_MERCHANT_CODE)');
    }

    const { reader_id, montant, description } = JSON.parse(event.body);
    
    if (!reader_id) throw new Error('reader_id manquant');
    if (!montant || isNaN(parseFloat(montant)) || parseFloat(montant) <= 0) {
      throw new Error('Montant invalide');
    }

    // Montant en centimes pour SumUp Reader API
    const montantCents = Math.round(parseFloat(montant) * 100);
    
    // Référence unique
    const reference = 'GINKHAO-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);

    // Appel API Reader Checkout
    // POST /v0.1/merchants/{merchant_code}/readers/{reader_id}/checkout
    const url = 'https://api.sumup.com/v0.1/merchants/' 
      + encodeURIComponent(SUMUP_MERCHANT_CODE) 
      + '/readers/' + encodeURIComponent(reader_id) 
      + '/checkout';

    const sumupResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SUMUP_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        total_amount: {
          value: montantCents,
          currency: 'EUR',
          minor_unit: 2
        },
        description: description || 'Gin Khao - Borne',
        return_url: ''
      })
    });

    const data = await sumupResponse.json();

    if (!sumupResponse.ok) {
      console.error('Erreur SumUp Reader:', data);
      throw new Error(data.message || data.error_message || 'Erreur API : ' + sumupResponse.status);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        client_transaction_id: data.data?.client_transaction_id || data.client_transaction_id,
        reference: reference,
        amount: montant,
        currency: 'EUR',
        reader_id: reader_id,
        raw_response: data
      })
    };

  } catch (e) {
    console.error('Erreur reader checkout:', e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, erreur: e.message })
    };
  }
};
