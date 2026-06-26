// ============================================================
// 💳 SumUp — Reader Checkout (envoyer paiement DIRECT au Solo)
// V3 : Enregistre le paiement dans Supabase + return_url webhook
// ============================================================

const SUPABASE_URL = 'https://szpgbdnijyoquqmjhhjj.supabase.co';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, erreur: 'Méthode non autorisée' }) };
  }

  try {
    const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
    const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
    const SUMUP_AFFILIATE_KEY = process.env.SUMUP_AFFILIATE_KEY;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const SITE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://gin-khao-manager.netlify.app';
    
    if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE || !SUMUP_AFFILIATE_KEY) {
      throw new Error('Configuration SumUp manquante');
    }

    const { reader_id, montant, description, restaurant_id } = JSON.parse(event.body);
    
    if (!reader_id) throw new Error('reader_id manquant');
    if (!montant || isNaN(parseFloat(montant)) || parseFloat(montant) <= 0) {
      throw new Error('Montant invalide');
    }

    const montantCents = Math.round(parseFloat(montant) * 100);
    const reference = 'GINKHAO-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const restoId = restaurant_id || 'gin-khao';

    // URL du webhook qui recevra la confirmation
    const webhookUrl = SITE_URL + '/.netlify/functions/sumup-webhook?ref=' + encodeURIComponent(reference);

    // Appel API Reader Checkout
    const url = 'https://api.sumup.com/v0.1/merchants/' 
      + encodeURIComponent(SUMUP_MERCHANT_CODE) 
      + '/readers/' + encodeURIComponent(reader_id) 
      + '/checkout';

    const bodyData = {
      total_amount: {
        value: montantCents,
        currency: 'EUR',
        minor_unit: 2
      },
      description: description || 'Gin Khao - Borne',
      return_url: webhookUrl,
      affiliate: {
        key: SUMUP_AFFILIATE_KEY,
        app_id: 'gin-khao-borne',
        foreign_transaction_id: reference
      }
    };

    const sumupResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SUMUP_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyData)
    });

    const data = await sumupResponse.json();

    if (!sumupResponse.ok) {
      return {
        statusCode: sumupResponse.status,
        headers,
        body: JSON.stringify({ 
          ok: false, 
          erreur: data.message || data.title || ((data.errors||{}).detail) || 'Erreur API ' + sumupResponse.status,
          details: data
        })
      };
    }

    const clientTransactionId = data.data?.client_transaction_id || data.client_transaction_id;

    // Enregistrer le paiement dans Supabase
    if (SUPABASE_SERVICE_KEY && clientTransactionId) {
      try {
        await fetch(SUPABASE_URL + '/rest/v1/paiements_sumup', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            restaurant_id: restoId,
            client_transaction_id: clientTransactionId,
            reference: reference,
            reader_id: reader_id,
            montant: parseFloat(montant),
            statut: 'PENDING'
          })
        });
      } catch (e) {
        console.error('Erreur insert paiement_sumup:', e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        client_transaction_id: clientTransactionId,
        reference: reference,
        amount: montant,
        currency: 'EUR',
        reader_id: reader_id
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
