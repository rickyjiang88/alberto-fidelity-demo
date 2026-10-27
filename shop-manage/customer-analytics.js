import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, query, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ADMIN_UID = "vaQyMYFpkrNU0rsc6aGSnNTHmt43";
const app = getApps().find(a => a.options.projectId === "alberto-tabacchi") || getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const euro = n => new Intl.NumberFormat("it-IT", {style:"currency",currency:"EUR"}).format(n || 0);
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const asDate = value => {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  return Number.isFinite(date?.getTime?.()) ? date : null;
};
const italyDay = date => date ? new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).format(date) : "";
const italyHour = date => date ? Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Rome",hour:"2-digit",hourCycle:"h23"}).format(date)) : -1;
const simpleDate = date => date ? date.toLocaleDateString("it-IT",{timeZone:"Europe/Rome",day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
const timeRange = date => {
  const hour = italyHour(date);
  return hour >= 6 && hour < 11 ? "colazione" : hour >= 11 && hour < 15 ? "pranzo" : hour >= 15 && hour < 22 ? "aperitivo" : "altro";
};
const safeCustomerCode = code => String(code || "").trim().toUpperCase();
const now = () => new Date();
const isPurchase = t => ["receipt","wallet_purchase"].includes(String(t.type || ""));
let customers = [], transactions = [], loaded = false, loadingPromise = null, historyLimited = false;
let selectedDays = 30, searchPhrase = "", hideMarkedTests = true;
const root = () => document.getElementById("customerAnalytics");
const isAdmin = () => auth.currentUser?.uid === ADMIN_UID;
const profileName = c => [c.name,c.surname].filter(Boolean).join(" ").trim() || c.email || "Cliente Fidelity";
const isMarkedTest = c => c.isTest === true || c.testAccount === true || c.excludeFromStats === true || c.isDemo === true;
const latestOf = (...dates) => dates.filter(Boolean).sort((a,b)=>b-a)[0] || null;

async function readTransactions() {
  const out = []; let cursor = null, limited = false;
  for(let page=0;page<20;page++) {
    const parts = [collection(db,"fidelityTransactions"), orderBy("createdAt","desc")];
    if(cursor) parts.push(startAfter(cursor));
    parts.push(limit(500));
    const snap = await getDocs(query(...parts));
    snap.docs.forEach(d => out.push({id:d.id,...d.data()}));
    if(snap.size < 500) return {rows:out,limited:false};
    cursor = snap.docs[snap.docs.length-1];
    if(page === 19) limited = true;
  }
  return {rows:out,limited};
}
function setMessage(message) {
  const target = document.getElementById("caStatus");
  if(target) target.textContent = message;
}
window.loadCustomerAnalytics = async (force = false) => {
  if(!isAdmin()) return;
  if(loadingPromise) return loadingPromise;
  if(loaded && !force) { renderAnalytics(); return; }
  setMessage("Caricamento dati Fidelity…");
  loadingPromise = (async () => {
    try {
      const [customerSnap, txData] = await Promise.all([
        getDocs(collection(db,"fidelityCustomers")),
        readTransactions()
      ]);
      if(!isAdmin()) return;
      customers = customerSnap.docs.map(d => ({...d.data(),code:safeCustomerCode(d.id)}));
      transactions = txData.rows;
      historyLimited = txData.limited;
      loaded = true;
      renderAnalytics();
    } catch (e) {
      console.error("Analisi clienti",e);
      setMessage("Impossibile caricare i dati. Controlla la connessione e riprova con AGGIORNA.");
    } finally { loadingPromise = null; }
  })();
  return loadingPromise;
};
window.refreshCustomerAnalytics = () => {
  if(loaded && root()?.classList.contains("on") && isAdmin()) renderAnalytics();
};
window.setCustomerAnalyticsPeriod = days => {
  selectedDays = Number(days) || 0;
  document.querySelectorAll("[data-ca-period]").forEach(b=>b.classList.toggle("ca-active",Number(b.dataset.caPeriod)===selectedDays));
  if(loaded) renderAnalytics();
};
window.searchCustomerAnalytics = input => {searchPhrase = input.value.trim().toLowerCase();if(loaded) renderAnalytics();};
window.toggleCustomerAnalyticsTests = input => {hideMarkedTests = input.checked;if(loaded) renderAnalytics();};
window.openCustomerAnalyticsProfile = encoded => {
  const code = decodeURIComponent(encoded);
  if(!isAdmin() || !code) return;
  if(typeof window.tab === "function") window.tab("fidelityPanel");
  setTimeout(()=>window.openFidelityCustomer?.(code),50);
};

function renderAnalytics() {
  if(!isAdmin() || !loaded) return;
  const allOrders = window.getCustomerAnalyticsOrders?.() || {orders:[],bookings:[],ready:false};
  const customerRows = customers.filter(c=>!hideMarkedTests || !isMarkedTest(c));
  const lookup = new Map(customerRows.map(c=>[safeCustomerCode(c.code),c]));
  const uidCodes = new Map(customerRows.filter(c=>c.uid).map(c=>[c.uid,c.code]));
  const stats = new Map(customerRows.map(c=>[c.code,{
    customer:c, purchases:[], preorders:0, bookings:0, visitDays:new Set(), recent:null,
    lastPurchase:asDate(c.lastPurchaseAt), lastVisit:asDate(c.lastVisitAt), lifetime:0, frequencies:{colazione:0,pranzo:0,aperitivo:0,altro:0}
  }]));
  const cutoff = selectedDays ? new Date(now().getTime()-selectedDays*86400000) : new Date(0);
  const validDate = d => d && d >= cutoff && d <= now();
  const included = [];
  for(const t of transactions) {
    const record = stats.get(safeCustomerCode(t.customerCode));
    if(!record) continue;
    const date = asDate(t.createdAt);
    if(isPurchase(t) && Number(t.amount) > 0) {
      record.lifetime += Number(t.amount);
      if(date && (!record.lastPurchase || date>record.lastPurchase)) record.lastPurchase=date;
      if(date) record.visitDays.add(italyDay(date));
      if(date && validDate(date)) {
        const segment=timeRange(date);
        const purchase={date,amount:Number(t.amount),segment};
        included.push(purchase);
        record.purchases.push(purchase);
        record.frequencies[segment]++;
      }
    } else if(t.type === "booking_arrival" && date) {
      record.visitDays.add(italyDay(date));
      record.lastVisit=latestOf(record.lastVisit,date);
    }
  }
  if(allOrders.ready) {
    for(const o of allOrders.orders) {
      if(o.type === "TABLE_BOOKING" || ["ANNULLATO","ANNULLATA"].includes(String(o.status||"").toUpperCase())) continue;
      const code=safeCustomerCode(o.customerCode || uidCodes.get(o.customerUid));
      const record=stats.get(code);if(!record)continue;
      const when=asDate(o.createdAt);
      if(validDate(when))record.preorders++;
    }
    for(const b of allOrders.bookings) {
      if(b.bookingStatus !== "ARRIVATO") continue;
      const when=asDate(b.arrivedAt) || asDate((b.date||"")+"T"+(b.time||"12:00")+":00");
      const codes=Array.isArray(b.arrivalPointsCustomerCodes) ? b.arrivalPointsCustomerCodes : [];
      for(const code of new Set(codes.map(safeCustomerCode))) {
        const record=stats.get(code);if(!record)continue;
        if(when) {record.visitDays.add(italyDay(when));record.lastVisit=latestOf(record.lastVisit,when);}
        if(validDate(when))record.bookings++;
      }
    }
  }
  const totalSpent = included.reduce((sum,p)=>sum+p.amount,0);
  const buyers = [...stats.values()].filter(s=>s.purchases.length);
  const repeats = buyers.filter(s=>s.purchases.length>=2).length;
  const inactivity = [...stats.values()].filter(s=>{
    const last=latestOf(s.lastPurchase,s.lastVisit);
    return last && now()-last > 30*86400000;
  });
  const never = [...stats.values()].filter(s=>!s.lastPurchase && !s.lastVisit);
  const totalBy = {colazione:0,pranzo:0,aperitivo:0,altro:0};
  included.forEach(p=>totalBy[p.segment]++);
  const tiles=[
    ["CLIENTI REGISTRATI",customerRows.length,"Esclusi i profili contrassegnati come test"],
    ["CLIENTI CHE HANNO ACQUISTATO",buyers.length,"Acquisti Fidelity nel periodo"],
    ["SPESA REGISTRATA",euro(totalSpent),"Solo acquisti Fidelity, non incasso totale del bar"],
    ["SCONTRINO MEDIO",included.length?euro(totalSpent/included.length):"—",included.length+" acquisti registrati"],
    ["CLIENTI RIPETUTI",repeats,"Almeno 2 acquisti nel periodo"],
    ["INATTIVI OLTRE 30 GIORNI",inactivity.length,"In base all'ultima attività registrata"],
    ["SENZA ATTIVITÀ REGISTRATA",never.length,"Non equivale a cliente mai entrato"],
    ["PREORDINI ASSOCIATI",[...stats.values()].reduce((s,r)=>s+r.preorders,0),allOrders.ready?"Ordini online collegati a Fidelity":"Caricamento ordini…"]
  ];
  document.getElementById("caKpis").innerHTML=tiles.map(t=>'<div class="ca-kpi"><small>'+escapeHtml(t[0])+'</small><strong>'+escapeHtml(t[1])+'</strong><span>'+escapeHtml(t[2])+'</span></div>').join("");
  const segmentNames={colazione:"Colazione · 06–11",pranzo:"Pranzo · 11–15",aperitivo:"Pomeriggio / aperitivo · 15–22",altro:"Altri orari"};
  const max=Math.max(1,...Object.values(totalBy));
  document.getElementById("caSegments").innerHTML=Object.keys(totalBy).map(k=>
    '<div class="ca-bar-row"><div class="ca-bar-label"><b>'+segmentNames[k]+'</b><strong>'+totalBy[k]+' acquisti</strong></div><div class="ca-track"><div style="width:'+Math.round(100*totalBy[k]/max)+'%"></div></div></div>'
  ).join("");
  const weekdayCount=[0,0,0,0,0,0,0];
  included.forEach(p=>{
    const day=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Rome",weekday:"short"}).format(p.date);
    const index={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6}[day];
    if(index!==undefined)weekdayCount[index]++;
  });
  const dayMax=Math.max(1,...weekdayCount);
  document.getElementById("caWeekdays").innerHTML=["Lun","Mar","Mer","Gio","Ven","Sab","Dom"].map((d,i)=>
    '<div class="ca-day"><strong>'+weekdayCount[i]+'</strong><div class="ca-vertical-track"><div style="height:'+Math.round(100*weekdayCount[i]/dayMax)+'%"></div></div><small>'+d+'</small></div>'
  ).join("");
  const prospects=[
    ["DALLA COLAZIONE AL PRANZO","colazione","pranzo","Invita a scoprire il menu pranzo"],
    ["DAL PRANZO ALL’APERITIVO","pranzo","aperitivo","Proponi le combo aperitivo"],
    ["DALL’APERITIVO AL PRANZO","aperitivo","pranzo","Invita a provare il menu del giorno"]
  ];
  document.getElementById("caOpportunities").innerHTML=prospects.map(([title,has,missing,hint])=>{
    const matches=[...stats.values()].filter(r=>r.frequencies[has]>0 && r.frequencies[missing]===0)
      .sort((a,b)=>b.frequencies[has]-a.frequencies[has]).slice(0,8);
    return '<div class="ca-op-card"><h3>'+title+'</h3><p>'+hint+' · in base agli acquisti registrati nel periodo.</p>'+
      (matches.length?matches.map(r=>'<div class="ca-op-row"><b>'+escapeHtml(profileName(r.customer))+'</b><span>'+r.frequencies[has]+' acquisti · '+escapeHtml(r.customer.phone||r.customer.email||"")+'</span></div>').join(""):'<div class="ca-empty">Nessun cliente identificato.</div>')+'</div>';
  }).join("");
  const matched=[...stats.values()].filter(r=>{
    const c=r.customer;
    return !searchPhrase || [c.name,c.surname,c.email,c.phone,c.code].join(" ").toLowerCase().includes(searchPhrase);
  });
  matched.sort((a,b)=>(latestOf(b.lastPurchase,b.lastVisit)?.getTime()||0)-(latestOf(a.lastPurchase,a.lastVisit)?.getTime()||0));
  document.getElementById("caCustomers").innerHTML=matched.length?matched.slice(0,120).map(r=>{
    const last=latestOf(r.lastPurchase,r.lastVisit);
    const gap=last?Math.floor((now()-last)/86400000):null;
    const state=gap===null?"Dati insufficienti":gap>30?"Da recuperare":"Attivo";
    const encoded=encodeURIComponent(r.customer.code);
    return '<div class="ca-customer-row"><div><b>'+escapeHtml(profileName(r.customer))+'</b><small>'+escapeHtml(r.customer.phone||r.customer.email||r.customer.code)+'</small></div>'+
      '<div><strong>'+r.purchases.length+' acquisti</strong><small>'+euro(r.purchases.reduce((s,p)=>s+p.amount,0))+' nel periodo</small></div>'+
      '<div><strong>'+simpleDate(last)+'</strong><small>'+state+'</small></div>'+
      '<button type="button" onclick="window.openCustomerAnalyticsProfile(\''+encoded+'\')">SCHEDA</button></div>';
  }).join(""):'<p class="ca-empty">Nessun cliente corrispondente.</p>';
  document.getElementById("caCount").textContent=matched.length>120?"Mostrati 120 di "+matched.length+" clienti":"Clienti visualizzati: "+matched.length;
  setMessage("Aggiornato alle "+new Intl.DateTimeFormat("it-IT",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Rome"}).format(now())+". "+(historyLimited?"Storico movimenti limitato alle ultime 10.000 operazioni. ":"")+"Gli orari si riferiscono ad acquisti registrati, non a tutte le visite. Ricariche e bonus esclusi.");
}
onAuthStateChanged(auth, user=>{
  if(user?.uid !== ADMIN_UID) {
    customers=[];transactions=[];loaded=false;loadingPromise=null;
    for(const id of ["caKpis","caSegments","caWeekdays","caOpportunities","caCustomers"]){const el=document.getElementById(id);if(el)el.textContent="";}
  }
});
