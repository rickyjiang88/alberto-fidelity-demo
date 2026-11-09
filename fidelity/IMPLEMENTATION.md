# Alberto Fidelity — preparazione senza accrediti

Questa branch è una bozza tecnica, NON pubblicata e NON collegata al sistema di accredito.

## Regole
- 1 punto per ogni euro intero di spesa idonea.
- Venerdì a pranzo: doppio dei punti base.
- 3 giorni distinti con pranzo nella settimana: +5.
- Pranzo dal lunedì al venerdì (5 giorni consecutivi): +10, cumulabile con +5.
- Colazione e pranzo nello stesso giorno per almeno 2 giorni nella settimana: +5.
- Invito collega: +15 (da attivare solo dopo verifica del primo acquisto).
- 300 punti: credito premio di 10 euro.

## Sicurezza prima della pubblicazione
1. Definire i prodotti idonei (esclusi tabacchi, servizi e convenzioni).
2. Aggiungere nel pannello un campo obbligatorio 'colazione / pranzo / altro' per gli scontrini.
3. Salvare un identificatore univoco per ciascun acquisto e ciascuna missione; impedire doppio accredito.
4. Mostrare nel pannello un'anteprima dei bonus da recuperare e richiedere conferma esplicita.
5. Per lo storico senza tipo pasto, NON attribuire automaticamente missioni in base all'orario.
6. Calcolare i premi in transazioni atomiche lato server, non soltanto dal browser.
7. Mostrare nell'app clienti saldo, missioni e storico, soltanto dopo i test.

## Stato
Creato il modulo di anteprima in `fidelity/missions-preview.js`. Non effettua scritture su Firestore e non è collegato alla pagina amministratore o all'app clienti. Non è ancora un sistema completo né pronto per l'uso in produzione.
