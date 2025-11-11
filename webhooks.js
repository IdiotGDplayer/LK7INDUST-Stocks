/* webhooks.js
  Minimal Discord webhook helper.
  Only sends:
    - companyCreated
    - companyDestroyed
    - playerMilestone (100,000,000 net worth)
  Stores webhook URL in localStorage under 'mob_webhook_url' (local only).
*/
(function(){
  const STORAGE_KEY = 'mob_webhook_url';
  function getUrl(){ return localStorage.getItem(STORAGE_KEY) || ''; }
  function setUrl(u){ if(u) localStorage.setItem(STORAGE_KEY,u); else localStorage.removeItem(STORAGE_KEY); }

  function sendRaw(msg){
    const url = getUrl();
    if(!url) return;
    fetch(url,{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ username:'MiningBot', content: msg })
    }).catch(e=>console.warn('webhook failed',e));
  }

  window.MOB_WEBHOOK = { getUrl, setUrl, sendRaw };

  window.sendWebhook = function(type, payload){
    try{
      if(!window.MOB_WEBHOOK) return;
      switch(type){
        case 'companyCreated':
          sendRaw(`🏢 New company founded: **${payload.company}** (by ${payload.player})`);
          break;
        case 'companyDestroyed':
          sendRaw(`💀 Company destroyed: **${payload.company}** (reason: ${payload.reason || 'bankruptcy'})`);
          break;
        case 'playerMilestone':
          sendRaw(`💸 **${payload.player}** reached Net Worth $${Number(payload.netWorth).toLocaleString()}!`);
          break;
        default: break;
      }
    }catch(e){ console.warn('sendWebhook fail', e); }
  };

  function injectUI(){
    try{
      const btn = document.createElement('button');
      btn.textContent='hook';
      btn.className='host-btn';
      document.body.appendChild(btn);
      btn.addEventListener('click', ()=>{
        const url = prompt('Paste Discord webhook URL (local only):', getUrl() || '');
        if(url !== null){
          setUrl(url.trim());
          alert('Webhook saved locally.');
        }
      });
    }catch(e){}
  }
  if(document.readyState==='complete' || document.readyState==='interactive'){
    setTimeout(injectUI,600);
  } else window.addEventListener('DOMContentLoaded', ()=> setTimeout(injectUI,600));
})();
