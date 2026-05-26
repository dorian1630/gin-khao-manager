// netlify/functions/paiement-sumup.js
// Déclenche un paiement sur le lecteur Solo via la Cloud API SumUp.
//
// Test rapide dans le navigateur :
//   /.netlify/functions/paiement-sumup?montant=15.00
//
// Plus tard, la caisse/borne appellera cette fonction en POST avec le montant.
//
// Utilise les clés SANDBOX (_TEST) pour les tests.

const MERCHANT_CODE = 'MQBD65RS';                              // sandbox
const READER_ID = 'rdr_35PNH0DD5J8HRBQDXRYCZJV61E';            // Solo virtuel associé
const APP_ID = 'app.ginkhao.caisse';

exports.handler = async function (event) {
  const API_KEY = process.env.SUMUP_API_KEY_TEST;
  const AFFILIATE_KEY = process.env.SUMUP_AFFILIATE_KEY_TEST;

  if (!API_KEY || !AFFILIATE_KEY) {
    return json(500, { ok: false, etape: 'config', message: "Clés sandbox manquantes dans Netlify (SUMUP_API_KEY_TEST / SUMUP_AFFILIATE_KEY_TEST)." });
  }

  // Récupère le montant : depuis le body POST (caisse/borne) ou l'URL (?montant=) pour test
  let montant = null;
  let description = 'Commande Gin Khao';
  if (event.httpMethod === 'POST' && event.body) {
    try {
      const b = JSON.parse(event.body);
      montant = b.montant;
      if (b.description) description = b.description;
    } catch (e) { /* ignore */ }
  }
  if (!montant && event.queryStringParameters && event.queryStringParameters.montant) {
    montant = parseFloat(event.queryStringParameters.montant);
  }

  if (!montant || montant <= 0) {
    return json(400, { ok: false, etape: 'montant', message: "Montant manquant ou invalide. Test : ?montant=15.00" });
  }

  // La Cloud API attend le montant en "minor units" (centimes) : 15.00€ -> 1500
  const valueMinor = Math.round(montant * 100);

  try {
    const reponse = await fetch(
      `https://api.sumup.com/v0.1/merchants/${MERCHANT_CODE}/readers/${READER_ID}/checkout`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          total_amount: {
            currency: 'EUR',
            minor_unit: 2,
            value: valueMinor
          },
          description: description,
          affiliate: {
            app_id: APP_ID,
            key: AFFILIATE_KEY
          }
        })
      }
    );

    // Réponse vide possible (202 Accepted) ou JSON
    let data = {};
    const txt = await reponse.text();
    if (txt) { try { data = JSON.parse(txt); } catch (e) { data = { raw: txt }; } }

    if (!reponse.ok) {
      return json(200, {
        ok: false,
        etape: 'checkout',
        statut_http: reponse.status,
        message: "SumUp a refusé la demande de paiement.",
        details: data
      });
    }

    return json(200, {
      ok: true,
      message: 'Paiement déclenché sur le terminal ✅ — regarde ton Solo Virtuel !',
      montant: montant,
      details: data
    });
  } catch (e) {
    return json(500, { ok: false, etape: 'reseau', message: 'Erreur réseau : ' + e.message });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
