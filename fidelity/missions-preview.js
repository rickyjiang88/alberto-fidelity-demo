/**
 * Alberto Fidelity — motore missioni (modalità sola lettura).
 * Nessuna funzione scrive sul database o accredita punti.
 * Date interpretate nel fuso Europe/Rome; settimane lunedì-domenica.
 */
export const RULES = Object.freeze({
  pointsPerEuro: 1,
  fridayPurchaseMultiplier: 2,
  threeLunchesBonus: 5,
  fiveConsecutiveLunchesBonus: 10,
  doubleVisitBonus: 5,
  referralBonus: 15,
  rewardThreshold: 300,
  rewardEuro: 10
});
const zone = 'Europe/Rome';
const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
function dayKey(value) {
  const d = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
  if (!Number.isFinite(d.getTime())) return null;
  const p = Object.fromEntries(fmt.formatToParts(d).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,weekday:p.weekday};
}
const basePoints = amount => Math.floor(Math.max(0,Number(amount)||0));
function mondayOf(date) {
  const d = new Date(date+'T12:00:00Z');
  const weekday = d.getUTCDay();
  d.setUTCDate(d.getUTCDate()-((weekday+6)%7));
  return d.toISOString().slice(0,10);
}
function nextDate(date) {const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
/**
 * Movimenti già registrati, per un solo cliente. Il tipo pasto DEVE essere
 * dichiarato esplicitamente: non dedurlo dall'ora dello scontrino.
 * `mealType`: lunch | breakfast; altri tipi non contribuiscono alle missioni.
 */
export function previewWeeklyMissions(transactions, weekMonday) {
  const purchases = (transactions||[]).filter(t=>['receipt','wallet_purchase'].includes(t.type));
  const week = weekMonday || mondayOf(dayKey(new Date()).date);
  const lunchDays = new Set(), breakfastDays = new Set();
  let fridayExtraMissing = 0, unclassified = 0;
  for(const t of purchases){
    const date = dayKey(t.createdAt);
    if(!date || mondayOf(date.date)!==week) continue;
    const meal = String(t.mealType||'').toLowerCase();
    if(date.weekday==='Fri' && !t.fridayBonusAwarded && !t.fridayExtraAwarded) fridayExtraMissing += basePoints(t.amount);
    if(meal==='lunch') {
      lunchDays.add(date.date);
    } else if(meal==='breakfast') breakfastDays.add(date.date);
    else unclassified++;
  }
  const consecutiveFive = [0,1,2,3,4].reduce((acc,i)=>{
    let date=week;for(let j=0;j<i;j++)date=nextDate(date);
    return acc&&lunchDays.has(date);
  },true);
  const bothDays=[...lunchDays].filter(d=>breakfastDays.has(d)).length;
  const threeBonus=lunchDays.size>=3?RULES.threeLunchesBonus:0;
  const fiveBonus=consecutiveFive?RULES.fiveConsecutiveLunchesBonus:0;
  const doubleBonus=bothDays>=2?RULES.doubleVisitBonus:0;
  return {week, lunchDays:lunchDays.size, bothDays, unclassified,
    fridayExtraPotential:fridayExtraMissing,
    threeLunchesPotential:threeBonus,
    fiveLunchesPotential:fiveBonus,
    doubleVisitPotential:doubleBonus,
    potentialTotal:fridayExtraMissing+threeBonus+fiveBonus+doubleBonus,
    status:'PREVIEW_ONLY_NO_CREDIT'};
}
export function previewPurchase(amount,mealType,when=new Date()){
  const date=dayKey(when),base=basePoints(amount);
  const fridayExtra=(date?.weekday==='Fri')?base:0;
  return {base,fridayExtra,total:base+fridayExtra,status:'PREVIEW_ONLY_NO_CREDIT'};
}
