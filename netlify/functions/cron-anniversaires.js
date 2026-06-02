// netlify/functions/cron-anniversaires.js
// ============================================================
// CRON QUOTIDIEN — Envoie les SMS d'anniversaire à 9h
// ============================================================
// Schedule : "0 9 * * *" (configuré dans netlify.toml)
// Action : trouve les clients qui ont leur anniversaire AUJOURD'HUI,
//          génère un SMS perso (IA), l'envoie via Brevo, log dans sms_logs
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const RESTO_ID = 'gin-khao';
const SB_URL = process.env.SUPABASE_URL || 'https://szpgbdnijyoquqmjhhjj.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // ⚠️ clé service_role (admin)
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Schedule pour Netlify : tous les jours à 9h UTC
exports.config = {
  schedule: '0 9 * * *'
};

exports.handler = async function (event) {
  console.log('🎂 Cron anniversaires lancé à', new Date().toISOString());

  if (!SB_SERVICE_KEY) return reponseErr('SUPABASE_SERVICE_KEY manquant');
  if (!BREVO_API_KEY) return reponseErr('BREVO_API_KEY manquant');

  const sb = createClient(SB_URL, SB_SERVICE_KEY);
  const stats = { total: 0, envoyes: 0, erreurs: 0, deja_envoye: 0, sans_tel: 0 };

  try {
    // 1) Vérifier que l'auto-anniversaire est activée pour ce resto
    const { data: params } = await sb.from('parametres_sms')
      .select('auto_anniv, offre_texte, offre_code, mode_message, message_manuel')
      .eq('restaurant_id', RESTO_ID).single();

    if (!params || !params.auto_anniv) {
      console.log('⏸️ Automatisation anniversaire désactivée pour', RESTO_ID);
      return reponseOk({ message: 'Automatisation désactivée', stats });
    }

    // 2) Récupérer les clients avec anniversaire aujourd'hui
    const aujourd = new Date();
    const moisJour = String(aujourd.getMonth() + 1).padStart(2, '0') + '-' + String(aujourd.getDate()).padStart(2, '0');
    const anneeAct = aujourd.getFullYear();

    // PostgreSQL : extraire mois et jour de date_anniversaire
    const { data: clients, error } = await sb.from('clients')
      .select('id, nom, telephone, date_anniversaire, anniv_sms_annee, sms_optin')
      .eq('restaurant_id', RESTO_ID)
      .not('date_anniversaire', 'is', null);
    if (error) throw error;

    // Filtre côté JS pour matcher MM-DD
    const candidats = (clients || []).filter(c => {
      if (!c.date_anniversaire) return false;
      const d = new Date(c.date_anniversaire);
      const mj = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return mj === moisJour;
    });

    stats.total = candidats.length;
    console.log(`📊 ${candidats.length} anniversaire(s) aujourd'hui`);

    // 3) Pour chacun, vérifier + envoyer
    for (const client of candidats) {
      // Skip si opt-out
      if (client.sms_optin === false) {
        stats.deja_envoye++;
        continue;
      }
      // Skip si pas de tél
      if (!client.telephone) {
        stats.sans_tel++;
        continue;
      }
      // Skip si déjà envoyé cette année
      if (client.anniv_sms_annee === anneeAct) {
        stats.deja_envoye++;
        continue;
      }

      // Générer le SMS
      let sms;
      try {
        if (params.mode_message === 'manuel' && params.message_manuel) {
          sms = params.message_manuel
            .replace(/\[Pr[ée]nom\]/gi, client.nom)
            .replace(/\[Code\]/gi, params.offre_code)
            .replace(/\[Offre\]/gi, params.offre_texte);
        } else {
          // IA via Claude
          sms = await genererSMSAnniversaire(client.nom, params.offre_texte, params.offre_code);
        }

        if (!sms || sms.length < 10) throw new Error('SMS vide ou trop court');
        if (sms.length > 612) sms = sms.substring(0, 612);

        // Envoyer via Brevo
        const resultat = await envoyerSMS(client.telephone, sms);

        if (resultat.ok) {
          stats.envoyes++;
          // Marquer comme envoyé pour cette année
          await sb.from('clients')
            .update({ anniv_sms_annee: anneeAct })
            .eq('id', client.id);

          // Log
          await sb.from('sms_logs').insert({
            restaurant_id: RESTO_ID,
            client_id: client.id,
            type: 'anniversaire',
            numero: resultat.numero,
            texte: sms,
            statut: 'envoye',
            brevo_id: resultat.messageId,
            cout_sms: resultat.cout || 1
          });
          console.log(`  ✅ ${client.nom} : SMS envoyé`);
        } else {
          stats.erreurs++;
          await sb.from('sms_logs').insert({
            restaurant_id: RESTO_ID,
            client_id: client.id,
            type: 'anniversaire',
            numero: client.telephone,
            texte: sms,
            statut: 'echec',
            erreur: resultat.erreur
          });
          console.log(`  ❌ ${client.nom} : ${resultat.erreur}`);
        }
      } catch (e) {
        stats.erreurs++;
        console.log(`  ❌ ${client.nom} : ${e.message}`);
      }

      // Petite pause entre chaque envoi
      await new Promise(r => setTimeout(r, 300));
    }

    return reponseOk({ message: 'Cron anniversaires terminé', stats });
  } catch (e) {
    console.error('Erreur cron anniversaires:', e);
    return reponseErr(e.message);
  }
};

// ============================================================
// HELPERS
// ============================================================

async function genererSMSAnniversaire(prenom, offre, code) {
  if (!ANTHROPIC_API_KEY) {
    // Fallback sans IA
    return `🎂 Bon anniversaire ${prenom} ! On te souhaite une superbe journée. Pour la fêter, on t'offre ${offre} avec le code ${code} chez Gin Khao. À très vite 🍜`;
  }

  const prompt = `Tu es un assistant marketing pour le restaurant Gin Khao (street food thaï, Marseille). Rédige UN SEUL SMS court (max 160 caractères, sinon coupé en 2 SMS = plus cher). Pour souhaiter bon anniversaire à ${prenom}. Offre à mentionner : ${offre}. Code promo OBLIGATOIRE : ${code}. Ton chaleureux, direct, restaurant thaï décontracté. Tu peux utiliser des emojis (max 2). Réponds UNIQUEMENT avec le texte du SMS, sans guillemets ni commentaire.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

async function envoyerSMS(numero, texte) {
  // Normalise le numéro
  let n = numero.replace(/[\s\-\.\(\)]/g, '');
  if (n.startsWith('0')) n = '+33' + n.substring(1);
  else if (!n.startsWith('+')) n = '+' + n;

  const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: 'GinKhao',
      recipient: n,
      content: texte,
      type: 'transactional',
      unicodeEnabled: true
    })
  });

  const d = await res.json();
  if (!res.ok) {
    return { ok: false, erreur: d.message || d.code || 'Erreur Brevo' };
  }
  return { ok: true, numero: n, messageId: d.messageId, cout: d.smsCount || 1 };
}

function reponseOk(body) {
  return { statusCode: 200, body: JSON.stringify(body) };
}
function reponseErr(msg) {
  return { statusCode: 500, body: JSON.stringify({ ok: false, erreur: msg }) };
}
