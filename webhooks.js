/* webhooks.js
  Discord webhook helper. Keeps everything local and optional.
  Exposes sendWebhook(eventType, payload).
  Stores webhook URL in localStorage under key 'mob_webhook_url'.
*/

// Expose manager on window
(function(){
  const STORAGE_KEY = 'mob_webhook_url';

  function getUrl(){ return localStorage.getItem(STORAGE_KEY) || ''; }
  function setUrl(url){ if(url) localStorage.setItem(STORAGE_KEY, url); else localStorage.removeItem(STORAGE_KEY); }

  // small admin UI injection: minimal, non-intrusive
  function injectUI(){
    try{
      const container = document.createElement('div');
      container.style.position='fixed';
      container.style.left='12px';
      container.style.bottom='12px';
      container.style.zIndex='9999';
      container.style.background='rgba(0,0,0,0.4)';
      container.style.padding='8px';
      container.style.borderRadius='8px';
      container.style.backdropFilter='blur(4px)';
      container.style.color='#fff';
      container.style.fontSize='12px';
      container.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center">
          <input id="mobWebhookInput" placeholder="Discord webhook URL" style="width:300px;padding:6px;border-radius:6px;border:none" />
          <button id="mobWebhookSave" style="padding:6px;border-radius:6px;border:none;background:#10b981;color:#042018;font-weight:700">Save</button>
          <button id="mobWebhookClear" style="padding:6px;border-radius:6px;border:none;background:#ef4444;color:#fff;font-weight:700">Clear</button>
        </div>
      `;
      document.body.appendChild(container);
      const inp = document.getElementById('mobWebhookInput');
      inp.value = getUrl();
      document.getElementById('mobWebhookSave').addEventListener('click', ()=>{
        setUrl(inp.value.trim());
        flash('Webhook saved (local only)');
      });
      document.getElementById('mobWebhookClear').addEventListener('click', ()=>{
        setUrl('');
        inp.value = '';
        flash('Webhook cleared');
      });
    }catch(e){ /* ignore in case DOM not ready */ }
  }

  function flash(msg){
    const t = document.createElement('div');
    t.style.position='fixed'; t.style.left='12px'; t.style.bottom='70px'; t.style.background='#34d399'; t.style.color='#042018';
    t.style.padding='8px 10px'; t.style.borderRadius='8px'; t.style.fontWeight='700'; t.style.zIndex='9999';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.transition='opacity 400ms'; t.style.opacity='0'; setTimeout(()=>t.remove(),420); }, 1800);
  }

  // safe sender
  async function sendWebhook(eventType, payload){
    const url = getUrl();
    if(!url) return; // silently ignore if not set
    // build message text based on type
    let content = '';
    try{
      switch(eventType){
        case 'levelUp':
          content = `🏆 **${payload.player}** reached Level **${payload.level}**!`;
          break;
        case 'orderComplete':
          content = `✅ **${payload.player}** completed ${payload.qty}x ${payload.ore} (Tier x${payload.tier}) — Payout: $${payload.payout}`;
          break;
        case 'bulkComplete':
          content = `💼 **${payload.company}** completed bulk ${payload.qty}x ${payload.ore} — Payout: $${payload.payout}`;
          break;
        case 'companyCreated':
          content = `🏢 New company: **${payload.company}** (created by ${payload.player})`;
          break;
        case 'investment':
          content = `📈 **${payload.player}** invested $${payload.amount} in **${payload.ore}** — spike triggered`;
          break;
        case 'pfMilestone':
          content = `💠 **${payload.company}** reached Prosperity Factor **${payload.pf.toFixed(2)}**!`;
          break;
        default:
          content = `🔔 Event: ${eventType} — ${JSON.stringify(payload)}`;
      }
    }catch(e){
      content = `🔔 Event: ${eventType} — ${JSON.stringify(payload)}`;
    }

    try{
      await fetch(url, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ username: 'MiningBot', content })
      });
    }catch(e){
      // ignore failures (no backend)
      console.warn('webhook send failed', e);
    }
  }

  // expose functions
  window.MOB_WEBHOOK = {
    getUrl, setUrl, sendWebhook
  };

  // convenience global
  window.sendWebhook = function(eventType, payload){
    if(window.MOB_WEBHOOK) window.MOB_WEBHOOK.sendWebhook(eventType, payload);
  };

  // inject admin UI when DOM ready
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(injectUI, 600);
  } else {
    window.addEventListener('DOMContentLoaded', ()=> setTimeout(injectUI, 600));
  }
})();
