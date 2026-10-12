import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { createCity } from './city.js';
import { createRoadNetwork } from './roads.js';
import { loadVehicles } from './vehicles.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHUD } from './hud.js';
import { createGame } from './game.js';
import { VEHICLES,angleDiff } from './physics.js';
import { loadWeathering,createWasteland } from './wasteland.js';
import { createDestruction } from './destruction.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createGaragePreview } from './garage.js';
import { WorldOcclusionPass } from './occlusion.js';
import {WEAPONS} from './weapons.js';
import {createArenaClient,arenaURL,arenaMapId} from './arena-client.js';
import {collisionMaterial} from './collision-audio.js';
import {createResolutionGovernor} from './resolution.js';
import {createBVHBuilder} from './bvh-builder.js';
import {createCityBatches} from './city-batches.js';
import {cabinOf} from './cockpit.js';
import {CITY,loadCityConfig} from './city-config.js';

THREE.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree=disposeBoundsTree;
THREE.Mesh.prototype.raycast=acceleratedRaycast;
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const touch=params.has('touch')||matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('is-touch',touch);
if(touch){
  const bar=document.createElement('div');bar.id='mobile-hud-bar';
  bar.append(document.querySelector('.hud-brand'),document.querySelector('.car-status'),document.querySelector('.weapon-picker'),document.querySelector('.hud-actions'));
  $('hud').prepend(bar);
  $('recover-button').textContent='↻';$('map-button').textContent='MAP';$('camera-button').textContent='VIEW';
  $('pause').querySelector('p').textContent='Left thumb: steer, accelerate and reverse. Right thumb: hold FIRE. Tap the top row to choose a weapon; N₂O boosts and DRIFT uses the handbrake.';
}
let quality=touch?'LOW':'HIGH',vehicle='interceptor',mode='survival',state='garage',view='chase';
let arena=null;
const resolution=createResolutionGovernor();
let renderer,scene,camera,composer,bloom,ssao,city,network,vehicles,game,hud,audio,wasteland,preview,ready=false,pausedFrom='playing';
let cameraHeading=Math.PI/2,last=performance.now(),hudTimer=0,fps=0,frames=0,fpsTime=0,fireDemo=0,driveDemo=0,fireHeldSince=0,lastFireHold=0;
const spawn={x:0,z:0};
function fail(error){console.error(error);$('fatal-message').textContent=error.message||'The 3D engine could not start. Please reload in a browser with WebGL enabled.';$('fatal').hidden=false;}
function progress(p,text){$('load-percent').textContent=Math.round(p*100)+'%';$('loading-fill').style.width=p*100+'%';if(text)$('load-text').textContent=text;}
function selectVehicle(id){
  vehicle=id;const spec=VEHICLES[id];
  if(preview&&state==='garage')preview.show(id);
  audio?.setVehicle?.(id);
  document.querySelectorAll('.vehicle').forEach(b=>b.classList.toggle('active',b.dataset.vehicle===id));
  $('rig-name').textContent=spec.name;$('rig-number').textContent='NO. '+spec.number;$('rig-description').textContent=spec.description;
  $('rig-stats').replaceChildren();
  for(const [label,value]of [['SPEED',spec.maxSpeed/40],['ARMOR',spec.health/200],['RAM',spec.damage/1.6]]){
    const el=document.createElement('div');el.className='rig-stat';el.textContent=label;
    const bar=document.createElement('div');bar.className='bar';const fill=document.createElement('span');fill.style.width=Math.round(value*100)+'%';bar.append(fill);el.append(bar);$('rig-stats').append(el);
  }
}
document.querySelectorAll('.vehicle').forEach(b=>b.addEventListener('click',()=>selectVehicle(b.dataset.vehicle)));
// Bonus vehicles of the installed city join the picker (after the city config has loaded).
function addBonusVehicles(){
  const picker=document.querySelector('.vehicle-picker');if(!picker)return;
  for(const v of CITY.bonus_vehicles||[]){
    if(!VEHICLES[v.id]||picker.querySelector(`[data-vehicle="${v.id}"]`))continue;
    const b=document.createElement('button');b.className='vehicle bonus';b.dataset.vehicle=v.id;
    const number=document.createElement('span');number.textContent=VEHICLES[v.id].number;b.append(number,VEHICLES[v.id].name);
    b.title='Bonus vehicle';b.addEventListener('click',()=>selectVehicle(v.id));picker.append(b);
  }
  const count=picker.querySelectorAll('.vehicle').length,label=document.querySelector('.rig-top span');
  if(label)label.textContent=`YOUR MACHINE / ${count} CLASSES`;
}
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>{
  mode=b.dataset.mode;document.querySelectorAll('.mode').forEach(el=>el.classList.toggle('active',el===b));
  $('mode-description').textContent=mode==='survival'?'Survive three waves. Clear every raider. Own the city.':mode==='arena'?'Battle other drivers. Five seconds to respawn. Every street is open.':'Every street is open. Take your time. Find your own route.';
  $('arena-options').hidden=mode!=='arena';
  if(ready)$('start-label').textContent=mode==='survival'?'ENTER THE STREET WAR':mode==='arena'?'JOIN THE ARENA':CITY.text.start_roam;
}));
$('quality').addEventListener('click',()=>{quality=quality==='HIGH'?'LOW':'HIGH';$('quality').textContent=quality;applyQuality();});
function applyQuality(){
  if(!renderer)return;renderer.setPixelRatio(Math.min(devicePixelRatio,quality==='LOW'?1:1.5)*resolution.scale);renderer.shadowMap.enabled=quality==='HIGH';renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.needsUpdate=true;
  if(composer){composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(innerWidth,innerHeight);bloom.enabled=quality==='HIGH';if(ssao){ssao.enabled=quality==='HIGH';ssao.setSize(Math.round(innerWidth*.6),Math.round(innerHeight*.6));}}
  if(state==='garage')preview?.resize();
}
$('sound-toggle').addEventListener('click',()=>{if(audio)$('sound-toggle').textContent=audio.toggle()?'AUDIO ON':'AUDIO OFF';});
$('music-button').addEventListener('click',()=>$('music-file').click());
$('radio-next').addEventListener('click',()=>audio?.nextMusic());
$('radio-previous').addEventListener('click',()=>audio?.previousMusic());
document.addEventListener('radio-track',e=>{$('radio-title').textContent=`${e.detail.index+1}/${e.detail.count} · ${e.detail.title.toUpperCase()}`;});
$('music-file').addEventListener('change',e=>{
  const file=e.target.files[0];if(file&&audio)audio.loadMusic(URL.createObjectURL(file),file.name);
});
async function startSession(){
  if(!ready)return;
  $('start').disabled=true;
  try{
    await audio.unlock();
    // Starting a second run can happen far from the spawn's previously unloaded tiles.
    await city.ensure(spawn,75);
    progress(1,`${network.map.roads.length} streets & paths / ${CITY.text.ready}`);
    arena?.close();arena=null;game.reset(vehicle,mode);
    if(mode==='arena'){
      $('arena-status').textContent='Connecting to the arena…';
      const config=await fetch('arena-config.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
      const client=createArenaClient({url:arenaURL(config),name:$('arena-name').value,room:$('arena-room').value,map:arenaMapId(`${CITY.slug}@${CITY.center||''}`),vehicle,onEvent:m=>game.arenaEvent(m),onStatus:s=>{
        $('arena-status').textContent=s.connected?`${s.room} · ${s.players}/8 drivers`:'Connection lost. Return to the garage to reconnect.';
        if(!s.connected&&state!=='garage')hud.toast('ARENA CONNECTION LOST — RETURN TO GARAGE',8);
      }});
      try{await client.connect();}catch(e){client.close();throw e;}
      arena=client;game.setArena(client);await game.recover(false);
    }
    preview.leave();state='playing';view='chase';$('camera-button').dataset.view=view;cameraHeading=game.state.player.heading;mouseFire=weaponFire=false;fireDemo=driveDemo=0;
    camera.position.set(spawn.x+8,5.8,spawn.z);input.clear();
    $('garage').hidden=true;$('hud').hidden=false;$('pause').hidden=$('result').hidden=$('map-screen').hidden=true;
    $('mission-label').textContent=mode==='survival'?'STREET WAR':mode==='arena'?'ONLINE ARENA':'FREE ROAM';
    updateCamera(1,game.state.player,{});renderWorld();
    $('start').disabled=false;
  }catch(e){$('start').disabled=false;if(mode==='arena'){$('arena-status').textContent=e.message;audio.pause(true);preview.show(vehicle);}else fail(e);}
}
$('start').addEventListener('click',startSession);$('retry').addEventListener('click',startSession);
function pause(){
  if(state==='playing'){state='paused';$('pause').hidden=false;audio.pause(true);input.clear();mouseFire=weaponFire=false;fireDemo=driveDemo=0;}
  else if(state==='paused'){state='playing';$('pause').hidden=true;audio.pause(false);input.clear();}
}
$('pause-button').addEventListener('click',pause);$('resume').addEventListener('click',pause);
function garage(){arena?.close();arena=null;game.setArena(null);state='garage';$('garage').hidden=false;$('hud').hidden=true;$('pause').hidden=$('result').hidden=$('map-screen').hidden=true;audio.pause(true);input.clear();preview.show(vehicle);}
$('return-garage').addEventListener('click',garage);$('result-garage').addEventListener('click',garage);
function toggleMap(){
  if(state==='playing'||state==='paused'){pausedFrom=state;state='map';$('pause').hidden=true;$('map-screen').hidden=false;audio.pause(true);input.clear();hud.showMap(game.state);}
  else if(state==='map'){state=pausedFrom;$('map-screen').hidden=true;$('pause').hidden=state!=='paused';audio.pause(state!=='playing');input.clear();}
}
$('map-button').addEventListener('click',toggleMap);$('camera-button').addEventListener('click',e=>{cycleView();e.currentTarget.blur();});$('minimap').addEventListener('click',toggleMap);$('close-map').addEventListener('click',toggleMap);
const input=createInput(code=>{
  if(code==='Tab'||code==='KeyM')toggleMap();
  if(code==='Escape'){if(state==='map')toggleMap();else pause();}
  if(code==='KeyC')cycleView();
  if(code==='KeyR'&&(state==='playing'||state==='paused'))recoverCar();
  if(state==='playing'&&/^Digit[1-4]$/.test(code))game.setWeapon(Object.keys(WEAPONS)[Number(code.slice(-1))-1]);
  if(state==='playing'&&code==='KeyE'){const ids=Object.keys(WEAPONS);game.setWeapon(ids[(ids.indexOf(game.state.weapon)+1)%ids.length]);}
  if(code==='Enter'&&state==='garage'&&ready)startSession();
});
document.querySelectorAll('[data-weapon]').forEach(button=>button.addEventListener('click',()=>{if(state==='playing')game.setWeapon(button.dataset.weapon);}));
$('weapon-fire').addEventListener('click',e=>{if(state==='playing'&&(e.detail===0||lastFireHold<180))game.fireBurst();});
$('weapon-fire').addEventListener('pointerdown',e=>{if(state==='playing'){fireHeldSince=performance.now();weaponFire=true;$('weapon-fire').setPointerCapture(e.pointerId);}});
for(const event of ['pointerup','pointercancel'])$('weapon-fire').addEventListener(event,()=>{lastFireHold=performance.now()-fireHeldSince;weaponFire=false;});
async function recoverCar(manual=true){
  if(!game||!['playing','paused'].includes(state)||game.state.recovering)return;
  if(state==='paused')pause();
  input.clear();mouseFire=weaponFire=false;fireDemo=driveDemo=0;$('recover-button').disabled=true;$('unstuck-button').disabled=true;
  try{
    if(await game.recover(manual)){
      cameraHeading=game.state.player.heading;
      updateCamera(1,game.state.player,{});
    }
  }catch(e){console.error(e);hud.toast('STREET LOADING INTERRUPTED — TRY RESPAWN AGAIN',4);}
  finally{$('recover-button').disabled=false;$('unstuck-button').disabled=false;$('stuck-prompt').hidden=true;}
}
$('recover-button').addEventListener('click',()=>recoverCar());$('unstuck-button').addEventListener('click',()=>recoverCar());$('pause-recover').addEventListener('click',()=>recoverCar());
addEventListener('blur',()=>{if(state==='playing')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='playing')pause();});
let mouseFire=false,weaponFire=false;
$('game').addEventListener('pointerdown',e=>{if(!touch&&state==='playing'&&e.button===0)mouseFire=true;});
addEventListener('pointerup',()=>mouseFire=weaponFire=false);addEventListener('blur',()=>mouseFire=weaponFire=false);
$('game').addEventListener('contextmenu',e=>e.preventDefault());
function onEnd(win,g){
  state='ended';input.clear();mouseFire=false;
  $('result').hidden=false;$('result-eyebrow').textContent=win?CITY.text.win_eyebrow:'END OF THE ROAD';
  $('result-title').textContent=win?'STILL STANDING.':'WRECKED.';
  $('result-copy').textContent=win?'Three waves down. One city reclaimed. The streets will remember your engine.':'The road took its share. Pick your machine, find a better line, and bring it home.';
  $('result-stats').textContent=`${g.kills} RAIDERS / ${g.scrap} SCRAP / ${Math.floor(g.time/60)}:${String(Math.floor(g.time%60)).padStart(2,'0')}`;
}
const follow=new THREE.Vector3(),aim=new THREE.Vector3(),camDir=new THREE.Vector3(),safeCam=new THREE.Vector3();
const cockpitEye=new THREE.Vector3(),cockpitTurn=new THREE.Euler(0,0,0,'YXZ');let cockpitGlance=0;
const VIEWS=['chase','cockpit','hood'];
function cycleView(){if(state!=='playing')return;view=VIEWS[(VIEWS.indexOf(view)+1)%VIEWS.length];$('camera-button').dataset.view=view;}
let sun,sunDirection;
function updateCamera(dt,s,controls){
  cameraHeading+=angleDiff(s.heading,cameraHeading)*(1-Math.exp(-6*dt));
  const fx=-Math.sin(cameraHeading),fz=-Math.cos(cameraHeading),back=controls.lookBack?-1:1;
  const rig=game.state.vehicle==='wartruck',bob=s.heave||0;
  aim.set(s.x,s.y+1.18+bob*.4,s.z);
  if(view==='cockpit'){
    // Ride with the chassis: full heading and pitch, softened roll, and a small glance into turns.
    const car=game.playerMesh;car.updateMatrixWorld();
    camera.position.copy(cockpitEye.fromArray(cabinOf(game.state.vehicle).eye)).applyMatrix4(car.matrixWorld);
    cockpitGlance+=(-(s.steer||0)*.14-cockpitGlance)*(1-Math.exp(-5*dt));
    // A portrait phone sees a tall, narrow slice: lift the gaze so the road, not the dashboard, fills it.
    cockpitTurn.set((s.pitch||0)*.85+(camera.aspect<1?.09:0),s.heading+(back<0?Math.PI:0)+cockpitGlance,(s.roll||0)*.55);camera.quaternion.setFromEuler(cockpitTurn);
  }else if(view==='hood'){
    const height=rig?2.92:1.6;
    camera.position.set(s.x+fx*2.1,s.y+height+bob,s.z+fz*2.1);camera.lookAt(s.x+fx*back*24,s.y+height+bob+(s.pitch||0)*14,s.z+fz*back*24);camera.rotateZ((s.roll||0)*.4);
  }else{
    const distance=(rig?10:7.9)+Math.abs(s.speed)*.04;
    follow.set(s.x-fx*distance*back,s.y+(rig?5.2:4.25)+bob*.45,s.z-fz*distance*back);
    if(view==='fx')follow.set(s.x+Math.cos(cameraHeading)*11-fx*4,s.y+5.3,s.z-Math.sin(cameraHeading)*11-fz*4);
    camDir.subVectors(follow,aim);const len=camDir.length();camDir.normalize();
    const obstruction=city.solidRay(aim,camDir,len);
    if(obstruction&&obstruction.distance>1.5)follow.copy(aim).addScaledVector(camDir,Math.max(1.8,obstruction.distance-.5));
    camera.position.lerp(follow,1-Math.exp(-9*dt));
    safeCam.set(s.x+fx*6*back,s.y+1.1,s.z+fz*6*back);camera.lookAt(safeCam);
  }
  // Inside the car a wider lens keeps the pillars from crowding the road.
  vehicles.setBeat(audio?.level?.());
  vehicles.setCockpit(game.playerMesh,view==='cockpit',s,game.state);
  const targetFov=(view==='cockpit'?(camera.aspect<1?-4:8):0)+(s.boosting?78:Math.min(72,63+Math.abs(s.speed)*.13));
  camera.fov+=(targetFov-camera.fov)*(1-Math.exp(-3*dt));camera.updateProjectionMatrix();
  const center=new THREE.Vector3(s.x,s.y||0,s.z);sun.target.position.copy(center);sun.position.copy(center).addScaledVector(sunDirection,150);
  const shake=game?.state.cameraShake||0;
  if(shake){camera.position.x+=(Math.random()-.5)*shake;camera.position.y+=(Math.random()-.5)*shake*.65;game.state.cameraShake=Math.max(0,shake-dt*.9);}
}
function frame(now){
  requestAnimationFrame(frame);
  if(!ready)return;
  const dt=Math.min((now-last)/1000,.06);last=now;
  if(state==='garage'){preview?.render(now,dt);return;}
  if(state==='paused'||state==='map'){
    if(arena){game.update(dt,{});hud.update(dt,game.state,camera);renderWorld();}
    return;
  }
  fpsTime+=dt;frames++;
  if(fpsTime>1){fps=Math.round(frames/fpsTime);fpsTime=0;frames=0;}
  const controls=input.read();controls.fire=controls.fire||mouseFire||weaponFire||fireDemo>0;
  fireDemo=Math.max(0,fireDemo-dt);
  if(driveDemo>0){controls.throttle=driveDemo>1.2?1:0;controls.brake=driveDemo<=1.2&&game.state.player.speed>.5?1:0;controls.steer=0;driveDemo=Math.max(0,driveDemo-dt);}
  if(state==='playing'){
    // Equal substeps of at most 1/90 s that add up to the frame. Fixed 1/90 s steps moved the car
    // one or two steps on alternate 60 Hz frames, which looked like judder at a steady 60 fps.
    const steps=Math.min(6,Math.ceil(dt*90-1e-6));
    for(let i=0;i<steps;i++){game.update(dt/steps,controls);if(state!=='playing')break;}
    if(resolution.update(dt))applyQuality();
    const stuck=game.state.stuckTime;
    $('stuck-prompt').hidden=stuck<1.5||game.state.recovering;
    if(stuck>=1.5)$('stuck-message').textContent=`STUCK — AUTO RESPAWN IN ${Math.max(1,Math.ceil(6-stuck))}s`;
    if(stuck>=6&&!game.state.recovering)recoverCar(false);
    updateCamera(dt,game.state.player,controls);city.updateProps(dt,game.state.player);city.update(dt,{x:game.state.player.x-Math.sin(game.state.player.heading)*20,z:game.state.player.z-Math.cos(game.state.player.heading)*20},camera.position);wasteland.update(dt,game.state.player);
  }else if(state==='ended')game.update(dt,controls);
  if((hudTimer-=dt)<=0){hudTimer=.06;hud.update(.06,game.state,camera);}
  renderWorld();
}
// Draw the shadow map once per frame. With autoUpdate the occlusion pass's second scene render
// redrew every shadow caster, about a quarter of all draw calls.
function renderWorld(){renderer.shadowMap.needsUpdate=true;composer.render();}
async function boot(){
  try{
    renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:!touch,powerPreference:'high-performance'});
    renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=.88;
    renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;applyQuality();
    // Error checks read shader logs synchronously and stall on every new program; keep them for ?debug.
    renderer.debug.checkShaderErrors=params.has('debug');
    scene=new THREE.Scene();scene.background=new THREE.Color(0x796650);scene.fog=new THREE.FogExp2(0x796650,.025);
    camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.12,1200);
    composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
    ssao=new WorldOcclusionPass(scene,camera,innerWidth*.6,innerHeight*.6,12);ssao.kernelRadius=1.3;ssao.minDistance=.001;ssao.maxDistance=.035;composer.addPass(ssao);
    bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.24,.5,1.6);composer.addPass(bloom);
    composer.addPass(new ShaderPass({uniforms:{tDiffuse:{value:null}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D tDiffuse;varying vec2 vUv;
      void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float l=dot(c,vec3(.2126,.7152,.0722));
      c=mix(vec3(l),c,.91);c*=vec3(1.025,.99,.96);
      vec2 p=(vUv-.5)*vec2(1.0,.8);float vignette=1.0-smoothstep(.15,.72,length(p))*.26;
      gl_FragColor=vec4(c*vignette,1.0);}`
    }));composer.addPass(new OutputPass());applyQuality();
    scene.add(new THREE.HemisphereLight(0x929eaa,0x3b281c,.7));
    sunDirection=new THREE.Vector3(-.72,.075,.58).normalize();sun=new THREE.DirectionalLight(0xffb576,1.35);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-65,right:65,top:65,bottom:-65,near:5,far:330});sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.0003;sun.shadow.normalBias=.12;scene.add(sun,sun.target);
    const sky=new Sky();sky.scale.setScalar(2000);sky.material.uniforms.turbidity.value=20;sky.material.uniforms.rayleigh.value=.5;sky.material.uniforms.mieCoefficient.value=.015;sky.material.uniforms.sunPosition.value.copy(sunDirection);
    // Sky's HDR radiance needs a dusk scale; otherwise pale stone glows white
    // even with a dim sun and no emissive material.
    const pmrem=new THREE.PMREMGenerator(renderer),envScene=new THREE.Scene();envScene.add(sky.clone());scene.environment=pmrem.fromScene(envScene,.05).texture;scene.environmentIntensity=.055;pmrem.dispose();
    // A camera-centred dusk sky replaces the flat, uniformly brown backdrop.
    const skyDome=new THREE.Mesh(new THREE.SphereGeometry(600,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
      uniforms:{sunDirection:{value:sunDirection}},vertexShader:'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform vec3 sunDirection;varying vec3 vDirection;void main(){vec3 d=normalize(vDirection);
        float h=smoothstep(-.03,.65,d.y);vec3 color=mix(vec3(.335,.225,.15),vec3(.055,.074,.105),h);
        float glow=pow(max(dot(d,sunDirection),0.0),18.0);color+=vec3(.65,.25,.065)*glow*.52;
        float sun=pow(max(dot(d,sunDirection),0.0),2200.0);color+=vec3(1.0,.55,.22)*sun*1.8;
        float bands=sin(d.x*15.0+d.z*23.0+sin(d.y*42.0))*sin(d.y*60.0+d.z*12.0);
        color*=1.0-bands*.045*smoothstep(.08,.3,d.y);gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}));skyDome.userData.noOcclusion=true;skyDome.frustumCulled=false;skyDome.onBeforeRender=()=>{skyDome.position.copy(camera.position);skyDome.updateMatrixWorld();};scene.add(skyDome);
    // Decode compressed city tiles in workers; on the main thread each tile cost 5-15 ms of WebAssembly.
    MeshoptDecoder.useWorkers(2);
    const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    progress(.02,'Reading the city…');
    await loadCityConfig();Object.assign(spawn,{x:CITY.spawn.x,z:CITY.spawn.z});addBonusVehicles();
    progress(.05,'Reading the street network…');
    const map=await fetch('city/map.json').then(r=>{if(!r.ok)throw new Error('City map is missing. Build a city with: python3 wasteland.py build <place>');return r.json();});
    network=createRoadNetwork(map);hud=createHUD(network);
    progress(.1,'Loading armor and engines…');
    const weathering=await loadWeathering();vehicles=await loadVehicles(loader,weathering);
    preview=createGaragePreview(renderer,vehicles,scene.environment,$('garage-preview'),$('game'));
    progress(.2,CITY.text.loading);
    audio=await createAudio();audio.setVehicle(vehicle);
    if(audio.musicTitle)$('radio-title').textContent=`1/${audio.trackCount} · ${audio.musicTitle.toUpperCase()}`;
    city=await createCity(scene,loader,renderer,{lite:touch,weathering,buildBVH:createBVHBuilder(),// Opt-in until inserting streamed tiles costs less than it saves (see deploy/README.md).
      batches:params.has('batch')?createCityBatches(scene):null,lod:!params.has('nolod'),heightAt:network.heightAt,onProgress:p=>progress(.35+p*.6,'Preparing the streets…')});
    await city.ensure(spawn,80);
    const effects=createEffects(scene,camera),destruction=createDestruction(scene,effects);
    city.damage=destruction.damage;city.clearDamage=destruction.clear;
    game=createGame({scene,city,network,vehicles,effects,audio,hud,onEnd});
    wasteland=createWasteland(scene,network,city,{lite:touch});
    progress(1,`${map.roads.length} streets & paths / ${CITY.text.ready}`);ready=true;last=performance.now();
    $('start').disabled=false;$('start-label').textContent='ENTER THE STREET WAR';$('quality').textContent=quality;
    preview.show(vehicle);
    if(params.has('debug')){
      window.battlecars={game,network,city,vehicles,renderer,scene,camera,effects,destruction,audio,get fps(){return fps;},get state(){return state;}};
      const panel=document.createElement('div');panel.id='debug-controls';panel.style.cssText='position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:12;display:flex;gap:8px;font:9px monospace';
      const button=document.createElement('button');button.textContent='SHOW FACADE IMPACT';button.style.cssText='background:#1b1c17;border:1px solid #b39162;padding:8px 12px;color:#dfcdaa';
      const status=document.createElement('span');status.id='debug-status';status.style.cssText='background:#1b1c17;padding:8px 12px;color:#dfcdaa';
      button.onclick=()=>{
        if(state!=='playing')return;const s=game.state.player,origin=new THREE.Vector3(s.x,s.y+2.2,s.z),ray=new THREE.Raycaster();ray.firstHitOnly=true;ray.far=90;
        const buildings=city.colliders.filter(o=>/Building|Domkyrka|Facade|Wall/i.test(o.name+' '+o.parent?.name));
        const candidates=buildings.map(mesh=>{
          if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const center=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).getCenter(new THREE.Vector3());
          return {mesh,center,d:Math.hypot(center.x-s.x,center.z-s.z)};
        }).filter(o=>o.d>8&&o.d<90).sort((a,b)=>a.d-b.d);
        let found=false,rayHits=0;
        for(const target of candidates){
          const heading=Math.atan2(-(target.center.x-s.x),-(target.center.z-s.z));if(Math.abs(angleDiff(heading,s.heading))>.8)continue;
          ray.set(origin,new THREE.Vector3(-Math.sin(heading),0,-Math.cos(heading)));
          const hits=ray.intersectObjects(buildings,false);rayHits+=hits.length;
          const hit=hits.find(h=>Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y)<.5);if(!hit)continue;
          destruction.damage(hit,480);effects.tracer(origin,hit.point);effects.emit(hit.point,40,'explosion');audio.effect('explosion',.65);game.state.cameraShake=.3;found=true;break;
        }
        button.textContent=found?'SHOW FACADE IMPACT':`NO FACADE: ${buildings.length}/${candidates.length}/${rayHits} AT ${s.y.toFixed(1)}m`;
      };
      const propButton=document.createElement('button');propButton.textContent='PROP CRASH DEMO';propButton.style.cssText=button.style.cssText;
      propButton.onclick=()=>{
        if(state!=='playing')return;
        const p=game.state.player,prop=city.props.filter(o=>!o.broken&&o.size.y<3&&Math.hypot(o.center.x-p.x,o.center.z-p.z)<55).sort((a,b)=>Math.hypot(a.center.x-p.x,a.center.z-p.z)-Math.hypot(b.center.x-p.x,b.center.z-p.z))[0];
        if(!prop){hud.toast('NO SMALL STREET PROP NEARBY');return;}
        const direction=new THREE.Vector3(prop.center.x-p.x,0,prop.center.z-p.z).normalize(),point=prop.center.clone();
        const hit={object:prop.meshes[0],point},response=city.ramProp(hit,{vx:direction.x*14,vz:direction.z*14},VEHICLES[game.state.vehicle]);
        if(response){effects.emit(point,16,'rubble');audio.impact({material:collisionMaterial(hit),speed:14,mass:VEHICLES[game.state.vehicle].mass});hud.toast(`OBSTACLE MOVED / ${Math.round(response.retained*100)}% SPEED RETAINED`);}
      };
      const fireButton=document.createElement('button');fireButton.textContent='WEAPON FX DEMO / 8s';fireButton.style.cssText=button.style.cssText;
      fireButton.onclick=()=>{if(state==='playing')fireDemo=fireDemo>0?0:8;};
      const driveButton=document.createElement('button');driveButton.textContent='DRIVE CHECK / 5s';driveButton.style.cssText=button.style.cssText;
      driveButton.onclick=()=>{if(state==='playing')driveDemo=driveDemo>0?0:5.2;};
      const angleButton=document.createElement('button');angleButton.textContent='FX SIDE CAMERA';angleButton.style.cssText=button.style.cssText;
      angleButton.onclick=()=>{if(state==='playing'){view=view==='fx'?'chase':'fx';updateCamera(1,game.state.player,{});}};
      panel.style.maxWidth='94vw';panel.style.flexWrap='wrap';panel.style.justifyContent='center';
      panel.append(button,propButton,fireButton,driveButton,angleButton,status);document.body.append(panel);
      setInterval(()=>{const p=game.state.player;status.textContent=`${fps} FPS / X ${p.x.toFixed(1)} Z ${p.z.toFixed(1)} / ${game.state.flaming?'JET ON':'JET OFF'} / ${game.arsenal.fuelFires.length} FUEL FIRES / ${destruction.count} IMPACTS / ${city.props.filter(p=>p.broken).length} PROPS / ${game.state.recoveries||0} RESPAWNS / ${game.state.enemyRecoveries||0} AI RECOVERIES`;},1000);
    }
    if(params.get('autostart')==='roam'){mode='roam';await startSession();}
  }catch(e){fail(e);}
}
addEventListener('resize',()=>{if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();applyQuality();});
$('game').addEventListener('webglcontextlost',e=>{e.preventDefault();if(state==='playing')pause();fail(new Error('The browser released the graphics context. Reload to restart; choose LOW detail if it happens again.'));});
selectVehicle(vehicle);requestAnimationFrame(frame);boot();
// Keep damage and respawn running when a driver changes browser tab.
setInterval(()=>{if(document.hidden&&arena&&['playing','paused','map'].includes(state)&&!game.state.recovering)game.update(.1,{});},100);
addEventListener('pagehide',()=>arena?.close());
