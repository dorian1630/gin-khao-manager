// netlify/functions/cron-demande-avis.js
// ============================================================
// CRON : Envoie un SMS de demande d'avis 2h après chaque vente
// ============================================================
// Programmé pour s'exécuter TOUTES LES HEURES
// Cible : clients ayant fait une vente il y a ~2h, avec téléphone
// ============================================================

const { createClient } = require('@supabase/supabase-js');

exports.config = {
  schedule: '0 * * * *'  // Toutes les heures (à HH:00)
};

const RESTO_ID = 'gin-khao';
const TYPE = 'avis';
// On vise les ventes faites entre il y a 2h30 et il y a 1h30 (fenêtre d'1h)
const HEURE_MIN = 1.5;
const HEURE_MAX = 2.5;
// Délai minimum entre 2 demandes d'avis (en jours)
const JOURS_MIN_ENTRE_AVIS = 90;

exports.handler = async function () {
  const SUPA_URL = process.env.SUPABASE_URL || process.env.SB_URL || 'https://szpgbdnijyoquqmjhhjj.supabase.co';
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BREVO_KEY = process.env.BREVO_API_KEY;
  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SUPA_KEY) return jsonResp(500, { ok: false, erreur: 'SUPABASE_SERVICE_KEY manquante' });
  if (!BREVO_KEY) return jsonResp(500, { ok: false, erreur: 'BREVO_API_KEY manquante' });

  const sb = createClient(SUPA_URL, SUPA_KEY);

  try {
    // 1. Vérifier que l'auto est activée
    const { data: params } = await sb.from('parametres_sms')
      .select('auto_avis').eq('restaurant_id', RESTO_ID).single();
    if (!params || !params.auto_avis) {
      return jsonResp(200, { ok: true, message: 'Auto avis désactivée', envoyes: 0 });
    }

    // 2. Fenêtre temporelle pour les ventes
    const now = new Date();
    const debutFenetre = new Date(now.getTime() - HEURE_MAX * 3600 * 1000);
    const finFenetre = new Date(now.getTime() - HEURE_MIN * 3600 * 1000);

    // 3. Cherche les ventes faites dans la fenêtre, avec client_id non null
    //    Si vous n'avez pas encore de client_id dans ventes, ce cron ne fera rien
    //    (à brancher dans une étape suivante)
    const { data: ventes, error: errVentes } = await sb.from('ventes')
      .select('id, client_id, total, cree_le')
      .eq('restaurant_id', RESTO_ID)
      .not('client_id', 'is', null)
      .gte('cree_le', debutFenetre.toISOString())
      .lte('cree_le', finFenetre.toISOString());

    if (errVentes) throw errVentes;
    if (!ventes || ventes.length === 0) {
      return jsonResp(200, { ok: true, message: 'Aucune vente avec client dans la fenêtre', envoyes: 0 });
    }

    // 4. Récupérer les clients distincts (pas 2 SMS pour 2 ventes du même client dans la même heure)
    const clientIds = [...new Set(ventes.map(v => v.client_id))];

    // 5. Charger les clients
    const { data: clients } = await sb.from('clients')
      .select('id, nom, telephone, sms_optin, derniere_demande_avis_envoyee')
      .in('id', clientIds);

    const ilYa90j = new Date();
    ilYa90j.setDate(ilYa90j.getDate() - JOURS_MIN_ENTRE_AVIS);

    const aContacter = (clients || []).filter(c => {
      if (!c.telephone || c.sms_optin === false) return false;
      if (c.derniere_demande_avis_envoyee && new Date(c.derniere_demande_avis_envoyee) > ilYa90j) return false;
      return true;
    });

    if (aContacter.length === 0) {
      return jsonResp(200, { ok: true, message: 'Aucun client éligible pour demande d\'avis', envoyes: 0 });
    }

    // 6. Envoi SMS
    let envoyes = 0, echecs = 0;
    for (const c of aContacter) {
      try {
        const sms = `Salut ${c.nom} ! Merci pour ton passage chez Gin Khao 🍜 Si tu as aimé, ça nous aiderait beaucoup que tu laisses un avis Google : https://g.page/r/ginkhao/review Merci ❤️`;

        const r = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
          method: 'POST',
          headers: { 'accept': 'application/json', 'api-key': BREVO_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({
            sender: 'GinKhao',
            recipient: normaliserTel(c.telephone),
            content: sms,
            type: 'transactional',
            unicodeEnabled: true
          })
        });
        const data = await r.json();

        if (r.ok) {
          envoyes++;
          await sb.from('sms_logs').insert({
            restaurant_id: RESTO_ID, client_id: c.id, type: TYPE,
            numero: normaliserTel(c.telephone), texte: sms, statut: 'envoye',
            brevo_id: data.messageId, cout_sms: data.smsCount || 1
          });
          await sb.from('clients').update({ derniere_demande_avis_envoyee: new Date().toISOString().slice(0,10) }).eq('id', c.id);
        } else {
          echecs++;
          await sb.from('sms_logs').insert({
            restaurant_id: RESTO_ID, client_id: c.id, type: TYPE,
            numero: normaliserTel(c.telephone), texte: sms, statut: 'echec',
            erreur: data.message || JSON.stringify(data)
          });
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        echecs++;
      }
    }

    return jsonResp(200, { ok: true, envoyes, echecs, total: aContacter.length });
  } catch (e) {
    return jsonResp(500, { ok: false, erreur: e.message });
  }
};

function normaliserTel(t) {
  let c = String(t || '').replace(/[\s\-\.\(\)]/g, '');
  if (c.startsWith('0')) c = '+33' + c.substring(1);
  else if (!c.startsWith('+')) c = '+' + c;
  return c;
}

function jsonResp(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
