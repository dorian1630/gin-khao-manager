// netlify/functions/envoi-comptable.js
// Envoie au comptable le lien du tableau + dossier de factures
import { google } from "googleapis";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "Envoi comptable actif ✅" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { emailComptable, mois } = await req.json();
    if (!emailComptable) {
      return json({ erreur: "Email du comptable manquant." });
    }

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const lienSheet = `https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit`;
    const lienDrive = `https://drive.google.com/drive/folders/${process.env.GDRIVE_FOLDER_ID}`;
    const periode = mois || new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

    const sujet = `Factures Gin Khao - ${periode}`;
    const corps = `Bonjour,

Veuillez trouver les factures du restaurant Gin Khao pour ${periode}.

Tableau récapitulatif (date, fournisseur, HT, TVA, TTC) :
${lienSheet}

Dossier des justificatifs (images des factures) :
${lienDrive}

Chaque ligne du tableau contient un lien vers la facture correspondante.

Bien cordialement,
Gin Khao`;

    // Construction de l'email au format MIME
    const message = [
      `To: ${emailComptable}`,
      `Subject: =?UTF-8?B?${Buffer.from(sujet).toString("base64")}?=`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      corps
    ].join("\n");

    const encoded = Buffer.from(message).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encoded }
    });

    return json({ ok: true });

  } catch (err) {
    return json({ erreur: err.message }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json" }
  });
}
