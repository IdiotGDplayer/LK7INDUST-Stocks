/* script.js - Final Sandbox Build */

// CONFIG
const AUTO_ORDER_INTERVAL = 10000; // 10s
const AUTOSAVE_MIN = 5000; // 5s
const AUTOSAVE_MAX = 10000; // 10s
const MAX_HISTORY = 60;
const KEY_PLAYER = 'mob_player_vfinal';
const KEY_HOST = 'hostData_LK7';
const INVEST_SMALL_THRESH = 10000;
const INVEST_MED_THRESH = 50000;
const MILESTONE_NETWORTH = 100_000_000;

// UTIL
const uuid = ()=> 'id_'+Math.random().toString(36).slice(2,9);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const n = x => (Math.round(x)).toLocaleString();
const rand = (a,b)=> Math.floor(Math.random()*(b-a+1))+a;
const now = ()=>Date.now();

// STATE: separate host and player
let HOST = loadHost(); // hostData_LK7
let STATE = loadPlayer(); // player data
let ORES_SRC = window.ORES && Object.keys(window.ORES).length ? window.ORES : null;

// Ensure resources loaded into STATE
function seedResources(){
  if(!STATE.resources || Object.keys(STATE.resources).length===0){
    STATE.resources = {};
    const src = ORES_SRC || {
      coal:{display:'Coal', symbol:'CO', baseValueRange:[10,20], demand:80, commonness:90, volatility:1.0, crashDepth:0.2, recovery:0.8, maxSupply:20000},
      iron:{display:'Iron', symbol:'Fe', baseValueRange:[50,120], demand:60, commonness:70, volatility:1.2, crashDepth:0.25, recovery:0.7, maxSupply:10000},
      gold:{display:'Gold', symbol:'Au', baseValueRange:[200,800], demand:40, commonness:30, volatility:1.6, crashDepth:0.35, recovery:0.6, maxSupply:5000}
    };
    for(const k in src){
      const r = JSON.parse(JSON.stringify(src[k]));
      r.key = k;
      r.stockLevel = r.stockLevel || clamp(0.6 + Math.random()*0.3, 0.02, 1);
      r.history = r.history || [];
      STATE.resources[k] = r;
    }
    savePlayer();
  }
}

// PERSISTENCE
function loadHost(){ try{ const raw = localStorage.getItem(KEY_HOST); return raw?JSON.parse(raw):{ ores:{}, marketMode:'Common', unlocked:false, mode:'easy' }; }catch(e){ return { ores:{}, marketMode:'Common', unlocked:false, mode:'easy' }; } }
function saveHost(){ localStorage.setItem(KEY_HOST, JSON.stringify(HOST)); }

function loadPlayer(){ try{ const raw = localStorage.getItem(KEY_PLAYER); if(raw) return JSON.parse(raw); }catch(e){} return { player:{id:uuid(), name:'You', balance:20000, xp:0, level:1, companyId:null}, resources:{}, orders:[], completedOrders:[], investments:[], companies:[], settings:{autoTick:true, autoOrders:true, tickMs:3000}, lastTick:now(), lastAuto:0 }; }
function savePlayer(){ localStorage.setItem(KEY_PLAYER, JSON.stringify(STATE)); }

// AUTOSAVE every 5-10s randomized
setInterval(()=>{ savePlayer(); saveHost(); flash('Autosaved'); }, rand(AUTOSAVE_MIN, AUTOSAVE_MAX));

// SHORT DOM HELPER
const $ = id => document.getElementById(id);

// INIT
function init(){
  seedResources();
  bindUI();
  renderAll();
  loop();
}

// BIND UI
function bindUI(){
  $('genBtn').addEventListener('click', ()=> createOrder());
  $('speedRange').addEventListener('input', e=> STATE.settings.tickMs = Number(e.target.value));
  $('raritySelect').addEventListener('change', ()=> {});
  $('exportBtn').addEventListener('click', exportPlayerData);
  $('importInput').addEventListener('change', handleImport);
  $('createCompanyBtn').addEventListener('click', createCompany);
  $('leaveCompanyBtn').addEventListener('click', leaveCompany);
  $('companyInvestBtn').addEventListener('click', ()=> openInvestModal('company'));
  $('exportOresBtn').addEventListener('click', ()=> exportOresJS());
  $('addOreBtn').addEventListener('click', ()=> hostAddOre());
  $('clearHostBtn').addEventListener('click', ()=> { if(confirm('Clear host data?')){ HOST={ores:{},marketMode:'Common',unlocked:false,mode:'easy'}; saveHost(); renderAll(); } });

  // Host button
  const hostBtn = document.getElementById('hostBtn');
  hostBtn.addEventListener('click', ()=> {
    const p = prompt('Host password:');
    if(p === 'LK7'){ HOST.unlocked = true; saveHost(); renderAll(); flash('Host unlocked'); }
    else alert('Wrong password');
  });

  // host panel placeholder (ore maker renders into page)
  // Nothing else needed; ore maker uses HOST.unlocked
}

// RENDERING
function renderAll(){
  renderPlayerUI();
  renderStocks();
  renderOrders();
  renderCompanies();
  renderInvestments();
  renderOreMaker();
  renderLeaderboard();
}

function renderPlayerUI(){
  $('balance').textContent = '$' + n(STATE.player.balance);
  $('levelDisplay').textContent = STATE.player.level;
  const next = xpForLevel(STATE.player.level+1);
  $('xpDisplay').textContent = `XP: ${n(STATE.player.xp)} / ${n(next)}`;
  $('networth').textContent = 'Net Worth: $' + n(Math.round(calcNetWorth()));
}

function renderStocks(){
  const wrap = $('stocksList'); wrap.innerHTML = '';
  for(const key of Object.keys(STATE.resources)){
    const r = STATE.resources[key];
    const price = calcPricePerUnit(key, 1);
    const div = document.createElement('div'); div.className='stock';
    div.innerHTML = `
      <div class="sym" title="${r.display}">${r.symbol||r.display.slice(0,2)}</div>
      <div class="meta">
        <div class="name">${r.display} <span class="small muted">(${key})</span></div>
        <div class="sub small">${Math.round((1 - (r.stockLevel||0.5))*100)}% scarcity • est supply: ${Math.round((r.stockLevel||0.5)*(r.maxSupply||1000))}</div>
      </div>
      <canvas class="spark" id="spark_${key}"></canvas>
      <div class="price">$${n(price)}/unit</div>
    `;
    div.addEventListener('click', ()=> openInvestModal('player', key));
    wrap.appendChild(div);
    drawSpark(r.history, document.getElementById(`spark_${key}`));
  }
}

function renderOrders(){
  const wrap = $('ordersList'); wrap.innerHTML = '';
  STATE.orders.forEach(order=>{
    const r = STATE.resources[order.resource] || { display:order.resource, symbol:order.resource.slice(0,2).toUpperCase() };
    const card = document.createElement('div'); card.className='order-card';
    card.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center">
        <div style="width:64px;height:64px;background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-weight:800">${r.symbol||r.display.slice(0,2)}</div>
          <div class="small-muted" style="font-size:12px">${r.display}</div>
        </div>
        <div>
          <div style="font-weight:800">${order.qty} x ${r.display}</div>
          <div class="small-muted">tier: ${order.tier} • created: ${new Date(order.createdAt).toLocaleTimeString()}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <div class="tag">Est: <b style="margin-left:6px">$${n(order.total)}</b></div>
        </div>
        <div style="display:flex;gap:6px">
          ${order.accepted ? (order.completed ? '<div class="tag">Completed</div>' : '<button class="complete">Complete</button><button class="cancel">Cancel</button>') : '<button class="accept">Accept</button><button class="cancel">Decline</button>'}
        </div>
      </div>
    `;
    wrap.appendChild(card);
    // button actions
    const btns = card.querySelectorAll('button');
    btns.forEach(b=>{
      if(b.textContent==='Accept'){ b.addEventListener('click', ()=>{ order.accepted=true; order.lockedPrice = order.total; savePlayer(); renderOrders(); flash('Order accepted'); }); }
      if(b.textContent==='Decline'){ b.addEventListener('click', ()=> declineOrder(order.id)); }
      if(b.textContent==='Complete'){ b.addEventListener('click', ()=> completeOrder(order.id)); }
      if(b.textContent==='Cancel'){ b.addEventListener('click', ()=> { if(confirm('Cancel order?')){ removeOrder(order.id); } }); }
    });
  });
}

function renderCompanies(){
  const panel = $('companyPanel');
  const comp = STATE.companies.find(c=>c.id===STATE.player.companyId);
  const ci = $('companyInfo');
  if(!comp) ci.innerHTML = `<div class="small-muted">No company joined.</div>`;
  else ci.innerHTML = `<div style="font-weight:800">${comp.name}</div><div class="small-muted">Net: $${n(Math.round(comp.netWorth||0))} • PF: ${pf(comp).toFixed(2)}</div><div class="small-muted">Members: ${comp.members.join(', ')}</div>`;

  const wrap = $('companyList'); wrap.innerHTML = '';
  const combined = STATE.companies.concat((window.SERVER_DATA && window.SERVER_DATA.companies) || []);
  if(combined.length===0){ wrap.innerHTML = '<div class="small-muted">No companies yet.</div>'; return; }
  combined.forEach(c=>{
    const el = document.createElement('div'); el.style.display='flex'; el.style.justifyContent='space-between'; el.style.alignItems='center'; el.style.padding='6px 0';
    el.innerHTML = `<div><div style="font-weight:800">${c.name}</div><div class="small-muted">Net: $${n(c.netWorth||0)}</div></div>`;
    const controls = document.createElement('div'); controls.style.display='flex'; controls.style.gap='6px';
    const join = document.createElement('button'); join.className='ghost'; join.textContent='Join';
    join.addEventListener('click', ()=> joinCompany(c));
    controls.appendChild(join);
    const transfer = document.createElement('button'); transfer.className='ghost'; transfer.textContent='Transfer';
    transfer.addEventListener('click', ()=> transferToCompanyPrompt(c));
    controls.appendChild(transfer);
    el.appendChild(controls); wrap.appendChild(el);
  });
}

function renderInvestments(){
  const wrap = $('investList'); wrap.innerHTML = '';
  if(STATE.investments.length===0){ wrap.innerHTML = '<div class="small-muted">No investments</div>'; return; }
  STATE.investments.forEach(inv=>{
    const r = STATE.resources[inv.resource] || { display:inv.resource };
    const cur = calcPricePerUnit(inv.resource,1);
    const unreal = (cur - inv.buyPrice) * inv.qty;
    const el = document.createElement('div'); el.style.display='flex'; el.style.justifyContent='space-between'; el.style.padding='6px 0';
    el.innerHTML = `<div><div style="font-weight:700">${r.display} • ${inv.qty} units</div><div class="small-muted">Bought: $${n(inv.buyPrice)} @ ${new Date(inv.buyTime).toLocaleTimeString()}</div></div><div style="text-align:right"><div style="font-weight:800">${unreal>=0?'+':'-'}$${n(Math.abs(unreal))}</div><div style="display:flex;gap:6px;margin-top:6px"><button class="ghost">Sell</button></div></div>`;
    const sellBtn = el.querySelector('button');
    sellBtn.addEventListener('click', ()=> sellInvestment(inv.id));
    wrap.appendChild(el);
  });
}

// ORE MAKER (Host) rendering & actions
function renderOreMaker(){
  const panel = $('oreMakerPanel');
  if(!HOST.unlocked){ panel.style.display='none'; return; }
  panel.style.display='block';
  const form = $('oreForm'); form.innerHTML = '';
  // ensure host mode default
  HOST.mode = HOST.mode || 'easy';
  const mode = HOST.mode;
  // attach tab click handlers
  setTimeout(()=>{ ['modeEasy','modeAdvanced','modeAuto'].forEach(id=>{ const b = document.getElementById(id); if(b){ b.onclick = ()=>{ HOST.mode = id==='modeEasy'?'easy':id==='modeAdvanced'?'advanced':'auto'; saveHost(); renderOreMaker(); }; b.style.opacity = (HOST.mode === (id==='modeEasy'?'easy':id==='modeAdvanced'?'advanced':'auto')) ? '1' : '0.7'; } }); },10);

  if(mode==='easy'){
    form.innerHTML = `
      <div style="display:flex;gap:8px"><input id="oreName" placeholder="Ore name" class="ghost" style="flex:1"/><input id="oreRarity" placeholder="Rarity 1-100" class="ghost" style="width:110px"/></div>
      <div class="small-muted">Easy mode: provide name + rarity. Other stats auto-filled.</div>
    `;
  } else if(mode==='advanced'){
    form.innerHTML = `
      <div style="display:flex;gap:8px;flex-direction:column">
        <input id="oreName" placeholder="Ore name" class="ghost"/>
        <div style="display:flex;gap:6px"><input id="baseRange" placeholder="Base range e.g. 1000-2000" class="ghost" style="flex:1"/><input id="demand" placeholder="Demand 1-100" class="ghost" style="width:110px"/></div>
        <div style="display:flex;gap:6px"><input id="commonness" placeholder="Commonness 1-100" class="ghost" style="width:110px"/><input id="volatility" placeholder="Volatility 0.1-5.0" class="ghost" style="width:140px"/></div>
        <div style="display:flex;gap:6px"><input id="crashDepth" placeholder="Crash depth 0-1 (0.7 = -70%)" class="ghost" style="width:140px"/><input id="recovery" placeholder="Recovery speed 0.1-5.0" class="ghost" style="width:140px"/></div>
      </div>
    `;
  } else {
    form.innerHTML = `
      <div style="display:flex;gap:8px"><input id="oreName" placeholder="Ore name (auto)" class="ghost" style="flex:1"/><button class="ghost" id="quickGen">Quick Gen</button></div>
      <div class="small-muted">Auto mode: random stats (mostly common/rare; small chance for very high-value ores).</div>
    `;
    setTimeout(()=>{ const q = document.getElementById('quickGen'); if(q) q.onclick = ()=> { const name = document.getElementById('oreName').value.trim() || ('ore_'+Math.floor(Math.random()*99999)); hostAutoGen(name); }; },50);
  }

  // render existing ores (merge host + window.ORES)
  const list = $('oreList'); list.innerHTML = '';
  const merged = Object.assign({}, window.ORES || {}, HOST.ores || {});
  for(const k in merged){
    const o = merged[k];
    const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.padding='6px 0';
    row.innerHTML = `<div><b>${o.display||k}</b> <span class="small-muted">${Array.isArray(o.baseValueRange)?('['+o.baseValueRange.join('-')+']'):(o.baseValueRange||'')}</span></div>`;
    const ctr = document.createElement('div'); ctr.style.display='flex'; ctr.style.gap='6px';
    const edit = document.createElement('button'); edit.className='ghost'; edit.textContent='Edit'; edit.onclick = ()=> hostEditOre(k);
    const del = document.createElement('button'); del.className='cancel'; del.textContent='Remove'; del.onclick = ()=> { if(confirm('Remove ore?')){ hostRemoveOre(k); } };
    ctr.appendChild(edit); ctr.appendChild(del); row.appendChild(ctr); list.appendChild(row);
  }
}

// PRICE CALCS
function calcPricePerUnit(resourceKey, tierMultiplier){
  const r = STATE.resources[resourceKey];
  if(!r) return 0;
  const scarcity = clamp(1 - (r.stockLevel||0.5), 0,1);
  const baseMin = (Array.isArray(r.baseValueRange) ? r.baseValueRange[0] : (r.baseValueRange||10));
  const baseMax = (Array.isArray(r.baseValueRange) ? r.baseValueRange[1] : (r.baseValueRange|| (baseMin*3)));
  const base = baseMin + (baseMax - baseMin) * scarcity;
  const eventMult = r.eventMultiplier || 1;
  return Math.max(0.01, base * tierMultiplier * eventMult);
}

// MARKET TICK
function marketTick(){
  const speed = STATE.settings.tickMs || 3000;
  const rarity = Number(document.getElementById('raritySelect').value || 1);
  for(const k in STATE.resources){
    const r = STATE.resources[k];
    const delta = (Math.random()-0.5) * 0.04 * (r.volatility || 1);
    const meanRevert = (0.6 - (r.stockLevel||0.5)) * 0.01;
    r.stockLevel = clamp((r.stockLevel||0.5) + delta + meanRevert, 0.01, 1);
    processInvestmentsForOre(k);
    const roll = Math.random();
    const spikeChance = 0.012 / rarity; // less frequent spikes as rarity increases
    const crashChance = 0.01 * (0.5 + rarity*0.6); // more crashes for higher rarity
    if(roll < spikeChance){
      applySpike(k, 1 + (0.2 + Math.random()*0.8));
    } else if(roll > (1 - crashChance)){
      applyCrash(k, 0.2 + Math.random()*0.6);
    }
    const price = calcPricePerUnit(k,1);
    r.history = r.history || [];
    r.history.push(price);
    if(r.history.length > MAX_HISTORY) r.history.shift();
  }
  STATE.lastTick = now();
  savePlayer();
  renderAll();
}

// SPIKE / CRASH HANDLERS
function applySpike(oreKey, mult){
  const r = STATE.resources[oreKey];
  r.eventMultiplier = (r.eventMultiplier || 1) * mult;
  setTimeout(()=>{ if(r.eventMultiplier) r.eventMultiplier = r.eventMultiplier / mult; }, 4000 + Math.random()*8000);
}
function applyCrash(oreKey, dropFraction){
  const r = STATE.resources[oreKey];
  const dropTo = Math.max(0.01, 1 - dropFraction);
  r.eventMultiplier = (r.eventMultiplier || 1) * dropTo;
  const recMs = 60000 + Math.random()*60000;
  setTimeout(()=> gradualRecover(oreKey, recMs), 2000);
}
function gradualRecover(oreKey, duration){
  const r = STATE.resources[oreKey];
  const start = r.eventMultiplier || 1;
  const target = 1;
  const steps = 60; let i=0;
  const t = setInterval(()=>{
    i++;
    const tFrac = i/steps;
    r.eventMultiplier = start + (target-start)*tFrac;
    if(i>=steps) clearInterval(t);
  }, duration/steps);
}

// INVESTMENTS (momentum model)
function openInvestModal(ownerType='player', resourceKey){
  const key = resourceKey || prompt('Resource key to invest (e.g., coal):');
  if(!key || !STATE.resources[key]){ alert('Invalid resource'); return; }
  const amountStr = prompt('Amount of money to invest (e.g., 5000):');
  const amount = Number(amountStr);
  if(!amount || amount <= 0){ alert('Invalid amount'); return; }
  const current = calcPricePerUnit(key,1);
  const buyPrice = current * 0.5;
  const qty = Math.floor(amount / buyPrice);
  if(qty < 1){ alert('Not enough to buy 1 unit'); return; }
  if(ownerType==='player'){
    if(STATE.player.balance < amount){ alert('Not enough balance'); return; }
    STATE.player.balance -= amount;
  } else {
    const comp = STATE.companies.find(c=>c.id===STATE.player.companyId);
    if(!comp || comp.netWorth < amount){ alert('Company lacks funds'); return; }
    comp.netWorth -= amount;
  }
  const inv = { id:'inv_'+now(), ownerType, ownerId: ownerType==='player'?STATE.player.id:STATE.player.companyId, resource:key, qty, buyPrice:buyPrice, buyTime:now(), amount };
  STATE.investments.push(inv);
  applyInvestmentEvent(inv);
  savePlayer();
  renderAll();
  flash('Investment placed');
}

function applyInvestmentEvent(inv){
  const r = STATE.resources[inv.resource];
  let magnitude, duration, crashDepth, recoveryTime;
  if(inv.amount < INVEST_SMALL_THRESH){
    magnitude = 1 + (inv.amount / 100000) + (Math.random()*0.05);
    duration = rand(10000,25000);
    crashDepth = 0.10;
    recoveryTime = rand(15000,40000);
    r.eventMultiplier = (r.eventMultiplier||1) * magnitude;
    setTimeout(()=> smoothDecay(inv.resource, magnitude, recoveryTime), duration);
  } else if(inv.amount < INVEST_MED_THRESH){
    magnitude = 1 + (inv.amount / 20000);
    duration = rand(7000,14000);
    crashDepth = 0.30;
    recoveryTime = rand(40000,90000);
    r.eventMultiplier = (r.eventMultiplier||1) * magnitude;
    setTimeout(()=> hardCrashAndRecover(inv.resource, crashDepth, recoveryTime), duration);
  } else {
    magnitude = 1 + (inv.amount / 2500);
    duration = rand(3000,7000);
    crashDepth = 0.70; // up to -70%
    recoveryTime = rand(60000,120000);
    r.eventMultiplier = (r.eventMultiplier||1) * magnitude;
    setTimeout(()=> hardCrashAndRecover(inv.resource, crashDepth, recoveryTime), duration);
  }
}
function smoothDecay(resourceKey, magnitude, recoveryTime){
  const r = STATE.resources[resourceKey];
  const steps = 30;
  let i=0;
  const start = r.eventMultiplier || 1;
  const t = setInterval(()=>{
    i++;
    r.eventMultiplier = start - (start-1)*(i/steps);
    if(i>=steps) clearInterval(t);
  }, recoveryTime/steps);
}
function hardCrashAndRecover(resourceKey, crashDepth, recoveryTime){
  const r = STATE.resources[resourceKey];
  const crashTo = Math.max(0.01, 1 - crashDepth);
  r.eventMultiplier = crashTo;
  setTimeout(()=> gradualRecover(resourceKey, recoveryTime), 2000);
}
function processInvestmentsForOre(oreKey){
  // investments drive events via scheduled timeouts; cleanup is not required here
}

// SELL INVESTMENT
function sellInvestment(invId){
  const idx = STATE.investments.findIndex(i=>i.id===invId);
  if(idx===-1) return;
  const inv = STATE.investments[idx];
  const cur = calcPricePerUnit(inv.resource,1);
  const proceeds = Math.round(cur * inv.qty);
  if(inv.ownerType==='player') STATE.player.balance += proceeds;
  else {
    const comp = STATE.companies.find(c=>c.id===inv.ownerId);
    if(comp) comp.netWorth = (comp.netWorth||0) + proceeds;
  }
  STATE.investments.splice(idx,1);
  savePlayer(); renderAll(); flash('Investment sold');
}

// ORDERS (infinite tiers internally)
function generateOrderForTier(tier){
  const keys = Object.keys(STATE.resources);
  const weights = keys.map(k=> ((STATE.resources[k].commonness||50)/100) + Math.random()*0.4 );
  const sum = weights.reduce((a,b)=>a+b,0);
  let pick = Math.random()*sum;
  let selected = keys[0];
  for(let i=0;i<keys.length;i++){ pick -= weights[i]; if(pick<=0){ selected = keys[i]; break; } }
  const r = STATE.resources[selected];
  const qty = clamp(Math.floor(rand(10, 100) * tier), 1, 5000);
  const ppu = calcPricePerUnit(selected, tier);
  const total = Math.max(1, Math.round(ppu * qty));
  const order = { id: 'o_'+now()+'_'+Math.floor(Math.random()*9999), resource:selected, tier, qty, priceAtCreate:ppu, total, accepted:false, completed:false, createdAt:now() };
  STATE.orders.unshift(order);
  savePlayer();
}
function createOrder(){
  const maxTier = Math.max(1, Math.floor(1 + STATE.player.level / 2));
  const tier = rand(1, maxTier);
  generateOrderForTier(tier);
  renderOrders();
}
function generateAutoOrder(){
  if(!STATE.settings.autoOrders) return;
  const maxTier = Math.max(1, Math.floor(1 + STATE.player.level / 2));
  const tier = rand(1, maxTier);
  generateOrderForTier(tier);
}

function completeOrder(id){
  const idx = STATE.orders.findIndex(o=>o.id===id);
  if(idx===-1) return;
  const ord = STATE.orders[idx];
  if(!ord.accepted){ alert('Accept first'); return; }
  if(ord.completed){ alert('Already done'); return; }
  const currentPerUnit = calcPricePerUnit(ord.resource, ord.tier);
  const payout = Math.round(currentPerUnit * ord.qty);
  const deposit = $('depositTarget').value;
  if(deposit==='company' && STATE.player.companyId){
    const comp = STATE.companies.find(c=>c.id===STATE.player.companyId);
    if(comp) comp.netWorth = (comp.netWorth||0) + payout;
  } else STATE.player.balance += payout;
  STATE.completedOrders = STATE.completedOrders || [];
  STATE.completedOrders.push({ ore: ord.resource, qty: ord.qty, priceAtCompletion: currentPerUnit, timestamp: now() });
  const r = STATE.resources[ord.resource];
  r.stockLevel = clamp((r.stockLevel||0.5) - (ord.qty / (r.maxSupply||1000)) * 0.25, 0.01, 1);
  ord.completed = true;
  ord.completedAt = now();
  addXP(Math.max(1, Math.round(payout/1000)));
  savePlayer(); renderAll();
  const net = calcNetWorth();
  if(net >= MILESTONE_NETWORTH){ if(window.sendWebhook) sendWebhook('playerMilestone', { player: STATE.player.name, netWorth: net }); }
}

function removeOrder(id){ const idx = STATE.orders.findIndex(o=>o.id===id); if(idx>-1){ STATE.orders.splice(idx,1); savePlayer(); renderOrders(); } }
function declineOrder(id){ const idx = STATE.orders.findIndex(o=>o.id===id); if(idx===-1) return; const ord = STATE.orders[idx]; const xpLoss = Math.max(1, Math.round((ord.tier * ord.qty)/(STATE.player.level+5))); STATE.player.xp = Math.max(0, (STATE.player.xp||0) - xpLoss); STATE.orders.splice(idx,1); savePlayer(); renderAll(); flash(`Declined — XP -${n(xpLoss)}`); }

// LEVELING
function xpForLevel(L){ return Math.floor(100 * Math.pow(1.25, L-1)); }
function addXP(v){ STATE.player.xp = (STATE.player.xp||0) + v; let leveled=false; while(STATE.player.xp >= xpForLevel(STATE.player.level+1)){ STATE.player.level++; leveled=true; } if(leveled) flash('Level up!'); savePlayer(); renderPlayerUI(); }

// COMPANIES
function createCompany(){ const name = $('companyName').value.trim(); if(!name){ alert('Name required'); return; } if(STATE.player.balance < 10000){ alert('Need $10,000 to create'); return; } STATE.player.balance -= 10000; const comp = { id:'c_'+now(), name, netWorth:0, members:[STATE.player.name] }; STATE.companies.push(comp); STATE.player.companyId = comp.id; savePlayer(); renderAll(); flash('Company created'); if(window.sendWebhook) sendWebhook('companyCreated', { company:name, player:STATE.player.name }); }
function joinCompany(c){ let comp = STATE.companies.find(cc=>cc.id===c.id); if(!comp){ comp = { id:c.id||('c_ext_'+Math.floor(Math.random()*99999)), name:c.name, netWorth:c.netWorth||0, members:[] }; STATE.companies.push(comp); } if(!comp.members.includes(STATE.player.name)) comp.members.push(STATE.player.name); STATE.player.companyId = comp.id; savePlayer(); renderAll(); flash(`Joined ${comp.name}`); }
function leaveCompany(){ if(!STATE.player.companyId){ alert('Not in a company'); return; } const comp = STATE.companies.find(c=>c.id===STATE.player.companyId); if(comp) comp.members = comp.members.filter(m=>m!==STATE.player.name); STATE.player.companyId = null; savePlayer(); renderAll(); flash('Left company'); }
function transferToCompanyPrompt(c){ const amt = Number(prompt(`Transfer amount to ${c.name}:`)); if(!amt || amt<=0) return; if(STATE.player.balance < amt){ alert('Not enough'); return; } let comp = STATE.companies.find(cc=>cc.id===c.id); if(!comp){ comp={id:c.id||('c_ext_'+Math.floor(Math.random()*99999)), name:c.name, netWorth:c.netWorth||0, members:[]}; STATE.companies.push(comp); } STATE.player.balance -= amt; comp.netWorth = (comp.netWorth||0) + amt; savePlayer(); renderAll(); flash(`Transferred $${n(amt)} to ${comp.name}`); }

// NET WORTH (dynamic revaluation)
function calcNetWorth(){
  let nw = STATE.player.balance || 0;
  (STATE.completedOrders||[]).forEach(rec=>{
    const cur = calcPricePerUnit(rec.ore,1);
    nw += cur * rec.qty;
  });
  if(STATE.player.companyId){
    const comp = STATE.companies.find(c=>c.id===STATE.player.companyId);
    if(comp) nw += (comp.netWorth || 0) * 0.25;
  }
  return nw;
}

// ORE MAKER (Host functions)
function hostAutoGen(name){
  const rarity = rand(1,100);
  const baseMin = rand(10, Math.max(20, rarity*8));
  const baseMax = baseMin + rand(20, Math.max(50, rarity*40));
  const oreKey = name.toLowerCase().replace(/\s+/g,'_');
  HOST.ores = HOST.ores || {};
  HOST.ores[oreKey] = {
    display: name,
    symbol: name.slice(0,2).toUpperCase(),
    baseValueRange:[baseMin, baseMax],
    demand: rand(10,100),
    commonness: rand(10,100),
    volatility: (Math.random()*2)+0.5,
    crashDepth: Math.random()*0.6,
    recovery: Math.random()*1.5,
    maxSupply: rand(1000,20000)
  };
  saveHost(); seedHostOresIntoState(); renderAll(); flash('Auto ore generated');
}

function hostEditOre(key){
  const merged = Object.assign({}, HOST.ores || {}, window.ORES || {});
  const o = merged[key];
  if(!o) return;
  HOST.mode='advanced'; renderOreMaker();
  setTimeout(()=>{ if(document.getElementById('oreName')) document.getElementById('oreName').value = o.display || key; if(o.baseValueRange) document.getElementById('baseRange').value = o.baseValueRange.join('-'); if(o.demand) document.getElementById('demand').value=o.demand; if(o.commonness) document.getElementById('commonness').value=o.commonness; if(o.volatility) document.getElementById('volatility').value=o.volatility; if(o.crashDepth) document.getElementById('crashDepth').value=o.crashDepth; if(o.recovery) document.getElementById('recovery').value=o.recovery; },60);
}

function hostAddOre(){
  const mode = HOST.mode || 'easy'; let newOre = null;
  if(mode==='easy'){
    const name = document.getElementById('oreName').value.trim(); const r = Number(document.getElementById('oreRarity').value);
    if(!name || !r){ alert('Name and rarity required'); return; }
    const baseMin = Math.max(1, Math.floor(r * rand(8, 18)));
    const baseMax = baseMin + Math.floor(r * rand(18, 48));
    newOre = { display: name, symbol: name.slice(0,2).toUpperCase(), baseValueRange:[baseMin, baseMax], demand: clamp(100 - r + rand(-10,10),1,100), commonness: clamp(rand(100-r,100),1,100), volatility: 0.8 + (r/100)*2.5, crashDepth: 0.2 + (r/100)*0.4, recovery: 0.3 + (1 - r/100)*1.2, maxSupply: rand(1000,20000) };
  } else if(mode==='advanced'){
    const name = document.getElementById('oreName').value.trim();
    const br = document.getElementById('baseRange').value.trim(); const demand = Number(document.getElementById('demand').value); const commonness = Number(document.getElementById('commonness').value);
    const volatility = Number(document.getElementById('volatility').value); const crashDepth = Number(document.getElementById('crashDepth').value); const recovery = Number(document.getElementById('recovery').value);
    if(!name || !br){ alert('Name and base range required'); return; }
    const parts = br.split('-').map(s=>Number(s.trim())).filter(Boolean);
    newOre = { display: name, symbol: name.slice(0,2).toUpperCase(), baseValueRange: parts.length===2?[parts[0],parts[1]]:[parts[0],parts[0]*2], demand: clamp(isNaN(demand)?50:demand,1,100), commonness: clamp(isNaN(commonness)?50:commonness,1,100), volatility: clamp(isNaN(volatility)?1:volatility,0.1,10), crashDepth: clamp(isNaN(crashDepth)?0.3:crashDepth,0,1), recovery: clamp(isNaN(recovery)?0.6:recovery,0.1,5), maxSupply: rand(1000,20000) };
  } else {
    alert('Use quick gen for auto mode (Quick Gen button).');
    return;
  }
  const key = newOre.display.toLowerCase().replace(/\s+/g,'_');
  HOST.ores = HOST.ores || {};
  HOST.ores[key] = newOre;
  saveHost();
  seedHostOresIntoState();
  renderAll();
  flash('Ore added to host data');
}

function hostRemoveOre(key){
  if(HOST.ores && HOST.ores[key]){ delete HOST.ores[key]; saveHost(); if(STATE.resources[key]) delete STATE.resources[key]; savePlayer(); renderAll(); flash('Host ore removed'); }
  else { alert('Ore not found in host data'); }
}

function seedHostOresIntoState(){
  HOST.ores = HOST.ores || {};
  for(const k in HOST.ores){
    const copy = JSON.parse(JSON.stringify(HOST.ores[k]));
    copy.key = k; copy.stockLevel = copy.stockLevel || 0.6; copy.history = copy.history || []; copy.maxSupply = copy.maxSupply || 10000;
    STATE.resources[k] = copy;
  }
  savePlayer();
}

// EXPORT ORES JS (merge host + existing)
function exportOresJS(){
  const merged = Object.assign({}, window.ORES || {}, HOST.ores || {});
  const obj = {};
  for(const k in merged) obj[k] = merged[k];
  const text = '// Paste this into ores.js (replace file contents)\nwindow.ORES = ' + JSON.stringify(obj, null, 2) + ';';
  const w = window.open('about:blank','ores_export');
  w.document.write('<pre style="white-space:pre-wrap">'+escapeHtml(text)+'</pre>');
  w.document.title = 'ores_export.js (copy & paste into ores.js)';
  w.focus();
}
function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

// EXPORT / IMPORT player
function exportPlayerData(){ const blob = new Blob([JSON.stringify(STATE, null, 2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='mob_player_backup.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function handleImport(e){ const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ()=> { try{ const parsed = JSON.parse(r.result); if(confirm('Overwrite current player state with imported data?')){ STATE = parsed; savePlayer(); renderAll(); } }catch(err){ alert('Invalid file'); } }; r.readAsText(f); }

// HELPERS (sparkline + flash)
function drawSpark(history, canvas){
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  if(!history || history.length<2) return;
  const min = Math.min(...history); const max = Math.max(...history); const denom = (max-min)||1;
  ctx.beginPath();
  for(let i=0;i<history.length;i++){
    const x = (i/(history.length-1))*w;
    const y = h - ((history[i]-min)/denom)*h;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2; ctx.stroke();
}
function flash(msg){
  const t = document.createElement('div');
  t.style.position='fixed'; t.style.left='12px'; t.style.bottom='12px'; t.style.background='#34d399'; t.style.color='#042018';
  t.style.padding='8px 10px'; t.style.borderRadius='8px'; t.style.fontWeight='700'; t.style.zIndex='9999';
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition='opacity 400ms'; t.style.opacity='0'; setTimeout(()=>t.remove(),420); }, 1800);
}

// LOOP
function loop(){
  const nowt = Date.now();
  if(STATE.settings.autoTick && (nowt - STATE.lastTick) > (STATE.settings.tickMs || 3000)) marketTick();
  if(STATE.settings.autoOrders && (nowt - STATE.lastAuto) > AUTO_ORDER_INTERVAL){ STATE.lastAuto = nowt; generateAutoOrder(); }
  requestAnimationFrame(loop);
}

// STARTUP helpers
function calcNetWorthChangeSince(prev){ return 0; } // placeholder if needed

// START
init();
