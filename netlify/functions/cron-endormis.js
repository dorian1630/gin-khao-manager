// netlify/functions/cron-endormis.js
// ============================================================
// CRON HEBDOMADAIRE — Relance des clients endormis (lundi 11h)
// ============================================================
// Schedule : "0 11 * * 1" (configuré dans netlify.toml)
// Action : trouve les clients qui n'ont pas commandé depuis 30+ jours,
//          envoie max 10 SMS de relance par semaine (anti-spam)
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const RESTO_ID = 'gin-khao';
const SB_URL = process.env.SUPABASE_URL || 'https://szpgbdnijyoquqmjhhjj.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const MAX_RELANCES_PAR_SEMAINE = 10;
const JOURS_INACTIVITE = 30;
const JOURS_AVANT_NOUVELLE_RELANCE = 60;

exports.config = {
  schedule: '0 11 * * 1'  // Lundi 11h
};

exports.handler = async function (event) {
  console.log('😴 Cron endormis lancé à', new Date().toISOString());

  if (!SB_SERVICE_KEY) return reponseErr('SUPABASE_SERVICE_KEY manquant');
  if (!BREVO_API_KEY) return reponseErr('BREVO_API_KEY manquant');

  const sb = createClient(SB_URL, SB_SERVICE_KEY);
  const stats = { candidats: 0, envoyes: 0, erreurs: 0, skip: 0 };

  try {
    // 1) Vérifier l'activation
    const { data: params } = await sb.from('parametres_sms')
      .select('auto_endormi, offre_texte, offre_code, mode_message, message_manuel')
      .eq('restaurant_id', RESTO_ID).single();

    if (!params || !params.auto_endormi) {
      console.log('⏸️ Automatisation endormi désactivée');
      return reponseOk({ message: 'Automatisation désactivée', stats });
    }

    // 2) Calculer les seuils
    const aujourd = new Date();
    const limiteInactivite = new Date();
    limiteInactivite.setDate(limiteInactivite.getDate() - JOURS_INACTIVITE);

    const limiteNouvelleRelance = new Date();
    limiteNouvelleRelance.setDate(limiteNouvelleRelance.getDate() - JOURS_AVANT_NOUVELLE_RELANCE);

    // 3) Trouver les candidats
    const { data: candidats, error } = await sb.from('clients')
      .select('id, nom, telephone, derniere_visite, derniere_relance_envoyee, sms_optin')
      .eq('restaurant_id', RESTO_ID)
      .lt('derniere_visite', limiteInactivite.toISOString())
      .not('telephone', 'is', null)
      .order('derniere_visite', { ascending: true })
      .limit(50);  // marge pour filtrer ensuite

    if (error) throw error;

    // 4) Filtrer (opt-in + jamais relancé OU relancé il y a longtemps)
    const aRelancer = (candidats || []).filter(c => {
      if (c.sms_optin === false) return false;
      if (!c.derniere_relance_envoyee) return true;
      return new Date(c.derniere_relance_envoyee) < limiteNouvelleRelance;
    }).slice(0, MAX_RELANCES_PAR_SEMAINE);

    stats.candidats = aRelancer.length;
    console.log(`📊 ${aRelancer.length} clients à relancer cette semaine`);

    if (aRelancer.length === 0) {
      return reponseOk({ message: 'Aucun client à relancer', stats });
    }

    // 5) Envoyer les SMS
    for (const client of aRelancer) {
      try {
        let sms;
        if (params.mode_message === 'manuel' && params.message_manuel) {
          sms = params.message_manuel
            .replace(/\[Pr[ée]nom\]/gi, client.nom)
            .replace(/\[Code\]/gi, params.offre_code)
            .replace(/\[Offre\]/gi, params.offre_texte);
        } else {
          sms = await genererSMSEndormi(client.nom, params.offre_texte, params.offre_code, client.derniere_visite);
        }

        if (!sms || sms.length < 10) throw new Error('SMS vide ou trop court');
        if (sms.length > 612) sms = sms.substring(0, 612);

        const resultat = await envoyerSMS(client.telephone, sms);

        if (resultat.ok) {
          stats.envoyes++;
          await sb.from('clients')
            .update({ derniere_relance_envoyee: aujourd.toISOString().slice(0, 10) })
            .eq('id', client.id);

          await sb.from('sms_logs').insert({
            restaurant_id: RESTO_ID,
            client_id: client.id,
            type: 'endormi',
            numero: resultat.numero,
            texte: sms,
            statut: 'envoye',
            brevo_id: resultat.messageId,
            cout_sms: resultat.cout || 1
          });

          // 💰 Incrémenter la charge SMS du jour
          await sb.rpc('incrementer_charge_sms', {
            p_restaurant_id: RESTO_ID,
            p_cout_eur: 0.05 * (resultat.cout || 1),
            p_nb_sms: resultat.cout || 1
          });

          console.log(`  ✅ ${client.nom} : relance envoyée + comptabilisée`);
        } else {
          stats.erreurs++;
          await sb.from('sms_logs').insert({
            restaurant_id: RESTO_ID,
            client_id: client.id,
            type: 'endormi',
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
        // Logger même les exceptions JS pour le debug
        try {
          await sb.from('sms_logs').insert({
            restaurant_id: RESTO_ID,
            client_id: client.id,
            type: 'endormi',
            numero: client.telephone || 'inconnu',
            texte: '(non généré)',
            statut: 'echec',
            erreur: 'Exception JS : ' + e.message
          });
        } catch (e2) { console.error('Impossible de logger:', e2.message); }
      }
      await new Promise(r => setTimeout(r, 400));
    }

    return reponseOk({ message: 'Cron endormis terminé', stats });
  } catch (e) {
    console.error('Erreur cron endormis:', e);
    return reponseErr(e.message);
  }
};

async function genererSMSEndormi(prenom, offre, code, derniereVisite) {
  // Message de secours par défaut
  const messageDefaut = `🍜 ${prenom}, ça fait longtemps qu'on ne t'a pas vu chez Gin Khao ! On te réserve ${offre} avec le code ${code}. À très vite 🥢`;

  if (!ANTHROPIC_API_KEY) {
    console.log('⚠️ Pas de ANTHROPIC_API_KEY, message par défaut');
    return messageDefaut;
  }

  const moisAbsence = derniereVisite ? Math.floor((Date.now() - new Date(derniereVisite).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 1;

  const prompt = `Tu es un assistant marketing pour le restaurant Gin Khao (street food thaï, Marseille). Rédige UN SEUL SMS court (max 160 caractères). Pour relancer ${prenom}, un client qui n'est plus venu depuis environ ${moisAbsence} mois. Offre à mentionner : ${offre}. Code promo OBLIGATOIRE : ${code}. Ton chaleureux, pas culpabilisant, ne pas dire "tu nous trompes" mais plutôt "tu nous manques". Tu peux utiliser des emojis (max 2). Réponds UNIQUEMENT avec le texte du SMS.`;

  try {
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

    if (!res.ok) {
      const errText = await res.text();
      console.log('⚠️ Erreur Claude API ' + res.status + ' : ' + errText);
      return messageDefaut;
    }

    const data = await res.json();
    const sms = (data.content?.[0]?.text || '').trim();

    if (!sms || sms.length < 10) {
      console.log('⚠️ Claude a renvoyé un texte vide → message par défaut');
      return messageDefaut;
    }

    return sms;
  } catch (e) {
    console.log('⚠️ Exception Claude:', e.message);
    return messageDefaut;
  }
}

async function envoyerSMS(numero, texte) {
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
  if (!res.ok) return { ok: false, erreur: d.message || d.code || 'Erreur Brevo' };
  return { ok: true, numero: n, messageId: d.messageId, cout: d.smsCount || 1 };
}

function reponseOk(body) {
  return { statusCode: 200, body: JSON.stringify(body) };
}
function reponseErr(msg) {
  return { statusCode: 500, body: JSON.stringify({ ok: false, erreur: msg }) };
}
