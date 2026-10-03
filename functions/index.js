const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const { PKPass } = require("passkit-generator");

admin.initializeApp();

const APPLE_WWDR_B64 = defineSecret("APPLE_WWDR_B64");
const APPLE_PASS_CERT_B64 = defineSecret("APPLE_PASS_CERT_B64");
const APPLE_PASS_KEY_B64 = defineSecret("APPLE_PASS_KEY_B64");
const APPLE_PASS_KEY_PASSPHRASE = defineSecret("APPLE_PASS_KEY_PASSPHRASE");
const GOOGLE_WALLET_SERVICE_ACCOUNT_B64 = defineSecret("GOOGLE_WALLET_SERVICE_ACCOUNT_B64");

const APPLE_PASS_TYPE_ID = defineString("APPLE_PASS_TYPE_ID", { default: "" });
const APPLE_TEAM_ID = defineString("APPLE_TEAM_ID", { default: "" });
const GOOGLE_WALLET_ISSUER_ID = defineString("GOOGLE_WALLET_ISSUER_ID", { default: "" });

const ALLOWED_ORIGINS = new Set([
  "https://albertotabacchi.com",
  "https://www.albertotabacchi.com"
]);

const ICON = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAaElEQVR42u3QMQEAIAgAMCSBv/0jmA96wBZh599XsVjGcgIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgYIIGitYCX4ORxSsAAAAASUVORK5CYII=", "base64");

function cors(req, res) {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
}

async function authenticatedCustomer(req) {
  const authHeader = String(req.get("authorization") || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Accesso richiesto."), { status: 401 });
  const decoded = await admin.auth().verifyIdToken(match[1]);
  const code = "ALB" + decoded.uid.slice(0, 10).toUpperCase();
  const snap = await admin.firestore().doc("fidelityCustomers/" + code).get();
  if (!snap.exists) throw Object.assign(new Error("Profilo Alberto non trovato."), { status: 404 });
  return { uid: decoded.uid, code, data: snap.data() || {} };
}

function safeObjectSuffix(code) {
  return String(code).replace(/[^A-Za-z0-9._-]/g, "_");
}

function applePass(customer) {
  const passTypeIdentifier = APPLE_PASS_TYPE_ID.value();
  const teamIdentifier = APPLE_TEAM_ID.value();
  if (!passTypeIdentifier || !teamIdentifier) {
    throw Object.assign(new Error("Apple Wallet non ancora configurato."), { status: 503 });
  }

  const name = [customer.data.name, customer.data.surname].filter(Boolean).join(" ") || "Cliente Alberto";
  const passJson = {
    formatVersion: 1,
    passTypeIdentifier,
    serialNumber: customer.code,
    teamIdentifier,
    organizationName: "Alberto",
    description: "Tessera cliente Alberto",
    logoText: "ALBERTO",
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: "rgb(181,16,27)",
    labelColor: "rgb(255,255,255)",
    storeCard: {
      primaryFields: [
        { key: "member", label: "CLIENTE", value: name }
      ],
      secondaryFields: [
        { key: "code", label: "CODICE ALBERTO", value: customer.code }
      ],
      backFields: [
        { key: "help", label: "UTILIZZO", value: "Mostra questo QR in cassa per identificarti, usare il Portafoglio Alberto e accumulare punti." },
        { key: "site", label: "AREA CLIENTI", value: "https://albertotabacchi.com/areaclienti.html" }
      ]
    }
  };

  const pass = new PKPass(
    {
      "icon.png": ICON,
      "icon@2x.png": ICON,
      "pass.json": Buffer.from(JSON.stringify(passJson))
    },
    {
      wwdr: Buffer.from(APPLE_WWDR_B64.value(), "base64"),
      signerCert: Buffer.from(APPLE_PASS_CERT_B64.value(), "base64"),
      signerKey: Buffer.from(APPLE_PASS_KEY_B64.value(), "base64"),
      signerKeyPassphrase: APPLE_PASS_KEY_PASSPHRASE.value()
    }
  );

  pass.setBarcodes({
    message: customer.code,
    format: "PKBarcodeFormatQR",
    messageEncoding: "iso-8859-1",
    altText: customer.code
  });

  return pass.getAsBuffer();
}

function googleWalletUrl(customer) {
  const issuerId = GOOGLE_WALLET_ISSUER_ID.value();
  if (!issuerId) throw Object.assign(new Error("Google Wallet non ancora configurato."), { status: 503 });

  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(GOOGLE_WALLET_SERVICE_ACCOUNT_B64.value(), "base64").toString("utf8"));
  } catch {
    throw Object.assign(new Error("Credenziali Google Wallet non valide."), { status: 503 });
  }

  const classId = issuerId + ".alberto_fidelity";
  const objectId = issuerId + "." + safeObjectSuffix(customer.code);
  const name = [customer.data.name, customer.data.surname].filter(Boolean).join(" ") || "Cliente Alberto";

  const genericClass = { id: classId };
  const genericObject = {
    id: objectId,
    classId,
    state: "ACTIVE",
    cardTitle: {
      defaultValue: { language: "it-IT", value: "ALBERTO" }
    },
    header: {
      defaultValue: { language: "it-IT", value: name }
    },
    subheader: {
      defaultValue: { language: "it-IT", value: "Tessera cliente" }
    },
    barcode: {
      type: "QR_CODE",
      value: customer.code,
      alternateText: customer.code
    },
    hexBackgroundColor: "#B5101B",
    textModulesData: [
      {
        id: "code",
        header: "CODICE ALBERTO",
        body: customer.code
      },
      {
        id: "usage",
        header: "UTILIZZO",
        body: "Mostra il QR in cassa per identificarti, usare il Portafoglio Alberto e accumulare punti."
      }
    ],
    linksModuleData: {
      uris: [
        {
          uri: "https://albertotabacchi.com/areaclienti.html",
          description: "Apri Area Clienti"
        }
      ]
    }
  };

  const claims = {
    iss: credentials.client_email,
    aud: "google",
    origins: ["https://albertotabacchi.com", "https://www.albertotabacchi.com"],
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    payload: {
      genericClasses: [genericClass],
      genericObjects: [genericObject]
    }
  };

  const token = jwt.sign(claims, credentials.private_key, { algorithm: "RS256" });
  return "https://pay.google.com/gp/v/save/" + token;
}

exports.walletPass = onRequest(
  {
    region: "us-central1",
    secrets: [
      APPLE_WWDR_B64,
      APPLE_PASS_CERT_B64,
      APPLE_PASS_KEY_B64,
      APPLE_PASS_KEY_PASSPHRASE,
      GOOGLE_WALLET_SERVICE_ACCOUNT_B64
    ]
  },
  async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "GET") return res.status(405).json({ error: "Metodo non supportato." });

    try {
      const customer = await authenticatedCustomer(req);
      const platform = String(req.query.platform || "").toLowerCase();

      if (platform === "apple") {
        const buffer = applePass(customer);
        res.set("Content-Type", "application/vnd.apple.pkpass");
        res.set("Content-Disposition", 'attachment; filename="Alberto-' + customer.code + '.pkpass"');
        return res.status(200).send(buffer);
      }

      if (platform === "google") {
        return res.json({ url: googleWalletUrl(customer) });
      }

      return res.status(400).json({ error: "Piattaforma non valida." });
    } catch (error) {
      console.error(error);
      return res.status(error.status || 500).json({ error: error.message || "Errore Wallet." });
    }
  }
);
