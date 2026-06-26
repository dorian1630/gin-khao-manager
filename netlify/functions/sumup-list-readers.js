// ============================================================
// 💳 SumUp — Liste des Readers (Solo) appairés
// ============================================================
// Permet de récupérer le reader_id du Solo après pairing.
// Le reader_id est nécessaire pour envoyer des paiements direct.
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
    const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
    
    if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) {
      throw new Error('Configuration manquante (SUMUP_API_KEY / SUMUP_MERCHANT_CODE)');
    }

    // GET la liste des readers du marchand
    const sumupResponse = await fetch(
      'https://api.sumup.com/v0.1/merchants/' + encodeURIComponent(SUMUP_MERCHANT_CODE) + '/readers',
      {
        headers: {
          'Authorization': 'Bearer ' + SUMUP_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await sumupResponse.json();

    if (!sumupResponse.ok) {
      throw new Error(data.message || 'Erreur API SumUp');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, readers: data.items || data, merchant_code: SUMUP_MERCHANT_CODE })
    };

  } catch (e) {
    console.error('Erreur list readers:', e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, erreur: e.message })
    };
  }
};
