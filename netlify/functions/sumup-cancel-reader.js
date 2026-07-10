// ============================================================
// 💳 SumUp — Annuler le paiement en cours sur le Solo
// Appelé quand le client appuie sur "Annuler" à la borne.
// Le terminal revient à son écran d'accueil.
// ============================================================

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
    const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
    if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) throw new Error('Config SumUp manquante');

    const { reader_id } = JSON.parse(event.body || '{}');
    if (!reader_id) throw new Error('reader_id manquant');

    // Terminer/annuler le checkout en cours sur ce reader
    const url = 'https://api.sumup.com/v0.1/merchants/'
      + encodeURIComponent(SUMUP_MERCHANT_CODE)
      + '/readers/' + encodeURIComponent(reader_id)
      + '/terminate';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SUMUP_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Terminate reader (HTTP ' + resp.status + ')');
    // 204 = succès (pas de contenu). 404/409 = rien en cours, pas grave.
    return { statusCode: 200, headers, body: JSON.stringify({ ok: resp.status < 300 || resp.status === 404, status: resp.status }) };

  } catch (e) {
    console.error('Erreur cancel reader:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, erreur: e.message }) };
  }
};
