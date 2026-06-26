// ============================================================
// 💳 SumUp — Vérification du statut d'un paiement
// ============================================================
// Cette fonction est appelée toutes les 2 secondes par la borne
// pendant que le client est en train de payer sur le Solo.
// Elle renvoie le statut actuel : PENDING / PAID / FAILED / EXPIRED.
//
// Variables d'environnement requises :
//   - SUMUP_API_KEY : ta clé secrète SumUp
// ============================================================

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
    if (!SUMUP_API_KEY) {
      throw new Error('SUMUP_API_KEY non configurée');
    }

    const checkoutId = event.queryStringParameters?.checkout_id;
    if (!checkoutId) {
      throw new Error('checkout_id manquant');
    }

    // Appel API SumUp pour récupérer le statut
    const sumupResponse = await fetch(
      'https://api.sumup.com/v0.1/checkouts/' + encodeURIComponent(checkoutId),
      {
        headers: {
          'Authorization': 'Bearer ' + SUMUP_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const sumupData = await sumupResponse.json();

    if (!sumupResponse.ok) {
      throw new Error(sumupData.message || 'Erreur API SumUp');
    }

    // Le statut SumUp peut être : PENDING, PAID, FAILED, EXPIRED
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        statut: sumupData.status,
        checkout_id: sumupData.id,
        amount: sumupData.amount,
        currency: sumupData.currency,
        transactions: sumupData.transactions || []
      })
    };

  } catch (e) {
    console.error('Erreur check status:', e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, erreur: e.message })
    };
  }
};
