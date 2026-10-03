# Alberto Wallet backend

Backend Firebase Functions per generare la tessera Alberto con lo stesso QR del profilo cliente.

## Apple Wallet

Impostare:
- `APPLE_PASS_TYPE_ID`
- `APPLE_TEAM_ID`
- secret `APPLE_WWDR_B64`
- secret `APPLE_PASS_CERT_B64`
- secret `APPLE_PASS_KEY_B64`
- secret `APPLE_PASS_KEY_PASSPHRASE`

I certificati/chiavi vanno convertiti in Base64 prima di salvarli come secret. Non inserirli mai nel repository.

## Google Wallet

Impostare:
- `GOOGLE_WALLET_ISSUER_ID`
- secret `GOOGLE_WALLET_SERVICE_ACCOUNT_B64`

Il secret contiene il JSON della service account codificato Base64. L'account emittente Google Wallet deve essere abilitato; in modalità demo i pass restano di test.

## Deploy

Dalla root del progetto Firebase:
```
firebase deploy --only functions:walletPass
```

La pagina ufficiale usa:
`https://us-central1-alberto-tabacchi.cloudfunctions.net/walletPass`

La funzione verifica il Firebase ID token del cliente e genera il pass solo per il profilo autenticato.
