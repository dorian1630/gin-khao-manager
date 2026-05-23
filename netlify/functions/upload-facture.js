// netlify/functions/upload-facture.js
// Dépose une image de facture dans Google Drive (via compte de service)

import { google } from "googleapis";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "Upload Drive actif ✅" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { image, mediaType, nom } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ erreur: "Aucune image reçue." }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Authentification du robot
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    const drive = google.drive({ version: "v3", auth });

    // Conversion base64 -> flux
    const buffer = Buffer.from(image, "base64");
    const { Readable } = await import("stream");
    const stream = Readable.from(buffer);

    // Dépôt du fichier
    const fichier = await drive.files.create({
      requestBody: {
        name: nom || `facture-${Date.now()}.jpg`,
        parents: [process.env.GDRIVE_FOLDER_ID]
      },
      media: {
        mimeType: mediaType || "image/jpeg",
        body: stream
      },
      fields: "id, name, webViewLink"
    });

    return new Response(JSON.stringify({
      ok: true,
      id: fichier.data.id,
      lien: fichier.data.webViewLink
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ erreur: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
