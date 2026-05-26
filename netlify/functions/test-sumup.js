// netlify/functions/test-sumup.js
// Fonction de TEST — vérifie que la clé API SumUp est bien configurée
// et récupère les infos du compte (dont le merchant_code).
// Ne déclenche AUCUN paiement.

exports.handler = async function (event, context) {
  const API_KEY = process.env.SUMUP_API_KEY;

  // Vérif 1 : la clé est-elle configurée dans Netlify ?
  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        etape: 'config',
        message: "La variable SUMUP_API_KEY n'est pas configurée dans Netlify."
      })
    };
  }

  try {
    // Vérif 2 : on appelle l'endpoint le plus simple de SumUp (/me)
    const reponse = await fetch('https://api.sumup.com/v0.1/me', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const data = await reponse.json();

    if (!reponse.ok) {
      // La clé est configurée mais SumUp la refuse (invalide / mauvais droits)
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          etape: 'auth',
          statut_http: reponse.status,
          message: "SumUp a refusé la clé. Vérifie qu'elle est valide et complète.",
          details: data
        })
      };
    }

    // Succès : on extrait le merchant_code si présent
    const merchantCode =
      data?.merchant_profile?.merchant_code ||
      data?.merchant_code ||
      '(non trouvé dans la réponse)';

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: 'Connexion à SumUp réussie ✅',
        merchant_code: merchantCode,
        // on renvoie quelques infos non sensibles pour vérifier
        compte: {
          email: data?.email || null,
          pays: data?.country || null,
          devise: data?.default_currency || null
        }
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        etape: 'reseau',
        message: 'Erreur réseau en contactant SumUp : ' + e.message
      })
    };
  }
};
