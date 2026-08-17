// ═══════════════════════════════════════════════════════════════
// FUZZER — génère des paniers aléatoires, vérifie 9 invariants
// ═══════════════════════════════════════════════════════════════
global.window = { NC: require('./noyau-commande.js') };
const NC = global.window.NC;

// RNG déterministe (reproductible en cas d'échec)
let seed = 987654321;
function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
function pick(a){ return a[Math.floor(rnd()*a.length)]; }
function chance(p){ return rnd()<p; }
function uid(pfx){ return pfx+Math.floor(rnd()*1e9).toString(36); }

// ── Catalogue réaliste (structure Gin Khao) ──
const cats=[
 {id:'c-loclac',nom:'Loc Lac',station:'cuisine'},{id:'c-padthai',nom:'Pad Thaï',station:'cuisine'},
 {id:'c-rizsauce',nom:'Riz en sauce',station:'cuisine'},{id:'c-crousty',nom:'Crousty Khao',station:'cuisine'},
 {id:'c-fl',nom:'Formule Loc Lac',parent_id:'c-F',station:'cuisine'},{id:'c-fp',nom:'Formule Pokébowl',parent_id:'c-F',station:'sushi'},
 {id:'c-F',nom:'Formules',station:'cuisine'},{id:'c-makis',nom:'Makis',parent_id:'c-S',station:'sushi'},
 {id:'c-S',nom:'Sushi',station:'sushi'},{id:'c-e',nom:'Entrées',station:'cuisine'},
 {id:'c-supp',nom:'Suppléments',station:'cuisine'},{id:'c-sauces',nom:'Sauces',station:'comptoir'},
 {id:'c-b',nom:'Boissons',station:'comptoir'},{id:'c-d',nom:'Desserts',station:'comptoir'},
];
const OB2=[{choix:['Riz','Nouilles'],groupe:'Féculent'},{choix:['Normal','Spicy'],groupe:'Niveau épicé'}];
const prods=[
 {id:'loclac',nom:'Bœuf Loc Lac',prix:12.9,categorie_id:'c-loclac',options_base:OB2,ingredients_retirable:['Oignons','Citron','OEuf','Carottes'],supplements_ids:['sp','sb'],sauces_ids:['dyn','aigre']},
 {id:'padthai',nom:'Pad Thaï Poulet',prix:11.9,categorie_id:'c-padthai',options_base:[OB2[1]],ingredients_retirable:['Cacahuètes','Soja'],supplements_ids:['sp','sb'],sauces_ids:['dyn']},
 {id:'rizsauce',nom:'Riz en sauce',prix:9.5,categorie_id:'c-rizsauce',options_base:[{choix:['Curry Vert','Curry Coco','Sauce Piquante'],groupe:'Sauce Riz'},OB2[1]],ingredients_retirable:['Courgettes'],supplements_ids:['sp']},
 {id:'crousty',nom:'Crousty Khao Crevettes',prix:12.5,categorie_id:'c-crousty',sauces_incluses:true,sauces_ids:['dyn','aigre']},
 {id:'fl',nom:'Poulet Loc Lac (Formule)',prix:15.9,categorie_id:'c-fl',est_formule:true,options_base:OB2},
 {id:'fp',nom:'Poké Bowl (Formule)',prix:16.9,categorie_id:'c-fp',est_formule:true},
 {id:'maki6',nom:'Maki Saumon Avocat (6 pièces)',prix:6.9,categorie_id:'c-makis',variantes:[]},
 {id:'sushi4',nom:'Sushi Saumon (4 pièces)',prix:5.9,categorie_id:'c-S',variantes:[]},
 {id:'nems',nom:'Nems Poulet',prix:3.99,categorie_id:'c-e',visible_formule:true,variantes:[{prix:3.9,pieces:2},{prix:6.9,pieces:4}]},
 {id:'broch',nom:'Brochette Poulet Caramélisé',prix:4.9,categorie_id:'c-e',visible_formule:true,variantes:[{prix:4.9,pieces:2},{prix:9.9,pieces:5}]},
 {id:'rizb',nom:'Riz Blanc',prix:2.5,categorie_id:'c-e',visible_formule:true,variantes:[]},
 {id:'tempura',nom:'Tempura Poulet',prix:6.9,categorie_id:'c-e',visible_formule:false,variantes:[{prix:7.9,label:'4 pièces'}]},
 {id:'sp',nom:'Suppl. Poulet',prix:3,categorie_id:'c-supp'},
 {id:'sb',nom:'Suppl. Bœuf',prix:3,categorie_id:'c-supp'},
 {id:'dyn',nom:'Sauce Dynamite',prix:1,categorie_id:'c-sauces'},
 {id:'aigre',nom:'Sauce Aigre-Douce',prix:1,categorie_id:'c-sauces'},
 {id:'coca',nom:'Coca 33cl',prix:1.5,categorie_id:'c-b'},{id:'oasis',nom:'Oasis 33cl',prix:1.5,categorie_id:'c-b'},
 {id:'crist',nom:'Cristalline Fraise 50cl',prix:1.5,categorie_id:'c-b'},
 {id:'tapioka',nom:'Perle de Tapioka',prix:4,categorie_id:'c-d'},{id:'mango',nom:'Mango Sticky Rice',prix:5.5,categorie_id:'c-d'},
];
NC.init({produits:prods,categories:cats});
const P=id=>prods.find(p=>p.id===id);
const ENTREES=['nems','broch','rizb'];
const BOISSONS=['coca','oasis','crist'];
const PLATS=['loclac','padthai','rizsauce','crousty'];
const SUSHIS=['maki6','sushi4'];

function sousEnsemble(arr,max){const out=[];arr.forEach(x=>{if(chance(0.35)&&out.length<max)out.push(x);});return out;}
function optionsAleatoires(p){
  const ob={};(p.options_base||[]).forEach(g=>{ob[g.groupe]=pick(g.choix);});
  return ob;
}

// ── Génère un panier aléatoire au format CAISSE ──
function panierAleatoire(){
  const t=[];const n=1+Math.floor(rnd()*7);
  for(let k=0;k<n;k++){
    const type=pick(['plat','plat','formule','sushi','simple','simple','supp_seul','recompense']);
    if(type==='plat'){
      const p=P(pick(PLATS));
      const supps=sousEnsemble(p.supplements_ids||[],3);
      // doubler parfois un supplément
      if(supps.length&&chance(0.4))supps.push(supps[0]);
      const l={ligne_uid:uid('L'),produit_id:p.id,nom:p.nom,prix:p.prix,quantite:1+Math.floor(rnd()*3),
        categorie_id:p.categorie_id,options_base:optionsAleatoires(p),
        retirables:sousEnsemble(p.ingredients_retirable||[],3),
        supplements_sel:supps,sauces_sel:sousEnsemble(p.sauces_ids||[],2)};
      t.push(l);
      // sous-lignes payantes (suppléments, sauces payantes si pas incluses)
      NC.grouperIds(supps).forEach(g=>{const sp=P(g.id);
        t.push({ligne_uid:uid('L'),lien_plat:l.ligne_uid,produit_id:sp.id,nom:'  ↳ '+sp.nom+(g.qte>1?' x'+g.qte:''),prix:sp.prix*g.qte,quantite:1,categorie_id:sp.categorie_id});});
      if(!p.sauces_incluses)(l.sauces_sel||[]).forEach(sid=>{const sc=P(sid);
        t.push({ligne_uid:uid('L'),lien_plat:l.ligne_uid,produit_id:sc.id,nom:'  ↳ '+sc.nom,prix:sc.prix,quantite:1,categorie_id:sc.categorie_id});});
    } else if(type==='formule'){
      const p=P(pick(['fl','fp']));
      const e=P(pick(ENTREES)), b=P(pick(BOISSONS));
      const l={ligne_uid:uid('L'),produit_id:p.id,nom:p.nom,prix:p.prix,quantite:1+Math.floor(rnd()*2),
        categorie_id:p.categorie_id,est_formule:true,options_base:optionsAleatoires(p),
        formule_entree_id:e.id,formule_boisson_id:b.id};
      t.push(l);
      t.push({ligne_uid:uid('L'),lien_plat:l.ligne_uid,produit_id:b.id,nom:'  ↳ '+b.nom+' (formule)',prix:0,quantite:l.quantite,categorie_id:b.categorie_id});
      t.push({ligne_uid:uid('L'),lien_plat:l.ligne_uid,produit_id:e.id,nom:'  ↳ '+e.nom+' (formule)',prix:0,quantite:l.quantite,categorie_id:e.categorie_id});
    } else if(type==='sushi'){
      const p=P(pick(SUSHIS));
      t.push({ligne_uid:uid('L'),produit_id:p.id,nom:p.nom,prix:p.prix,quantite:1+Math.floor(rnd()*3),categorie_id:p.categorie_id});
    } else if(type==='simple'){
      const p=P(pick([...BOISSONS,'tapioka','mango','rizb']));
      t.push({ligne_uid:uid('L'),produit_id:p.id,nom:p.nom,prix:p.prix,quantite:1+Math.floor(rnd()*2),categorie_id:p.categorie_id});
    } else if(type==='supp_seul'){
      const p=P(pick(['sp','sb','dyn']));
      t.push({ligne_uid:uid('L'),produit_id:p.id,nom:p.nom,prix:p.prix,quantite:1,categorie_id:p.categorie_id});
    } else {
      t.push({ligne_uid:uid('L'),produit_id:null,nom:'🎁 Plat offert (fidélité)',prix:-(5+Math.floor(rnd()*10)),quantite:1});
    }
  }
  return t;
}

// ── LES 9 INVARIANTS ──
function verifier(t,imp){
  const err=[];
  const bons=[...(imp.bonCuisine?imp.bonCuisine.items:[]),...(imp.bonSushi?imp.bonSushi.items:[])];
  const nomsBons=bons.map(i=>i.nom);
  // I1 : rien qui ressemble à une sous-ligne facturée en ligne de bon
  if(nomsBons.some(x=>/suppl\.|^sauce /i.test(x)&&!/crousty/i.test(x))){
    // sauces/suppléments VENDUS SEULS sont légitimes en cuisine (supp) — affiner :
  }
  // I1 précis : aucune ligne de bon ne provient d'une sous-ligne (lien_plat) SAUF entrée de formule
  t.filter(l=>l&&l.lien_plat).forEach(l=>{
    const estEntree = t.some(p2=>p2.ligne_uid===l.lien_plat&&p2.formule_entree_id===l.produit_id);
    const surBon = bons.some(b=>b.ligne_uid&&String(b.ligne_uid).indexOf(l.ligne_uid)===0);
    if(surBon&&!estEntree)err.push('I1 sous-ligne sur bon: '+l.nom);
    if(!surBon&&estEntree)err.push('I1b entrée de formule ABSENTE des bons: '+l.nom);
  });
  // I2 : chaque plat top-level cuisine/sushi apparaît, à la bonne quantité
  t.filter(l=>l&&!l.lien_plat&&l.produit_id).forEach(l=>{
    const st=NC.stationCategorie(l.categorie_id);
    if(st==='comptoir')return;
    const q=bons.filter(b=>b.ligne_uid&&String(b.ligne_uid).indexOf(l.ligne_uid)===0).reduce((s,b)=>s+b.quantite,0);
    if(q!==l.quantite)err.push('I2 quantité bon '+l.nom+': '+q+'≠'+l.quantite);
  });
  // I3 : jamais de boisson/dessert sur un bon
  if(nomsBons.some(x=>/coca|oasis|cristalline|tapioka|mango/i.test(x)))err.push('I3 comptoir sur bon');
  // I4 : jamais de double collage
  if(nomsBons.some(x=>/\b(riz|nouilles) \1\b/i.test(x)))err.push('I4 double collage: '+nomsBons.find(x=>/\b(riz|nouilles) \1\b/i.test(x)));
  // I5 : jamais "Normal" en détail
  bons.forEach(b=>(b.details||[]).forEach(d=>{if(/^normal$/i.test(d))err.push('I5 Normal imprimé');}));
  // I6 : sushi éclaté (toutes quantités = 1)
  if(imp.bonSushi&&imp.bonSushi.items.some(i=>i.quantite!==1))err.push('I6 sushi non éclaté');
  // I7 : entrée de formule porte ses pièces quand applicable
  bons.filter(b=>/nems|brochette/i.test(b.nom)&&t.some(l=>l.lien_plat&&/formule/i.test(l.nom||'')&&String(b.ligne_uid).indexOf(l.ligne_uid)===0))
      .forEach(b=>{if(!/\(\d+ pcs\)/i.test(b.nom))err.push('I7 pièces manquantes: '+b.nom);});
  // I8 : total client = somme des lignes visibles + rien de facturé perdu
  const totalAttendu=t.filter(Boolean).reduce((s,l)=>s+(Number(l.prix)||0)*(l.quantite||1),0);
  const totalClient=imp.ticketClient.lignes.reduce((s,l)=>s+(Number(l.prix)||0)*(l.quantite||1),0);
  if(Math.abs(totalAttendu-totalClient)>0.001)err.push('I8 total client '+totalClient.toFixed(2)+'≠'+totalAttendu.toFixed(2));
  // I9 : toute ligne facturée (prix≠0) apparaît sur le ticket client
  t.filter(l=>l&&Math.abs(Number(l.prix)||0)>0.001).forEach(l=>{
    if(!imp.ticketClient.lignes.some(c=>c.ligne_uid===l.ligne_uid))err.push('I9 ligne facturée absente du ticket: '+l.nom);
  });
  return err;
}

const N=2000;let ko=0,premierEchec=null;
for(let i=0;i<N;i++){
  const t=panierAleatoire();
  let imp;
  try{imp=NC.construireImpression(t,{numero:1000+i});}
  catch(e){ko++;if(!premierEchec)premierEchec={i,t,err:['CRASH: '+e.message]};continue;}
  const err=verifier(t,imp);
  if(err.length){ko++;if(!premierEchec)premierEchec={i,t,err};}
}
console.log(N+' paniers aléatoires générés et vérifiés (9 invariants chacun)');
console.log(ko===0?'████ 0 VIOLATION — '+(N*9)+' vérifications ████':'████ '+ko+' panier(s) en échec ████');
if(premierEchec){
  console.log('\nPremier échec (panier #'+premierEchec.i+') :');
  premierEchec.err.forEach(e=>console.log('  ✗ '+e));
  console.log(JSON.stringify(premierEchec.t,null,1).slice(0,2500));
}
process.exit(ko?1:0);
