// netlify/functions/upload-facture.js
import { google } from "googleapis";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "Upload Drive actif ✅" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { image, mediaType, nom } = await req.json();
    console.log("1. Image reçue ?", image ? "OUI (" + image.length + " caractères)" : "NON");
    console.log("2. Dossier cible:", process.env.GDRIVE_FOLDER_ID);

    if (!image) {
      return new Response(JSON.stringify({ erreur: "Aucune image reçue." }), { headers: { "Content-Type": "application/json" } });
    }

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    console.log("3. Robot email:", credentials.client_email);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    const drive = google.drive({ version: "v3", auth });

    const buffer = Buffer.from(image, "base64");
    const { Readable } = await import("stream");
    const stream = Readable.from(buffer);

    console.log("4. Tentative d'upload...");
    const fichier = await drive.files.create({
      requestBody: {
        name: nom || `facture-${Date.now()}.jpg`,
        parents: [process.env.GDRIVE_FOLDER_ID]
      },
      media: { mimeType: mediaType || "image/jpeg", body: stream },
      fields: "id, name, webViewLink",
      supportsAllDrives: true
    });

    console.log("5. SUCCÈS ! Fichier ID:", fichier.data.id);
    return new Response(JSON.stringify({ ok: true, id: fichier.data.id, lien: fichier.data.webViewLink }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.log("❌ ERREUR:", err.message);
    return new Response(JSON.stringify({ erreur: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
