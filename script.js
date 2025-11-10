/* script.js
   Mining Order Board v2 — integrated with filters, decline XP penalty, companies list, webhooks integration.
   NOTE: Only new behavior was added or inserted; core logic follows earlier design.
*/

// ----------------------------- Config & Utilities -----------------------------
const KEY = 'mining_order_board_v2';
const AUTO_ORDER_INTERVAL = 10000; // 10s new order generation
const MARKET_TICK_MS = 3000;
const AUTOSAVE_MS = 10000;
const INVEST_PRICE_FACTOR = 0.5; // buy price factor relative to current price (0.5 = buy at half)
const MAX_HISTORY = 60; // sparkline points
const MAX_BULK = 20480; // company bulk cap

const TIERS = [0.1, 0.25, 0.5, 1, 2, 5];

const uuid = () => 'id_' + Math.random().toString(36).slice(2,9);
const lerp = (a,b,t)=>a+(b-a)*t;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const n = x => (Math.round(x)).toLocaleString();

// ----------------------------- Default resources -----------------------------
const DEFAULT_ORES = {
  coal:    { display:'Coal', symbol:'CO', baseMin:20, baseMax:200, stockLevel:0.7, maxSupply:20000 },
  iron:    { display:'Iron', symbol:'Fe', baseMin:50, baseMax:400, stockLevel:0.6, maxSupply:10000 },
  gold:    { display:'Gold', symbol:'Au', baseMin:200, baseMax:2000, stockLevel:0.8, maxSupply:5000 },
  diamond: { display:'Diamond', symbol:'DI', baseMin:1200, baseMax:8000, stockLevel:0.9, maxSupply:1000 },
};

// ----------------------------- App State -----------------------------
let state = {
  player: {
    id: uuid(),
    name: 'You',
    balance: 20000,
    xp: 0,
    level: 1,
    companyId: null
  },
  resources: {}, // filled from ores.js or defaults
  orders: [], // active orders
  companies: [], // created companies
  investments: [],
  settings: { autoTick:true, autoOrders:true, tickMs:MARKET_TICK_MS },
  lastAutoOrder: 0,
  lastTick: Date.now()
};

// ----------------------------- Persistence -----------------------------
function loadState(){
  const raw = localStorage.getItem(KEY);
  if(raw){
    try{
      const parsed = JSON.parse(raw);
      // shallow merge to preserve default structure but load saved values
      Object.assign(state, parsed);
    }catch(e){
      seedState();
    }
  } else {
    seedState();
  }

  // Merge ores
  if(window.ORES && Object.keys(window.ORES).length){
    for(const k in window.ORES){
      state.resources[k] = Object.assign({}, window.ORES[k]);
      state.resources[k].history = state.resources[k].history || [];
    }
  } else {
    for(const k in DEFAULT_ORES){
      state.resources[k] = state.resources[k] || Object.assign({}, DEFAULT_ORES[k]);
      state.resources[k].history = state.resources[k].history || [];
    }
  }

  // Ensure fields
  for(const k in state.resources){
    const r = state.resources[k];
    r.stockLevel = clamp(typeof r.stockLevel === 'number' ? r.stockLevel : 0.6, 0.01, 1);
    r.maxSupply = r.maxSupply || 1000;
    r.history = r.history || [];
  }
}

function saveState(){
  localStorage.setItem(KEY, JSON.stringify(state));
}

// autosave timer
setInterval(()=>{ saveState(); flashMessage('Autosaved'); }, AUTOSAVE_MS);

// ----------------------------- UI helpers -----------------------------
function $(id){ return document.getElementById(id); }

function initUI(){
  $('tickBtn').addEventListener('click', ()=>{ marketTick(); });
  $('resetBtn').addEventListener('click', ()=>{ if(confirm('Reset everything?')) { seedState(); saveState(); renderAll(); } });
  $('genBtn').addEventListener('click', ()=> createOrder());
  $('autoTick').checked = state.settings.autoTick;
  $('autoTick').addEventListener('change', e => { state.settings.autoTick = e.target.checked; saveState(); });

  $('exportBtn').addEventListener('click', exportData);
  $('importInput').addEventListener('change', handleImport);

  $('createCompanyBtn').addEventListener('click', createCompanyFromInput);
  $('leaveCompanyBtn').addEventListener('click', leaveCompany);
  $('companyInvestBtn').addEventListener('click', ()=> openInvestModal('company'));

  renderTiers(); // will attach filter handlers
  renderAll();
}

// ----------------------------- Renderers -----------------------------
function renderAll(){
  renderStocks();
  renderOrders();
  renderPlayerUI();
  renderCompanyPanel();
  renderCompanyList();
  renderInvestments();
  renderLeaderboard();
}

function renderPlayerUI(){
  $('balance').textContent = '$' + n(state.player.balance);
  $('levelDisplay').textContent = state.player.level;
  const next = xpForLevel(state.player.level+1);
  $('xpDisplay').textContent = `XP: ${n(state.player.xp)} / ${n(next)}`;
  let est = state.player.balance;
  for(const k in state.resources) est += Math.round(state.resources[k].stockLevel * state.resources[k].maxSupply * calcPricePerUnit(k, 0.25));
  $('networth').textContent = 'Est. net worth: $' + n(est);
}

function renderStocks(){
  const wrap = $('stocksList');
  wrap.innerHTML = '';
  for(const key of Object.keys(state.resources)){
    const r = state.resources[key];
    const price = calcPricePerUnit(key, 1);
    const item = document.createElement('div');
    item.className = 'stock';
    item.innerHTML = `
      <div class="sym" title="${r.display}">${r.symbol}</div>
      <div class="meta">
        <div class="name">${r.display} <span class="small muted">(${key})</span></div>
        <div class="sub small">${Math.round((1-r.stockLevel)*100)}% scarcity • supply est: ${Math.round(r.stockLevel * r.maxSupply)}</div>
      </div>
      <canvas class="spark" id="spark_${key}"></canvas>
      <div class="price">$${n(price)}/unit</div>
    `;
    item.addEventListener('click', ()=> openInvestModal('player', key));
    wrap.appendChild(item);
    drawSparkline(r.history, document.getElementById(`spark_${key}`));
  }
}

function renderTiers(){
  const wrap = $('tierButtons');
  wrap.innerHTML = '';
  // Add "All" filter
  const allBtn = document.createElement('button'); allBtn.className='ghost tier-button'; allBtn.textContent='All'; allBtn.dataset.tier='all';
  allBtn.addEventListener('click', ()=> filterOrdersByTier('all'));
  wrap.appendChild(allBtn);

  TIERS.forEach(t=>{
    const b = document.createElement('button');
    b.className='ghost tier-button';
    b.textContent = `x${t}`;
    b.style.padding='8px 10px';
    b.dataset.tier = String(t);
    // NEW: attach filter behavior (no order generation)
    b.addEventListener('click', ()=> filterOrdersByTier(String(t)));
    wrap.appendChild(b);
  });
}

function renderOrders(){
  const wrap = $('ordersList');
  wrap.innerHTML = '';
  state.orders.forEach(order=>{
    const r = state.resources[order.resource];
    const card = document.createElement('div');
    card.className = 'order-card order';
    card.setAttribute('data-tier', String(order.tier));
    const left = document.createElement('div');
    left.style.display='flex'; left.style.gap='12px'; left.style.alignItems='center';
    left.innerHTML = `
      <div style="width:64px;height:64px;background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="font-weight:800">${r.symbol}</div>
        <div class="small-muted" style="font-size:12px">${r.display}</div>
      </div>
      <div>
        <div style="font-weight:800">${order.qty} x ${r.display}</div>
        <div class="small-muted">created: ${new Date(order.createdAt).toLocaleTimeString()}</div>
      </div>
    `;
    const right = document.createElement('div');
    right.style.display='flex'; right.style.flexDirection='column'; right.style.gap='6px'; right.style.alignItems='flex-end';
    right.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <div class="tag">Total: <b style="margin-left:6px">$${n(order.lockedPrice || order.total)}</b></div>
        <div class="tier">Tier x${order.tier}</div>
      </div>
    `;
    const actions = document.createElement('div');
    actions.style.display='flex'; actions.style.gap='8px';
    // Accept / Complete / Cancel / Decline
    if(!order.accepted){
      const accept = document.createElement('button'); accept.className='accept'; accept.textContent='Accept';
      accept.onclick = ()=> { order.accepted = true; order.lockedPrice = order.total; saveState(); renderOrders(); flashMessage('Order accepted'); };
      const decline = document.createElement('button'); decline.className='cancel'; decline.textContent='Decline';
      decline.onclick = ()=> { declineOrder(order.id); };
      actions.appendChild(accept);
      actions.appendChild(decline);
    } else if(order.accepted && !order.completed){
      const complete = document.createElement('button'); complete.className='complete'; complete.textContent='Complete';
      complete.onclick = ()=> { completeOrder(order.id); };
      const cancel = document.createElement('button'); cancel.className='cancel'; cancel.textContent='Cancel';
      cancel.onclick = ()=> { if(confirm('Cancel order?')) { removeOrder(order.id); } };
      actions.appendChild(complete); actions.appendChild(cancel);
    } else {
      const done = document.createElement('div'); done.className='tag'; done.textContent='Completed';
      actions.appendChild(done);
    }
    right.appendChild(actions);
    card.appendChild(left);
    card.appendChild(right);
    wrap.appendChild(card);
  });
}

function renderCompanyPanel(){
  const panel = $('companyInfo');
  const joined = state.player.companyId ? state.companies.find(c=>c.id===state.player.companyId) : null;
  if(!joined){
    panel.innerHTML = `<div class="small-muted">No company joined. Join or create one to access bulk orders.</div>`;
  } else {
    panel.innerHTML = `
      <div style="font-weight:800">${joined.name}</div>
      <div class="small-muted">Net worth: $${n(joined.netWorth)} • PF: ${pf(joined).toFixed(2)}</div>
      <div class="small-muted">Members: ${joined.members.join(', ') || 'none'}</div>
    `;
  }
}

function renderCompanyList(){
  const wrap = $('companyList');
  wrap.innerHTML = '';
  // merge local companies and server companies (server is placeholder)
  const server = window.SERVER_DATA || { companies: [] };
  // first local companies
  const all = state.companies.concat(server.companies || []);
  if(all.length === 0){ wrap.innerHTML = '<div class="small-muted">No companies yet.</div>'; return; }
  all.forEach(c=>{
    const el = document.createElement('div');
    el.style.display='flex'; el.style.justifyContent='space-between'; el.style.alignItems='center'; el.style.padding='6px 0';
    el.innerHTML = `<div><div style="font-weight:800">${c.name}</div><div class="small-muted">Net: $${n(c.netWorth||0)}</div></div>`;
    const controls = document.createElement('div'); controls.style.display='flex'; controls.style.gap='6px';
    const joinBtn = document.createElement('button'); joinBtn.className='ghost'; joinBtn.textContent='Join';
    joinBtn.onclick = ()=> { joinCompany(c); };
    controls.appendChild(joinBtn);

    // Transfer funds UI (if player is in a company, show transfer to that company)
    const transferBtn = document.createElement('button'); transferBtn.className='ghost'; transferBtn.textContent='Transfer';
    transferBtn.onclick = ()=> { transferToCompanyPrompt(c); };
    controls.appendChild(transferBtn);

    el.appendChild(controls);
    wrap.appendChild(el);
  });
}

// Investments list
function renderInvestments(){
  const wrap = $('investList');
  wrap.innerHTML = '';
  if(state.investments.length===0){ wrap.innerHTML = '<div class="small-muted">No investments</div>'; return; }
  state.investments.forEach(inv=>{
    const r = state.resources[inv.resource];
    const current = calcPricePerUnit(inv.resource,1);
    const unreal = (current - inv.buyPrice) * inv.qty;
    const el = document.createElement('div');
    el.style.display='flex'; el.style.justifyContent='space-between'; el.style.padding='6px 0'; el.style.alignItems='center';
    el.innerHTML = `
      <div>
        <div style="font-weight:700">${r.display} • ${inv.qty} units</div>
        <div class="small-muted">Bought: $${n(inv.buyPrice)} @ ${new Date(inv.buyTime).toLocaleTimeString()}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:800">${unreal>=0?'+':'-'}$${n(Math.abs(unreal))}</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="ghost" data-id="${inv.id}" onclick="window.sellInvestment && window.sellInvestment('${inv.id}')">Sell</button>
        </div>
      </div>
    `;
    wrap.appendChild(el);
  });
}

function renderLeaderboard(){
  const wrap = $('leaderboard');
  wrap.innerHTML = '';
  const players = [{name:state.player.name, level:state.player.level, netWorth:state.player.balance}];
  const server = window.SERVER_DATA || { players:[], companies:[] };
  const allPlayers = server.players.slice(0,10).concat(players).slice(0,15);
  allPlayers.forEach(p=>{
    const el = document.createElement('div');
    el.style.display='flex'; el.style.justifyContent='space-between'; el.style.padding='6px 0';
    el.innerHTML = `<div>${p.name} <span class="small-muted">Lvl:${p.level||1}</span></div><div>$${n(p.netWorth||0)}</div>`;
    wrap.appendChild(el);
  });
  if(server.companies && server.companies.length){
    const title = document.createElement('div'); title.style.marginTop='8px'; title.style.fontWeight='800'; title.textContent='Companies';
    wrap.appendChild(title);
    server.companies.slice(0,6).forEach(c=>{
      const el = document.createElement('div'); el.style.display='flex'; el.style.justifyContent='space-between';
      el.style.padding='6px 0'; el.innerHTML = `<div>${c.name}</div><div>$${n(c.netWorth||0)}</div>`;
      wrap.appendChild(el);
    });
  }
}

// ----------------------------- Market logic -----------------------------
function calcPricePerUnit(resourceKey, tierMultiplier){
  const r = state.resources[resourceKey];
  const scarcity = clamp(1 - r.stockLevel, 0, 1);
  const base = lerp(r.baseMin, r.baseMax, scarcity);
  return base * tierMultiplier;
}

function marketTick(){
  for(const k in state.resources){
    const r = state.resources[k];
    const delta = (Math.random()-0.5) * 0.06;
    const meanRevert = (0.6 - r.stockLevel) * 0.02;
    r.stockLevel = clamp(r.stockLevel + delta + meanRevert, 0.01, 1);
    if(r.stockLevel < 0.05) r.stockLevel = clamp(r.stockLevel + 0.04*Math.random(), 0.01, 1);
    const price = calcPricePerUnit(k,1);
    r.history.push(price);
    if(r.history.length > MAX_HISTORY) r.history.shift();
  }
  state.lastTick = Date.now();
  saveState();
  renderAll();
}

// ----------------------------- Orders -----------------------------
function createOrder(){
  const mode = $('modeSelect').value;
  const tier = randomTierByPlayer();
  generateOrderForTier(tier, mode);
}

function randomTierByPlayer(){
  const L = state.player.level;
  const baseWeights = TIERS.map((t, i) => {
    const wantLevel = Math.max(1, Math.round(Math.log2(t+1) * 3));
    const levelFactor = clamp((L - wantLevel) / (wantLevel+3), -1, 1);
    return Math.max(0.1, (1 / (i+1)) * (1 + levelFactor * 1.5));
  });
  const sum = baseWeights.reduce((a,b)=>a+b,0);
  let pick = Math.random()*sum;
  let idx = 0;
  for(let i=0;i<baseWeights.length;i++){
    pick -= baseWeights[i];
    if(pick<=0){ idx = i; break; }
  }
  return TIERS[idx];
}

function generateOrderForTier(tier, mode='solo'){
  const keys = Object.keys(state.resources);
  const weights = keys.map(k => (1 - state.resources[k].stockLevel) + Math.random()*0.2 );
  const sum = weights.reduce((a,b)=>a+b,0);
  let pick = Math.random()*sum;
  let selected = keys[0];
  for(let i=0;i<keys.length;i++){
    pick -= weights[i];
    if(pick<=0){ selected = keys[i]; break; }
  }
  const r = state.resources[selected];
  let qty;
  if(mode==='company' && state.player.companyId){
    const base = Math.round(r.maxSupply * 0.05);
    qty = clamp(Math.round(base * (tier*2) * (0.8 + Math.random()*1.6)), 1000, MAX_BULK);
  } else {
    const base = Math.round(r.maxSupply * 0.001);
    qty = clamp(Math.round(base * (tier<=0.25?1: tier<=0.5?2:4) * (0.5 + Math.random()*2)), 10, 500);
  }
  const pricePerUnit = calcPricePerUnit(selected, tier);
  const total = Math.max(1, Math.round(pricePerUnit * qty));
  const order = {
    id: 'o_' + Date.now() + '_' + Math.floor(Math.random()*9999),
    resource: selected,
    tier,
    qty,
    priceAtCreate: pricePerUnit,
    lockedPrice: Math.round(pricePerUnit * qty),
    total: Math.round(pricePerUnit * qty),
    accepted:false,
    completed:false,
    ownerType: mode,
    companyId: mode==='company' ? state.player.companyId : null,
    createdAt: Date.now()
  };
  state.orders.unshift(order);
  saveState();
  renderOrders();
  flashMessage(`New order: ${qty} x ${r.display}`);
}

function generateAutoOrder(){
  if(!state.settings.autoOrders) return;
  const tier = TIERS[Math.floor(Math.random()*TIERS.length)];
  const mode = Math.random() < 0.2 && state.player.companyId ? 'company' : 'solo';
  generateOrderForTier(tier, mode);
}

function completeOrder(id){
  const idx = state.orders.findIndex(o=>o.id===id);
  if(idx===-1) return;
  const order = state.orders[idx];
  if(!order.accepted){ alert('You must accept before completing.'); return; }
  if(order.completed){ alert('Already completed'); return; }

  const currentPerUnit = calcPricePerUnit(order.resource, order.tier);
  const payout = Math.round(currentPerUnit * order.qty * (order.ownerType==='company' ? pfMultiplierForCompany(order.companyId) : 1));

  if(order.ownerType === 'company' && order.companyId){
    const comp = state.companies.find(c=>c.id===order.companyId);
    if(comp){
      comp.netWorth += payout;
      // webhook
      if(window.sendWebhook) sendWebhook('bulkComplete', { company: comp.name, qty: order.qty, ore: order.resource, payout });
      // PF milestone check
      if(pf(comp) >= 4) { if(window.sendWebhook) sendWebhook('pfMilestone', { company: comp.name, pf: pf(comp) }); }
    }
  } else {
    state.player.balance += payout;
    if(window.sendWebhook) sendWebhook('orderComplete', { player: state.player.name, qty: order.qty, ore: order.resource, tier: order.tier, payout });
  }

  const r = state.resources[order.resource];
  const impact = order.qty / r.maxSupply;
  r.stockLevel = clamp(r.stockLevel - impact * 0.25, 0.01, 1);

  order.completed = true;
  order.completedAt = Date.now();
  order.finalPayout = payout;
  addXP(Math.max(1, Math.round(payout / 1000)));
  saveState();
  renderAll();
  flashMessage(`Completed order +$${n(payout)}`);
}

function removeOrder(id){
  const idx = state.orders.findIndex(o=>o.id===id);
  if(idx===-1) return;
  state.orders.splice(idx,1);
  saveState();
  renderOrders();
}

// ----------------------------- Decline logic (new) -----------------------------
function declineOrder(id){
  const idx = state.orders.findIndex(o=>o.id===id);
  if(idx===-1) return;
  const order = state.orders[idx];
  // xpLoss formula: xpLoss = round((order.tier * order.qty) / 10)
  const xpLoss = Math.max(1, Math.round((order.tier * order.qty) / 10));
  state.player.xp = Math.max(0, state.player.xp - xpLoss);
  // remove the order
  state.orders.splice(idx,1);
  saveState();
  renderAll();
  flashMessage(`Declined order — XP -${n(xpLoss)}`);
}

// ----------------------------- Leveling -----------------------------
function xpForLevel(L){ return 50 * L * L; } // quadratic XP requirement
function addXP(x){
  state.player.xp += x;
  let leveled = false;
  while(state.player.xp >= xpForLevel(state.player.level+1)){
    state.player.level += 1;
    leveled = true;
    if(window.sendWebhook) sendWebhook('levelUp', { player: state.player.name, level: state.player.level });
  }
  if(leveled) flashMessage(`Level up! Now level ${state.player.level}`);
  saveState();
  renderPlayerUI();
}

// ----------------------------- Companies -----------------------------
function createCompanyFromInput(){
  const name = $('companyName').value.trim();
  if(!name){ alert('Choose a name'); return; }
  const cost = 10000;
  if(state.player.balance < cost){ alert('Not enough balance to start a company ($10,000)'); return; }
  state.player.balance -= cost;
  const company = { id: 'c_' + Date.now(), name, netWorth: 0, members: [state.player.name] };
  state.companies.push(company);
  state.player.companyId = company.id;
  saveState();
  renderAll();
  flashMessage(`Company ${name} created`);
  if(window.sendWebhook) sendWebhook('companyCreated', { company: name, player: state.player.name });
}

function joinCompany(cobj){
  // cobj may be from server (only name/netWorth) or local; if server: create a local stub join
  let comp = state.companies.find(cc=>cc.id===cobj.id);
  if(!comp){
    // create local copy so player can join
    comp = { id: cobj.id || ('c_ext_' + Math.floor(Math.random()*99999)), name: cobj.name, netWorth: cobj.netWorth || 0, members: [] };
    state.companies.push(comp);
  }
  if(!comp.members.includes(state.player.name)) comp.members.push(state.player.name);
  state.player.companyId = comp.id;
  saveState();
  renderAll();
  flashMessage(`Joined ${comp.name}`);
}

function leaveCompany(){
  if(!state.player.companyId){ alert('You are not in a company'); return; }
  const comp = state.companies.find(c=>c.id===state.player.companyId);
  if(comp){
    comp.members = comp.members.filter(m=>m !== state.player.name);
  }
  state.player.companyId = null;
  saveState();
  renderAll();
  flashMessage('Left company');
}

function transferToCompanyPrompt(c){
  const amountStr = prompt(`Enter amount to transfer to ${c.name}:`);
  const amount = Number(amountStr);
  if(!amount || amount <= 0){ alert('Invalid amount'); return; }
  if(state.player.balance < amount){ alert('Not enough balance'); return; }
  // find or create company locally
  let comp = state.companies.find(cc=>cc.id===c.id);
  if(!comp){
    comp = { id: c.id || ('c_ext_' + Math.floor(Math.random()*99999)), name: c.name, netWorth: c.netWorth || 0, members: [] };
    state.companies.push(comp);
  }
  state.player.balance -= amount;
  comp.netWorth += amount;
  saveState();
  renderAll();
  flashMessage(`Transferred $${n(amount)} to ${comp.name}`);
  if(window.sendWebhook) sendWebhook('investment', { player: state.player.name, amount, ore: 'company transfer' });
}

// Prosperity Factor
function pf(company){
  if(!company) return 1;
  return 1 + Math.log2(1 + (company.netWorth / 10000));
}
function pfMultiplierForCompany(companyId){
  const c = state.companies.find(x=>x.id===companyId);
  if(!c) return 1;
  return pf(c);
}

// ----------------------------- Investments -----------------------------
function openInvestModal(ownerType='player', resourceKey){
  const rKey = resourceKey || prompt('Enter resource key to invest (e.g., coal):');
  if(!rKey || !state.resources[rKey]){ alert('Invalid resource'); return; }
  const amountStr = prompt('Enter amount of money to invest (e.g., 5000):');
  const amount = Number(amountStr);
  if(!amount || amount <= 0){ alert('Invalid amount'); return; }
  const current = calcPricePerUnit(rKey, 1);
  const buyPricePerUnit = current * INVEST_PRICE_FACTOR;
  const qty = Math.floor(amount / buyPricePerUnit);
  if(qty < 1){ alert('Not enough to buy even 1 unit at this factor'); return; }
  if(ownerType === 'player'){
    if(state.player.balance < amount){ alert('Not enough balance'); return; }
    state.player.balance -= amount;
  } else {
    if(!state.player.companyId){ alert('No company'); return; }
    const comp = state.companies.find(c=>c.id===state.player.companyId);
    if(!comp){ alert('Company not found'); return; }
    if(comp.netWorth < amount){ alert('Company lacks funds'); return; }
    comp.netWorth -= amount;
  }

  const inv = {
    id: 'inv_' + Date.now(),
    ownerType,
    ownerId: ownerType === 'player' ? state.player.id : state.player.companyId,
    resource: rKey,
    qty,
    buyPrice: buyPricePerUnit,
    buyTime: Date.now()
  };
  state.investments.push(inv);
  applyInvestmentImpact(inv);
  saveState();
  renderAll();
  flashMessage(`Invested $${n(amount)} in ${state.resources[rKey].display} (${qty} units)`);
  if(window.sendWebhook) sendWebhook('investment', { player: state.player.name, amount: amount, ore: rKey });
}

function applyInvestmentImpact(inv){
  const r = state.resources[inv.resource];
  const ownerFactor = inv.ownerType === 'company' ? 2.0 : 1.0;
  const k = 0.02 * ownerFactor;
  const magnitude = k * Math.log(1 + inv.qty);
  r.stockLevel = clamp(r.stockLevel - magnitude, 0.01, 1);
  setTimeout(()=>{
    r.stockLevel = clamp(r.stockLevel + magnitude * (1.2 + Math.random()*0.6), 0.01, 1);
    saveState();
    renderAll();
  }, 4000 + Math.random()*6000);
}

window.sellInvestment = function(invId){
  const idx = state.investments.findIndex(i=>i.id===invId);
  if(idx===-1) return;
  const inv = state.investments[idx];
  const current = calcPricePerUnit(inv.resource, 1);
  const proceeds = Math.round(current * inv.qty);
  if(inv.ownerType === 'player'){
    state.player.balance += proceeds;
  } else {
    const comp = state.companies.find(c=>c.id===inv.ownerId);
    if(comp) comp.netWorth += proceeds;
  }
  state.investments.splice(idx,1);
  saveState();
  renderAll();
  flashMessage(`Sold investment for $${n(proceeds)}`);
};

// ----------------------------- Helpers -----------------------------
function drawSparkline(history, canvas){
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  if(!history || history.length < 2) return;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const denom = (max - min) || 1;
  ctx.beginPath();
  for(let i=0;i<history.length;i++){
    const x = (i/(history.length-1)) * w;
    const y = h - ((history[i]-min)/denom) * h;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 2;
  ctx.stroke();
}

let toastTimer;
function flashMessage(txt){
  const t = document.createElement('div');
  t.style.position='fixed'; t.style.right='18px'; t.style.bottom='18px'; t.style.background='linear-gradient(180deg,#10b981,#34d399)';
  t.style.padding='10px 14px'; t.style.borderRadius='10px'; t.style.color='#052018'; t.style.fontWeight='700'; t.style.boxShadow='0 8px 30px rgba(0,0,0,0.6)';
  t.textContent = txt;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ t.style.transition='opacity 400ms'; t.style.opacity='0'; setTimeout(()=>t.remove(),420); }, 2200);
}

// export/import
function exportData(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'mob_state_backup.json'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function handleImport(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(reader.result);
      if(confirm('Load imported data and overwrite current state?')){
        state = parsed;
        saveState();
        renderAll();
        flashMessage('Imported data loaded');
      }
    }catch(err){ alert('Invalid file'); }
  };
  reader.readAsText(file);
}

// ----------------------------- Loop & seed -----------------------------
function seedState(){
  state = {
    player: { id: uuid(), name: 'You', balance: 20000, xp:0, level:1, companyId:null },
    resources: {},
    orders: [],
    companies: [],
    investments: [],
    settings: { autoTick:true, autoOrders:true, tickMs:MARKET_TICK_MS },
    lastAutoOrder: 0,
    lastTick: Date.now()
  };
  if(window.ORES && Object.keys(window.ORES).length){
    for(const k in window.ORES){ state.resources[k] = Object.assign({}, window.ORES[k]); state.resources[k].history = []; }
  } else {
    for(const k in DEFAULT_ORES){ state.resources[k] = Object.assign({}, DEFAULT_ORES[k]); state.resources[k].history = []; }
  }
  saveState();
  renderAll();
}

function loop(){
  const now = Date.now();
  if(state.settings.autoTick && (now - state.lastTick) > state.settings.tickMs){
    marketTick();
  }
  if(state.settings.autoOrders && (now - state.lastAutoOrder) > AUTO_ORDER_INTERVAL){
    state.lastAutoOrder = now;
    generateAutoOrder();
  }
  requestAnimationFrame(loop);
}

// ----------------------------- Order filtering (new) -----------------------------
function filterOrdersByTier(tierStr){
  const cards = document.querySelectorAll('.order-card.order');
  cards.forEach(card=>{
    const t = card.getAttribute('data-tier');
    if(tierStr === 'all') card.style.display = '';
    else card.style.display = (t === tierStr) ? '' : 'none';
  });
}

// ----------------------------- Startup -----------------------------
loadState();
initUI();
loop();
