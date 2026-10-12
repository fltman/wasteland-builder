import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { weatherMaterial } from './wasteland.js';
import { VEHICLES } from './physics.js';
import {CITY} from './city-config.js';

// Driver's seat for each car, in car space (−Z forward, +X right, left-hand drive). The Blender
// cabins are closed armour shells with glass laid on top, so the driver view cuts the window band out
// of the player's own body (bonnet, roof and hood guns stay) and fits a hand-built interior inside.
// Measured with rays from the seat: interceptor cabin x ±0.70, floor 1.01, roof 1.57, screen base z −0.71;
// War Rig x ±1.0, floor 1.12, roof 2.71, screen z −1.89; the Rust Hound is an open cage.
export const CABINS={
  interceptor:{eye:[-.34,1.33,.1],cut:[[-.78,1.05,-.8],[.78,1.53,1.05]],width:1.4,floor:1.01,rear:.95,roof:1.55,dash:[1.07,-.62],screen:[-.7,-.3,1.13,1.55],wheel:[1.11,-.36,.18,.45],style:'sport',badge:'V8',plate:'INTERCEPTOR'},
  raider:{eye:[-.22,1.57,.08],cut:null,width:.9,floor:1.24,rear:.7,roof:1.95,dash:[1.32,-.56],screen:null,wheel:[1.37,-.27,.17,.5],style:'chain',badge:'13',plate:'RUST HOUND'},
  wartruck:{eye:[-.45,2.38,-1.05],cut:[[-1.08,2,-1.97],[1.08,2.64,-.08]],width:1.9,floor:1.12,rear:-.2,roof:2.68,dash:[2.02,-1.74],screen:[-1.88,-1.8,2.09,2.68],wheel:[2.1,-1.4,.21,.75],style:'rig',badge:'88',plate:'WAR RIG'}
};

// A city's bonus vehicle brings its own cabin (config.json bonus_vehicles[].cabin).
export function cabinOf(id){return CABINS[id]||VEHICLES[id]?.cabin||null;}

function canvasTexture(width,height,draw){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;draw(canvas.getContext('2d'),width,height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
// Backlit dials side by side in one texture: amber ticks and numerals on black, sweeping from lower
// left over the top to lower right.
function dialAtlas(dials){
  return canvasTexture(256*dials.length,256,(atlas)=>dials.forEach(({label,marks},index)=>{
    atlas.save();atlas.translate(index*256,0);const c=atlas;
    const g=c.createRadialGradient(128,128,20,128,128,128);g.addColorStop(0,'#2a2116');g.addColorStop(1,'#0b0907');
    c.fillStyle=g;c.beginPath();c.arc(128,128,126,0,Math.PI*2);c.fill();
    c.strokeStyle='#e8b871';c.fillStyle='#f3c98a';c.textAlign='center';c.textBaseline='middle';
    for(let i=0;i<=40;i++){
      const a=Math.PI*.75+i/40*Math.PI*1.5,major=i%5===0,inner=major?92:102;
      c.lineWidth=major?5:2;c.beginPath();c.moveTo(128+Math.cos(a)*inner,128+Math.sin(a)*inner);c.lineTo(128+Math.cos(a)*114,128+Math.sin(a)*114);c.stroke();
      if(major&&marks){c.font='bold 22px Courier New';c.fillText(marks[i/5],128+Math.cos(a)*72,128+Math.sin(a)*72);}
    }
    c.strokeStyle='#d0452a';c.lineWidth=6;c.beginPath();c.arc(128,128,114,Math.PI*.75+Math.PI*1.5*.82,Math.PI*2.25);c.stroke();
    c.font='bold 22px Courier New';c.fillText(label,128,214);
    atlas.restore();
  }));
}

export function createCockpit(root,id,{weathering=null}={}){
  const cabin=cabinOf(id);if(!cabin)return null;
  // 'epa': a cherished Swedish A-traktor — black plastic and velour instead of rust and rivets, red LED
  // strips and fuzzy dice from the mirror.
  const epa=cabin.style==='epa';
  const uniforms={cabinCut:{value:0},cabinInverse:{value:new THREE.Matrix4()},cabinMin:{value:new THREE.Vector3()},cabinMax:{value:new THREE.Vector3()}};
  if(cabin.cut){uniforms.cabinMin.value.fromArray(cabin.cut[0]);uniforms.cabinMax.value.fromArray(cabin.cut[1]);}
  // The player's car gets its own materials so the cut never reaches an opponent of the same model.
  const clones=new Map();
  root.traverse(o=>{
    if(!o.isMesh||!o.material?.isMeshStandardMaterial||!cabin.cut)return;
    let material=clones.get(o.material);
    if(!material){
      const original=o.material;material=original.clone();
      material.onBeforeCompile=shader=>{
        original.onBeforeCompile(shader);Object.assign(shader.uniforms,uniforms);
        shader.vertexShader='varying vec3 vCabinWorld;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCabinWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
        shader.fragmentShader='uniform float cabinCut;uniform mat4 cabinInverse;uniform vec3 cabinMin;uniform vec3 cabinMax;varying vec3 vCabinWorld;\n'+
          shader.fragmentShader.replace('void main() {','void main() {\nif(cabinCut>.5){vec3 cabinLocal=(cabinInverse*vec4(vCabinWorld,1.0)).xyz;if(all(greaterThan(cabinLocal,cabinMin))&&all(lessThan(cabinLocal,cabinMax)))discard;}');
      };
      material.customProgramCacheKey=()=>original.customProgramCacheKey()+'|cabin-cut';
      clones.set(original,material);
    }
    o.material=material;
  });
  const body=[];root.traverse(o=>{if(o.isMesh)body.push(o);});
  const occlusion=new Map(body.map(mesh=>[mesh,mesh.userData.noOcclusion]));

  // Materials. The worn ones get the same grime and rust the cars and city use.
  const standard=(name,options)=>new THREE.MeshStandardMaterial({name:`Cockpit ${name}`,...options});
  const M={
    steel:standard('steel',{color:0x575049,roughness:.62,metalness:.6,envMapIntensity:2.2}),
    plate:standard('plate',{color:0x3d3a35,roughness:.75,metalness:.45,envMapIntensity:2}),
    rust:standard('rust',{color:0x86532e,roughness:.85,metalness:.3,envMapIntensity:2}),
    leather:standard('leather',{color:0x3a2416,roughness:.7,metalness:0,envMapIntensity:1.6}),
    rubber:standard('rubber',{color:0x1e1b18,roughness:.9,envMapIntensity:1.5}),
    chrome:standard('chrome',{color:0xd9d4c8,roughness:.22,metalness:1,envMapIntensity:3}),
    tape:standard('tape',{color:0x8f8d86,roughness:.6,metalness:.1,envMapIntensity:1.5}),
    red:standard('red',{color:0xa3170c,roughness:.45,metalness:.2,emissive:0x3a0500,envMapIntensity:2}),
    bone:standard('bone',{color:0xd8ccae,roughness:.65,envMapIntensity:1.6}),
    dark:standard('void',{color:0x080706,roughness:1}),
    wireRed:standard('wire red',{color:0x8c2016,roughness:.55}),wireBlack:standard('wire black',{color:0x141312,roughness:.5}),wireYellow:standard('wire yellow',{color:0xb08a1c,roughness:.5}),
    mirror:standard('mirror',{color:0xffffff,roughness:.04,metalness:1,envMapIntensity:1.4})
  };
  if(epa){
    const plastic=standard('clean plastic',{color:0x121214,roughness:.62,metalness:.05,envMapIntensity:1.2});
    M.plate=M.steel=M.rust=M.tape=plastic;M.leather=standard('clean velour',{color:0x1b1a20,roughness:.95,envMapIntensity:.8});
    M.led=standard('clean LED lamp',{color:new THREE.Color(cabin.led||'#ff2a3a').multiplyScalar(.3),emissive:cabin.led||'#ff2a3a',emissiveIntensity:5,roughness:.3});
  }
  for(const key of ['steel','plate','rust','leather','rubber','tape'])weatherMaterial(M[key],weathering,true);

  const group=new THREE.Group();group.name='Cockpit';group.visible=false;root.add(group);
  // Everything is first placed as ordinary meshes; parts marked fixed are merged per material at the end.
  const mesh=(geometry,material,parent=group,fixed=true)=>{const m=new THREE.Mesh(geometry,material);m.receiveShadow=true;m.userData.noOcclusion=true;m.userData.fixed=fixed;parent.add(m);return m;};
  const at=(m,x,y,z,rx=0,ry=0,rz=0)=>{m.position.set(x,y,z);m.rotation.set(rx,ry,rz);return m;};
  const pivot=(parent,x,y,z,rx=0,ry=0,rz=0)=>{const p=new THREE.Group();parent.add(p);return at(p,x,y,z,rx,ry,rz);};
  const tube=(points,radius,material,parent=group)=>mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(8,points.length*8),radius,7,false),material,parent);
  const rivets=(parent,from,to,count,radius=.0075)=>{if(epa)return;for(let i=0;i<count;i++){const t=count>1?i/(count-1):.5;at(mesh(new THREE.SphereGeometry(radius,6,4),M.steel,parent),from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t,from[2]+(to[2]-from[2])*t);}};

  const w=cabin.width,hw=w/2,[eyeX,,eyeZ]=cabin.eye,[dashY,dashZ]=cabin.dash,floor=cabin.floor,rear=cabin.rear;
  const dashTop=dashY+.07,dashBack=dashZ+.17;

  // Dashboard: one extruded profile with a rolled lip toward the driver, plated and riveted.
  {
    const s=new THREE.Shape();
    s.moveTo(.17,-.16);s.lineTo(.17,.035);s.quadraticCurveTo(.05,.07,-.1,.07);s.quadraticCurveTo(-.17,.07,-.17,.01);s.lineTo(-.15,-.16);s.closePath();
    const g=new THREE.ExtrudeGeometry(s,{depth:w,bevelEnabled:true,bevelThickness:.006,bevelSize:.006,bevelSegments:2,curveSegments:8});
    g.rotateY(Math.PI/2);g.translate(-hw,dashY,dashZ);mesh(g,M.plate);
    // Plate seams and the rivet line along the driver-side lip
    for(const x of [-hw*.34,hw*.34])at(mesh(new THREE.BoxGeometry(.012,.006,.3),M.rust),x,dashTop+.003,dashZ);
    rivets(group,[-hw+.05,dashTop-.005,dashBack-.018],[hw-.05,dashTop-.005,dashBack-.018],Math.round(w/.11));
    // Riveted brass-coloured nameplate and duct-tape repairs
    at(mesh(new THREE.PlaneGeometry(.16,.035),new THREE.MeshStandardMaterial({map:canvasTexture(256,56,(c,W,H)=>{c.fillStyle='#8a6a32';c.fillRect(0,0,W,H);c.strokeStyle='#4a3515';c.lineWidth=4;c.strokeRect(3,3,W-6,H-6);c.fillStyle='#2a1c08';c.font='bold 26px Courier New';c.textAlign='center';c.textBaseline='middle';c.fillText(cabin.plate,W/2,H/2+2);}),roughness:.45,metalness:.7,envMapIntensity:2})),hw*.52,dashTop+.0035,dashZ+.04,-Math.PI/2,0,.04);
    at(mesh(new THREE.BoxGeometry(.16,.003,.05),M.tape),-hw*.15,dashTop+.004,dashZ-.03,0,.5,0);
    at(mesh(new THREE.BoxGeometry(.12,.003,.045),M.tape),-hw*.15,dashTop+.005,dashZ-.03,0,-.7,0);
    at(mesh(new THREE.BoxGeometry(.2,.003,.05),M.tape),hw*.7,dashTop+.004,dashZ+.06,0,.15,0);
  }

  // Instrument binnacle in front of the driver: angled backplate, brow, three backlit dials and lamps.
  const panel=pivot(group,eyeX,dashTop+.035,dashBack-.04,-.42);
  mesh(new THREE.BoxGeometry(.46,.15,.025),M.steel,panel).position.z=-.015;
  at(mesh(new THREE.BoxGeometry(.5,.014,.13),M.rust,panel),0,.083,.03,.18);
  for(const x of [-.245,.245])at(mesh(new THREE.BoxGeometry(.016,.15,.1),M.rust,panel),x,0,.02);
  rivets(panel,[-.215,-.064,.0],[.215,-.064,.0],6,.006);
  const dials=[
    {x:0,y:.005,r:.062,label:'KM/H',marks:['0','25','50','75','100','125','150','175','200']},
    {x:-.15,y:-.005,r:.048,label:'N2O',marks:['0','','25','','50','','75','','F']},
    {x:.15,y:-.005,r:.048,label:'HEAT',marks:['C','','','','','','','','H']}
  ];
  const atlas=dialAtlas(dials),dialFace=new THREE.MeshStandardMaterial({name:'Cockpit dials',map:atlas,emissiveMap:atlas,emissive:0xffffff,emissiveIntensity:1.5,roughness:.5,metalness:0});
  const needles=dials.map((d,index)=>{
    const face=new THREE.CircleGeometry(d.r,40),uv=face.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setX(i,(index+uv.getX(i))/dials.length);
    at(mesh(face,dialFace,panel),d.x,d.y,.002);
    at(mesh(new THREE.TorusGeometry(d.r+.004,.0055,8,40),M.chrome,panel),d.x,d.y,.004);
    at(mesh(new THREE.CylinderGeometry(.008,.008,.008,12).rotateX(Math.PI/2),M.chrome,panel),d.x,d.y,.008);
    const needle=pivot(panel,d.x,d.y,.006);
    const n=new THREE.Mesh(new THREE.BoxGeometry(.004,d.r*.92,.002).translate(0,d.r*.38,0),new THREE.MeshStandardMaterial({color:0xff5a1f,emissive:0xff4a10,emissiveIntensity:2.2,roughness:.4}));
    n.userData.noOcclusion=true;needle.add(n);return needle;
  });
  const lampNames=['N2O','HEAT','ARMR','LOCK'],lampColors=[0x53b9ff,0xff8a1c,0xff2a14,0x7dff4a];
  const lamps=lampColors.map((color,i)=>{
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(color).multiplyScalar(.18),emissive:color,emissiveIntensity:0,roughness:.3});
    at(mesh(new THREE.CylinderGeometry(.008,.009,.008,14).rotateX(Math.PI/2),m,panel,false),-.105+i*.07,-.058,.006);
    at(mesh(new THREE.TorusGeometry(.0095,.0022,6,16),M.chrome,panel),-.105+i*.07,-.058,.008);
    return m;
  });
  at(mesh(new THREE.PlaneGeometry(.28,.018),new THREE.MeshBasicMaterial({transparent:true,toneMapped:false,map:canvasTexture(512,32,(c,W,H)=>{c.fillStyle='#d8c39a';c.font='bold 22px Courier New';c.textAlign='center';c.textBaseline='middle';lampNames.forEach((n,i)=>c.fillText(n,W*(.125+i*.25),H/2+1));})}),panel),0,-.076,.0035);

  // Steering wheel on its column, in the car's own style.
  const [wheelY,wheelZ,radius,tilt]=cabin.wheel;
  const wheel=pivot(group,eyeX,wheelY,wheelZ,-tilt),spin=pivot(wheel,0,0,0);spin.name='Steering wheel';
  const badge=new THREE.MeshStandardMaterial({map:canvasTexture(128,128,(c)=>{c.fillStyle='#1a1714';c.beginPath();c.arc(64,64,62,0,Math.PI*2);c.fill();c.strokeStyle='#c9a45e';c.lineWidth=7;c.beginPath();c.arc(64,64,52,0,Math.PI*2);c.stroke();c.fillStyle='#e0b46a';c.font='bold 46px Impact, Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(cabin.badge,64,68);}),roughness:.4,metalness:.5});
  if(cabin.style==='chain'){
    // A welded chain for a rim: alternating links around the circle, two flat bars across.
    const links=34;for(let i=0;i<links;i++){const a=i/links*Math.PI*2;const link=at(mesh(new THREE.TorusGeometry(.017,.0055,6,12),M.steel,spin),Math.cos(a)*radius,Math.sin(a)*radius,0,0,0,a+Math.PI/2);link.scale.set(1.5,1,1);if(i%2)link.rotation.x=Math.PI/2;}
    for(const a of [0,Math.PI])at(mesh(new THREE.BoxGeometry(radius*.95,.03,.008),M.rust,spin),Math.cos(a)*radius*.5,0,0,0,0,a);
  }else{
    const thick=cabin.style==='rig'?.026:.022;
    mesh(new THREE.TorusGeometry(radius,thick,10,48),M.rubber,spin);
    // Leather wraps at the ten-and-two grips
    for(const a of [Math.PI*.78,Math.PI*.22])for(let k=-2;k<=2;k++){const b=a+k*.055;at(mesh(new THREE.TorusGeometry(thick*1.08,.003,5,10),M.leather,spin),Math.cos(b)*radius,Math.sin(b)*radius,0,Math.PI/2,0,b);}
    const spokes=cabin.style==='rig'?[Math.PI/4,Math.PI*3/4,-Math.PI/4,-Math.PI*3/4]:[0,Math.PI,-Math.PI/2];
    for(const a of spokes){
      // Drilled flat spokes
      const s=new THREE.Shape();s.moveTo(.035,-.017);s.lineTo(radius-.01,-.012);s.lineTo(radius-.01,.012);s.lineTo(.035,.017);s.closePath();
      for(const f of [.4,.62]){const hole=new THREE.Path();hole.absarc(radius*f,0,.0065,0,Math.PI*2,true);s.holes.push(hole);}
      const g=new THREE.ExtrudeGeometry(s,{depth:.006,bevelEnabled:false,curveSegments:10});g.translate(0,0,-.003);g.rotateZ(a);mesh(g,M.steel,spin);
    }
    if(cabin.style==='rig'){const knob=at(mesh(new THREE.SphereGeometry(.022,12,8),M.red,spin),Math.cos(-.5)*radius,Math.sin(-.5)*radius,.03);mesh(new THREE.CylinderGeometry(.006,.006,.03,8).rotateX(Math.PI/2).translate(0,0,-.015),M.chrome,knob);}
  }
  at(mesh(new THREE.CylinderGeometry(.048,.052,.03,24).rotateX(Math.PI/2),M.steel,spin),0,0,0);
  at(mesh(new THREE.CircleGeometry(.04,24),badge,spin),0,0,.0155);
  at(mesh(new THREE.CylinderGeometry(.032,.038,.4,12).rotateX(Math.PI/2),M.plate,wheel),0,0,-.21);
  at(mesh(new THREE.BoxGeometry(.11,.07,.12),M.plate,wheel),0,-.01,-.12);
  for(const s of [-1,1])at(mesh(new THREE.BoxGeometry(.07,.008,.012),M.steel,wheel),s*.075,.005,-.1,0,0,s*-.2);

  // Centre console: toggle switches, the radio and a red N2O button under a flip-up guard; the gear lever.
  const consoleX=Math.min(hw-.12,eyeX+.36),consoleTop=Math.min(dashY-.06,floor+.24);
  at(mesh(new THREE.BoxGeometry(.2,dashY-floor-.02,.5),M.plate),consoleX,(dashY+floor)/2-.02,dashZ+.33);
  at(mesh(new THREE.BoxGeometry(.21,.012,.32),M.rust),consoleX,consoleTop,dashZ+.45);
  const toggles=pivot(group,consoleX,dashY-.03,dashBack+.012,-.5);
  mesh(new THREE.BoxGeometry(.19,.07,.012),M.steel,toggles);
  for(let i=0;i<5;i++){const x=-.07+i*.035;at(mesh(new THREE.CylinderGeometry(.008,.008,.006,10).rotateX(Math.PI/2),M.chrome,toggles),x,0,.009);at(mesh(new THREE.CylinderGeometry(.0028,.0022,.028,6),M.chrome,toggles),x,.006,.016,i%2?.5:-.5);}
  const radio=pivot(group,consoleX,dashY-.11,dashBack+.03,-.25);
  mesh(new THREE.BoxGeometry(.19,.065,.03),M.dark,radio);
  for(const x of [-.075,.075])at(mesh(new THREE.CylinderGeometry(.011,.011,.012,14).rotateX(Math.PI/2),M.chrome,radio),x,0,.02);
  const lcd=document.createElement('canvas');lcd.width=256;lcd.height=48;
  const lcdTexture=new THREE.CanvasTexture(lcd);lcdTexture.colorSpace=THREE.SRGBColorSpace;
  at(mesh(new THREE.PlaneGeometry(.11,.026),new THREE.MeshStandardMaterial({map:lcdTexture,emissiveMap:lcdTexture,emissive:0xffffff,emissiveIntensity:1.4,roughness:.3}),radio,false),0,0,.0155);
  let radioText=(document.getElementById?.('radio-title')?.textContent||`${CITY.name||'WASTELAND'} FM`).toUpperCase(),scroll=0,lcdClock=0;
  document.addEventListener?.('radio-track',e=>{radioText=`${e.detail.index+1}/${e.detail.count} ${e.detail.title}`.toUpperCase();scroll=0;});
  const drawRadio=()=>{const c=lcd.getContext('2d');if(!c?.fillRect)return;c.fillStyle='#160d04';c.fillRect(0,0,256,48);c.fillStyle='#ffae3a';c.font='bold 26px Courier New';c.textBaseline='middle';
    const text=`${radioText}   ·   `,width=c.measureText?.(text).width||256;c.fillText(text,8-scroll%width,25);c.fillText(text,8-scroll%width+width,25);lcdTexture.needsUpdate=true;};
  drawRadio();
  const nitroBase=pivot(group,consoleX-.045,consoleTop+.008,dashZ+.38);
  mesh(new THREE.CylinderGeometry(.03,.034,.014,20),M.steel,nitroBase);
  at(mesh(new THREE.CylinderGeometry(.019,.019,.018,20),M.red,nitroBase),0,.012,0);
  const guard=pivot(nitroBase,0,.016,-.034);
  at(mesh(new THREE.BoxGeometry(.07,.006,.07),new THREE.MeshStandardMaterial({color:0xc9a227,roughness:.5,metalness:.4,transparent:true,opacity:.85}),guard,false),0,.012,.034);
  const shifter=pivot(group,consoleX+.04,consoleTop+.01,dashZ+.52);
  at(mesh(new THREE.CylinderGeometry(.026,.03,.012,14),M.steel,group),consoleX+.04,consoleTop+.008,dashZ+.52);
  at(mesh(new THREE.CylinderGeometry(.006,.008,.2,8),M.chrome,shifter,false),0,.1,0);
  at(mesh(new THREE.SphereGeometry(.024,14,10),id==='raider'?M.bone:M.dark,shifter,false),0,.205,0);

  // Frame: A-pillar plates with welded cage tubes, the header with a sun visor and the mirror.
  let visor=null;
  if(cabin.screen){
    const [baseZ,topZ,baseY,topY]=cabin.screen,length=Math.hypot(topZ-baseZ,topY-baseY),slope=Math.atan2(topZ-baseZ,topY-baseY);
    for(const side of [-1,1]){
      at(mesh(new THREE.BoxGeometry(.09,length,.03),M.rust),side*(hw-.01),(baseY+topY)/2,(baseZ+topZ)/2,slope,0,0);
      rivets(group,[side*(hw-.01)-side*.03,baseY+.04,baseZ+(topZ-baseZ)*.08],[side*(hw-.01)-side*.03,topY-.04,baseZ+(topZ-baseZ)*.92],5,.006);
      // Roll cage: up the pillar, along the roof edge, down behind the seats.
      const x=side*(hw-.07);
      if(!epa)tube([[x,floor+.02,baseZ+.06],[x,baseY,baseZ+.05],[x,topY-.05,topZ+.06],[x,cabin.roof-.04,(topZ+rear)/2],[x,cabin.roof-.05,rear-.12],[x,floor+.05,rear-.15]],.019,M.rust);
      at(mesh(new THREE.BoxGeometry(.05,.05,Math.abs(cabin.cut[1][2]-baseZ)),M.plate),side*(hw+.01),baseY,(baseZ+cabin.cut[1][2])/2);
    }
    if(!epa){
      tube([[-hw+.07,cabin.roof-.05,rear-.12],[0,cabin.roof-.03,rear-.12],[hw-.07,cabin.roof-.05,rear-.12]],.019,M.rust);
      tube([[-hw+.07,cabin.roof-.05,rear-.12],[hw-.07,floor+.1,rear-.15]],.016,M.rust);
    }
    at(mesh(new THREE.BoxGeometry(w+.1,epa?.03:.07,.1),epa?M.leather:M.rust),0,topY-(epa?.01:.02),topZ);
    rivets(group,[-hw+.06,topY-.055,topZ+.051],[hw-.06,topY-.055,topZ+.051],Math.round(w/.13));
    // Sun visor folded up against the header, out of the driver's sight line.
    visor=pivot(group,eyeX,topY-.04,topZ+.03,.12);
    at(mesh(new THREE.BoxGeometry(.32,.014,.14),M.leather,visor),0,0,.07);
    at(mesh(new THREE.BoxGeometry(.26,.003,.012),M.tape,visor),0,-.008,.1);
    // Windscreen crack on the passenger side (not in a cherished EPA).
    const t=epa?-1:.58,cz=baseZ+(topZ-baseZ)*t,cy=baseY+(topY-baseY)*t;
    if(!epa)at(mesh(new THREE.PlaneGeometry(.42,.36),new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,opacity:.75,map:canvasTexture(256,256,(c)=>{
      c.strokeStyle='rgba(235,230,215,.85)';c.lineCap='round';let seed=7;const r=()=>(seed=(seed*16807)%2147483647)/2147483647;
      for(let k=0;k<11;k++){let x=128,y=128,a=k/11*Math.PI*2+r()*.4;c.lineWidth=2.2;c.beginPath();c.moveTo(x,y);for(let s=0;s<7;s++){a+=(r()-.5)*.7;x+=Math.cos(a)*(10+r()*16);y+=Math.sin(a)*(10+r()*16);c.lineTo(x,y);}c.stroke();}
      c.lineWidth=1.2;for(let ring=1;ring<4;ring++){c.beginPath();for(let k=0;k<=24;k++){const a=k/24*Math.PI*2,rr=ring*22+r()*8;c.lineTo(128+Math.cos(a)*rr,128+Math.sin(a)*rr);}c.stroke();}
    })}),group,false),hw*.48,cy,cz+.012,slope-Math.PI/2,0,.3);
  }
  // Rear-view mirror with a swinging skull on a cord.
  const top=cabin.screen?cabin.screen[3]-.06:cabin.roof-.06,mirrorZ=cabin.screen?cabin.screen[1]+(epa?.03:.09):dashZ+.12;
  at(mesh(new THREE.CylinderGeometry(.007,.007,.06,8),M.steel),0,top-.01,mirrorZ);
  const mirror=pivot(group,0,top-.05,mirrorZ+.01,-.1,.12);
  mesh(new THREE.BoxGeometry(.2,.06,.025),M.plate,mirror);
  at(mesh(new THREE.PlaneGeometry(.185,.048),M.mirror,mirror),0,0,.0128);
  const charm=pivot(group,.05,top-.08,mirrorZ+.02);
  mesh(new THREE.CylinderGeometry(.0012,.0012,.11,4).translate(0,-.055,0),M.dark,charm,false);
  const skull=pivot(charm,0,-.125,0);
  if(epa){
    // Fuzzy dice: two plush cubes on cords of different length, pips on every face.
    const dice=cabin.dice||'#f4f1ea',fur=standard('clean plush',{roughness:1,map:canvasTexture(256,256,(c,W,H)=>{
      c.fillStyle=dice;c.fillRect(0,0,W,H);let seed=11;const r=()=>(seed=(seed*16807)%2147483647)/2147483647;
      for(let i=0;i<2600;i++){c.strokeStyle=`rgba(${r()<.5?0:255},${r()<.5?0:255},${r()<.5?0:255},${.05+r()*.07})`;c.lineWidth=1+r()*1.5;const x=r()*W,y=r()*H,a=r()*Math.PI*2;c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.cos(a)*6,y+Math.sin(a)*6);c.stroke();}
      c.fillStyle='#111';for(const [x,y] of [[.25,.25],[.75,.75],[.5,.5],[.75,.25],[.25,.75]])if(r()<.85){c.beginPath();c.arc(x*W,y*H,22,0,Math.PI*2);c.fill();}
    })});
    for(const [dx,drop,turn] of [[-.016,0,.4],[.02,-.03,-.5]]){
      if(drop)mesh(new THREE.CylinderGeometry(.0012,.0012,-drop,4).translate(dx,drop/2,0),M.dark,skull,false);
      const die=new THREE.BoxGeometry(.042,.042,.042,3,3,3),pos=die.attributes.position;
      // Pull the cube a third of the way towards a sphere: soft, stuffed edges.
      for(let i=0;i<pos.count;i++){const v=new THREE.Vector3().fromBufferAttribute(pos,i),round=v.clone().setLength(.025);v.lerp(round,.35);pos.setXYZ(i,v.x,v.y,v.z);}
      die.computeVertexNormals();at(mesh(die,fur,skull),dx,drop-.012,0,.3,turn,.2);
    }
  }else{
    const cranium=new THREE.SphereGeometry(.022,14,10);cranium.scale(1,.95,1.08);mesh(cranium,M.bone,skull);
    at(mesh(new THREE.BoxGeometry(.026,.016,.022),M.bone,skull),0,-.019,.004);
    for(const s of [-1,1])at(mesh(new THREE.SphereGeometry(.0065,8,6),M.dark,skull),s*.0085,-.002,.019);
    at(mesh(new THREE.BoxGeometry(.016,.004,.004),M.dark,skull),0,-.022,.016);
  }

  // Door cards: riveted plates below the windows with a leather pull strap on the driver's door.
  const sill=cabin.screen?cabin.screen[2]:dashTop;
  for(const side of [-1,1]){
    const length=rear-dashZ-.12;
    at(mesh(new THREE.BoxGeometry(.015,sill-floor-.04,length),M.plate),side*(hw-.005),(sill+floor)/2,dashZ+.06+length/2);
    rivets(group,[side*(hw-.015),sill-.03,dashZ+.1],[side*(hw-.015),sill-.03,rear-.1],Math.max(3,Math.round(length/.12)));
    at(mesh(new THREE.BoxGeometry(.018,.03,length*.9),M.rust),side*(hw-.012),floor+.09,dashZ+.06+length/2);
  }
  at(mesh(new THREE.BoxGeometry(.012,.022,.16),M.leather),-(hw-.02),sill-.07,eyeZ-.05);
  at(mesh(new THREE.BoxGeometry(.02,.03,.05),M.chrome),-(hw-.02),sill-.12,eyeZ-.2);

  // Jury-rigged wiring under the dash and a taped splice — or, in the EPA, red LED strips everywhere.
  const wireY=dashY-.13,wireZ=dashBack-.01;
  if(epa){
    // The 740's body is a solid shell up to the waist; its cabin is cut out down to the floor, so the
    // cockpit brings carpet, a firewall and the two front seats in velour.
    at(mesh(new THREE.BoxGeometry(w,.02,rear-dashZ+.3),M.leather),0,floor-.01,(dashZ+rear)/2);
    at(mesh(new THREE.BoxGeometry(w,dashY-floor,.02),M.plate),0,(dashY+floor)/2,dashZ-.17);
    for(const x of [eyeX,-eyeX]){
      at(mesh(new THREE.BoxGeometry(.5,.14,.5),M.leather),x,floor+.2,eyeZ-.08);
      at(mesh(new THREE.BoxGeometry(.5,.62,.12),M.leather),x,floor+.6,eyeZ+.2,-.2,0,0);
      at(mesh(new THREE.BoxGeometry(.26,.16,.1),M.leather),x,floor+.98,eyeZ+.26,-.2,0,0);
    }
    const strip=(len,x,y,z,ry=0)=>at(mesh(new THREE.BoxGeometry(len,.008,.008),M.led),x,y,z,0,ry,0);
    strip(w-.12,0,dashY-.16,dashBack+.005);                                        // under the dash lip
    strip(w-.12,0,dashTop+.012,dashZ-.08);                                          // along the windscreen base
    for(const side of [-1,1]){
      strip(rear-dashZ-.2,side*(hw-.02),sill-.12,(dashZ+rear)/2,Math.PI/2);       // door cards
      strip(.38,side*hw*.5,floor+.02,dashZ+.2);                                     // footwells
      strip(.36,side*hw*.5,floor+.03,rear-.35);                                     // under the seats
    }
    strip(.5,consoleX,consoleTop+.004,dashZ+.45,Math.PI/2);                         // centre console
    // Door speakers: a cone in a chrome ring, circled by an LED ring that pulses with the bass.
    M.speakerLed=standard('clean speaker LED lamp',{color:new THREE.Color(cabin.speaker_led||'#2a9dff').multiplyScalar(.3),emissive:cabin.speaker_led||'#2a9dff',emissiveIntensity:4,roughness:.3});
    for(const side of [-1,1]){
      const x=side*(hw-.012),y=floor+.24,z=dashZ+.36;
      at(mesh(new THREE.CylinderGeometry(.085,.085,.012,24).rotateZ(Math.PI/2),M.rubber),x,y,z);
      at(mesh(new THREE.ConeGeometry(.07,.03,24,1,true).rotateZ(-side*Math.PI/2),M.plate),x-side*.012,y,z);
      at(mesh(new THREE.TorusGeometry(.09,.005,6,32).rotateY(Math.PI/2),M.chrome),x-side*.004,y,z);
      at(mesh(new THREE.TorusGeometry(.102,.005,6,32).rotateY(Math.PI/2),M.speakerLed),x-side*.004,y,z);
    }
  }
  if(!epa)tube([[eyeX-.22,wireY+.05,wireZ-.04],[eyeX-.08,wireY-.06,wireZ+.02],[eyeX+.1,wireY-.04,wireZ+.01],[consoleX-.08,wireY+.02,wireZ-.02]],.006,M.wireRed);
  if(!epa){
    tube([[eyeX-.2,wireY+.04,wireZ-.05],[eyeX-.05,wireY-.08,wireZ+.03],[eyeX+.12,wireY-.05,wireZ],[consoleX-.08,wireY+.01,wireZ-.03]],.006,M.wireBlack);
    tube([[eyeX-.18,wireY+.05,wireZ-.03],[eyeX,wireY-.05,wireZ+.04],[consoleX-.1,wireY-.01,wireZ]],.005,M.wireYellow);
    at(mesh(new THREE.CylinderGeometry(.016,.016,.04,10),M.tape),eyeX-.06,wireY-.065,wireZ+.025,0,0,1.25);
  }

  // Merge the fixed parts per material, within the group that moves them (dash, wheel, mirror...).
  const merge=container=>{
    container.updateWorldMatrix(true,true);
    const inverse=new THREE.Matrix4().copy(container.matrixWorld).invert(),byMaterial=new Map();
    for(const o of container.children)if(o.isMesh&&o.userData.fixed){if(!byMaterial.has(o.material))byMaterial.set(o.material,[]);byMaterial.get(o.material).push(o);}
    for(const [material,parts] of byMaterial){
      if(parts.length<2)continue;
      const geometry=mergeGeometries(parts.map(o=>{const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();for(const name of Object.keys(g.attributes))if(!['position','normal','uv'].includes(name))g.deleteAttribute(name);return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld));}));
      if(!geometry)continue;
      for(const o of parts){o.removeFromParent();o.geometry.dispose();}
      mesh(geometry,material,container);
    }
  };
  // Sub-assemblies that never move flatten into the cockpit itself; the wheel merges inside its own pivots.
  const flatten=assembly=>{
    if(!assembly)return;group.updateWorldMatrix(true,true);
    const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert();
    for(const o of [...assembly.children])if(o.isMesh&&o.userData.fixed){new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld).decompose(o.position,o.quaternion,o.scale);o.removeFromParent();group.add(o);}
  };
  for(const assembly of [panel,toggles,radio,mirror,nitroBase,visor])flatten(assembly);
  merge(group);merge(spin);merge(wheel);merge(skull);

  let inside=false,last=null,lastSpeed=0,swingX=0,swingZ=0,swingVX=0,swingVZ=0,guardAngle=0,shift=0,blink=0;
  return {
    set(on){
      if(on===inside)return;inside=on;group.visible=on;uniforms.cabinCut.value=on&&cabin.cut?1:0;last=null;
      // The cut-away shell still fills the occlusion pass's depth; keep the whole car out of it.
      for(const m of body)m.userData.noOcclusion=on||occlusion.get(m);
    },
    update(state,game={},beat=0){
      if(!inside)return;
      const now=performance.now(),dt=last===null?0:Math.min(.05,(now-last)/1000);last=now;blink+=dt;
      uniforms.cabinInverse.value.copy(root.matrixWorld).invert();
      const speed=state.speed||0,steer=state.steer||0;
      spin.rotation.z=-steer*2.4;
      const sweep=v=>Math.PI*.75-Math.min(1,Math.max(0,v))*Math.PI*1.5;
      needles[0].rotation.z=sweep(Math.abs(speed)*3.6/200+Math.sin(now*.04)*.002*Math.min(1,Math.abs(speed)));
      needles[1].rotation.z=sweep((state.nitro??100)/100);
      needles[2].rotation.z=sweep(game.heat??0);
      const maxHealth=VEHICLES[game.vehicle]?.health||game.health||1,flash=Math.sin(blink*12)>0;
      const on=[state.boosting,game.overheated&&flash,(game.health??maxHealth)/maxHealth<.3&&flash,game.weapon==='rockets'&&game.rocketTarget?.health>0];
      lamps.forEach((m,i)=>m.emissiveIntensity=on[i]?3.4:0);
      // The N2O guard flips up while boosting; the lever follows forward, neutral or reverse.
      guardAngle+=((state.boosting?-1.9:0)-guardAngle)*(1-Math.exp(-10*dt));guard.rotation.x=guardAngle;
      shift+=((speed>.8?-.32:speed<-.8?.32:0)-shift)*(1-Math.exp(-14*dt));shifter.rotation.x=shift;
      // The skull swings on a damped spring, pushed by braking, acceleration and cornering.
      if(dt>0){
        const accel=(speed-lastSpeed)/dt,lateral=speed*steer;
        swingVX+=(-accel*.012-swingX)*55*dt-swingVX*2.2*dt;swingVZ+=(lateral*.018-swingZ)*55*dt-swingVZ*2.2*dt;
        swingX=Math.max(-.9,Math.min(.9,swingX+swingVX*dt));swingZ=Math.max(-.9,Math.min(.9,swingZ+swingVZ*dt));
        charm.rotation.set(swingX,0,swingZ);skull.rotation.y=Math.sin(now*.0016)*.4+swingZ;
      }
      lastSpeed=speed;
      if((lcdClock+=dt)>.08){lcdClock=0;scroll+=2;drawRadio();}
      if(M.speakerLed)M.speakerLed.emissiveIntensity=1+beat*7;
    }
  };
}
