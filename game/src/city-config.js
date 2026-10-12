import {VEHICLES} from './physics.js';
// The installed city pack (public/city/, written by wasteland-builder): names, texts, spawn, labels and media.
// Everything place-specific in the game reads from CITY so the same engine runs any generated town.
export const CITY={
  name:'City',slug:'city',title:{top:'CITY',bottom:'WASTELAND'},page_title:'Wasteland · Battlecars',wordmark:'W / W',coordinates:'',
  text:{eyebrow:'THE STREETS ARE YOURS. KEEP THEM.',tagline:'Same streets. New rules.',intro:'Take an armored machine into the streets.<br>Hunt the raiders. Scavenge the wrecks. Make it home.',
    win_eyebrow:'THE CITY IS YOURS',start_roam:'DRIVE THE CITY',explore:'EXPLORE THE CITY',loading:'Loading the city…',ready:'The city is ready',map_title:'TACTICAL MAP',description:''},
  room:'WASTELAND',spawn:{x:0,z:0,heading:0},bounds:{minX:-600,maxX:600,minZ:-600,maxZ:600},
  labels:[],districts:[],squares:[],crates:[],fires:[],splash:null,voices:[],music:null,bonus_vehicles:[],attribution:'Map data © OpenStreetMap contributors (ODbL)'
};

export async function loadCityConfig(){
  const response=await fetch('city/config.json');
  if(!response.ok)throw new Error('No city is installed. Build one with "python3 wasteland.py build <place>" and start it with "python3 wasteland.py play <place>".');
  const config=await response.json();
  Object.assign(CITY,config,{text:{...CITY.text,...(config.text||{})}});
  // A city can bring bonus vehicles (theme.json "bonus_vehicles"): spec, cabin and model come with the pack.
  for(const v of CITY.bonus_vehicles||[])if(v?.id&&v.spec&&!VEHICLES[v.id])VEHICLES[v.id]={...v.spec,cabin:v.cabin||null,bonus:true};
  applyCityTexts();
  return CITY;
}

function setLines(el,text){
  if(!el)return;
  el.replaceChildren();
  String(text).split(/<br\s*\/?>/i).forEach((line,i)=>{if(i)el.append(document.createElement('br'));el.append(line);});
}

export function applyCityTexts(){
  const $=id=>document.getElementById(id),q=s=>document.querySelector(s),t=CITY.text;
  document.title=CITY.page_title;
  if(t.description)q('meta[name="description"]')?.setAttribute('content',t.description);
  $('game')?.setAttribute('aria-label',`3D battle-car game in ${CITY.name}`);
  const mark=q('.wordmark');if(mark?.firstChild)mark.firstChild.nodeValue=CITY.wordmark;
  const coords=q('.coordinates');
  if(coords){const [place,position='']=CITY.coordinates.split('<i></i>');coords.replaceChildren(place.trim()+' ',document.createElement('i'),' '+position.trim());}
  const eyebrow=q('.intro .eyebrow');if(eyebrow?.lastChild)eyebrow.lastChild.nodeValue=' '+t.eyebrow;
  const h1=q('.intro h1');if(h1){const em=document.createElement('em');em.textContent=CITY.title.bottom;h1.replaceChildren(CITY.title.top,document.createElement('br'),em);}
  setLines(q('.tagline'),t.tagline);setLines(q('.intro-copy'),t.intro);
  if($('arena-room'))$('arena-room').value=String(CITY.room).slice(0,11);
  if($('load-text'))$('load-text').textContent=t.loading;
  const brand=q('.hud-brand');if(brand?.firstChild)brand.firstChild.nodeValue=CITY.wordmark+' ';
  if($('street'))$('street').textContent=(CITY.spawn.street||CITY.name).toUpperCase();
  if($('district'))$('district').textContent=CITY.name.toUpperCase();
  const mapTitle=q('#map-screen h2');if(mapTitle)mapTitle.textContent=t.map_title;
  $('bigmap')?.setAttribute('aria-label',`${CITY.name} tactical map, click to set a waypoint`);
  if(CITY.splash)document.documentElement.style.setProperty('--hero-art',`url('${new URL(CITY.splash,location.href).href}')`);
}

export function nearestDistrict(x,z){
  let best=null,dist=Infinity;
  for(const d of CITY.districts){const k=(d.x-x)**2+(d.z-z)**2;if(k<dist){dist=k;best=d;}}
  return best&&dist<450**2?best.name:CITY.name.toUpperCase();
}

export function squareAt(x,z){
  return CITY.squares.find(s=>Math.hypot(s.x-x,s.z-z)<s.r)?.name||null;
}
