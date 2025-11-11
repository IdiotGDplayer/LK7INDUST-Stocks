// ores.js
// Permanent ore definitions. To make ores permanent for everyone, replace the contents of this file
// in your GitHub repo with the exported text from the host Export Ores JS tool.
//
// Format:
// window.ORES = {
//   coal: { display:'Coal', symbol:'CO', baseValueRange:[10,20], demand:80, commonness:90, volatility:1.0, crashDepth:0.2, recovery:0.8, maxSupply:20000 },
//   ...
// };

window.ORES = window.ORES || {
  // example defaults
  coal: { display:'Coal', symbol:'CO', baseValueRange:[10,20], demand:80, commonness:90, volatility:1.0, crashDepth:0.2, recovery:0.8, maxSupply:20000 },
  iron: { display:'Iron', symbol:'Fe', baseValueRange:[50,120], demand:60, commonness:70, volatility:1.2, crashDepth:0.25, recovery:0.7, maxSupply:10000 },
  gold: { display:'Gold', symbol:'Au', baseValueRange:[200,800], demand:40, commonness:30, volatility:1.6, crashDepth:0.35, recovery:0.6, maxSupply:5000 }
};
