import * as THREE from 'three';
import { createCarState, stepCar, angleDiff, clamp, VEHICLES, segmentCircle,carContact,kineticEnergy,vehicleImpact,applyImpactVelocity } from './physics.js';
import { findRecoveryPose } from './recovery.js';
import {createWeapons} from './weapons.js';
import {wheelContacts,roadProfile,stepSuspension,setGroundReference,followGround,chassisGround} from './suspension.js';
import {wallImpact} from './collision-response.js';
import {drivingCorridorClear,enemyDrivingInput,trackEnemyProgress} from './ai-driving.js';
import {collisionMaterial} from './collision-audio.js';
import {createArenaEffects} from './arena-effects.js';
import {CITY} from './city-config.js';

export function createGame({scene,city,network,vehicles,effects,audio,hud,onEnd}){
  const terrainY=(x,z)=>city.heightAt?.(x,z)??.1;   // the ground before its tile has loaded
  const g={player:createCarState({x:CITY.spawn.x,z:CITY.spawn.z,heading:CITY.spawn.heading}),vehicle:'interceptor',mode:'survival',health:130,
    enemies:[],pickups:[],wave:1,waveDelay:0,scrap:0,kills:0,time:0,heat:0,overheated:false,ended:false};
  const contactProbe={x:0,z:0};   // where the car was at the last wheel probe
  let playerMesh=null,gunTimer=0,groundTimer=0,dustTimer=0,ramCooldown=0,waterTimer=0,critical=false,tapFire=0;
  let lastBoost=false,progressTime=0,progressDistance=0,blockedInWindow=false,contactTimer=0,playerContacts=[.1,.1,.1,.1],sessionSerial=0;
  const navEdges=new Map();let navRevision=-1;
  const arenaEffects=createArenaEffects({scene,effects,city,audio});
  const projectileStart=new THREE.Vector3(),projectileEnd=new THREE.Vector3(),direction=new THREE.Vector3();
  const repairMat=new THREE.MeshStandardMaterial({color:0x94b38a,roughness:.65,metalness:.35,emissive:0x344e26,emissiveIntensity:.4});
  const scrapMat=new THREE.MeshStandardMaterial({color:0xb48d49,roughness:.55,metalness:.65,emissive:0x6b4617,emissiveIntensity:.45});
  const crateGeo=new THREE.BoxGeometry(.85,.6,.85),ringGeo=new THREE.TorusGeometry(.8,.035,6,28);
  const arsenal=createWeapons({scene,city,effects,audio,hud,state:g,damageEnemy:hitEnemy,hurtPlayer:hurt,getMuzzle:weaponMuzzle});
  function weaponMuzzle(weapon='guns'){
    const s=g.player,orientation=new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch||0,s.heading,s.roll||0,'YXZ'));
    const position=playerMesh.userData.flash.position.clone();position.z-=.18;
    position.applyQuaternion(orientation).add(new THREE.Vector3(s.x,s.y+(s.heave||0),s.z));
    const direction=new THREE.Vector3(0,weapon==='flame'?-.015:0,-1).applyQuaternion(orientation).normalize();
    return {position,direction};
  }
  function pickup(x,z,kind='scrap'){
    const root=new THREE.Group(),box=new THREE.Mesh(crateGeo,kind==='repair'?repairMat:scrapMat);box.castShadow=true;root.add(box);
    const ring=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:kind==='repair'?0xa4cb94:0xe4b26e,transparent:true,opacity:.65}));ring.rotation.x=-Math.PI/2;ring.position.y=-.25;root.add(ring);
    if(kind==='repair'){
      const mat=new THREE.MeshBasicMaterial({color:0xe5ecd2});
      const a=new THREE.Mesh(new THREE.BoxGeometry(.15,.02,.5),mat),b=new THREE.Mesh(new THREE.BoxGeometry(.5,.02,.15),mat);a.position.y=b.position.y=.311;root.add(a,b);
    }
    const y=city.groundAt(x,z)??terrainY(x,z);root.position.set(x,y+.6,z);scene.add(root);
    const p={x,z,y,kind,root,active:true,respawn:0};g.pickups.push(p);return p;
  }
  function scatterSupplies(){
    const b=CITY.bounds,inside=n=>n.x>b.minX+25&&n.x<b.maxX-25&&n.z>b.minZ+25&&n.z<b.maxZ-25;
    const near=network.nodes.filter(n=>n.links.length&&inside(n)&&Math.hypot(n.x-CITY.spawn.x,n.z-CITY.spawn.z)>28&&!network.hitsBuilding(n.x,n.z,1.5));
    const chosen=[];
    for(let i=0;i<22&&near.length;i++){
      const n=near[Math.floor((i/22)*near.length)];
      if(chosen.some(p=>Math.hypot(n.x-p.x,n.z-p.z)<28))continue;
      chosen.push(n);pickup(n.x,n.z,i%3===0?'repair':'scrap');
    }
    // Reliable nearby supplies, positioned on real street nodes.
    for(const target of CITY.crates.map(([x,z])=>({x,z}))){
      const node=network.nodes[network.nearestNode(target.x,target.z)];if(node)pickup(node.x,node.z,'repair');}
  }
  function disposePickup(p){
    scene.remove(p.root);p.root.traverse(o=>{if(!o.isMesh)return;if(![crateGeo,ringGeo].includes(o.geometry))o.geometry.dispose();if(![scrapMat,repairMat].includes(o.material))o.material.dispose();});
  }
  function clean(){
    navEdges.clear();
    arenaEffects.clear();
    if(playerMesh)scene.remove(playerMesh);
    for(const e of g.enemies)scene.remove(e.mesh);
    for(const p of g.pickups)disposePickup(p);
    g.enemies=[];g.pickups=[];effects.clear();
    city.clearDamage?.();
    city.resetProps?.();
    arsenal.clear();
  }
  function reset(vehicle,mode){
    sessionSerial++;
    clean();g.vehicle=vehicle;g.mode=mode;g.player=createCarState({x:CITY.spawn.x,z:CITY.spawn.z,heading:CITY.spawn.heading});
    g.player.y=city.groundAt(g.player.x,g.player.z)??terrainY(g.player.x,g.player.z);
    Object.assign(g,{health:VEHICLES[vehicle].health,panelDamage:0,wave:1,waveDelay:0,scrap:0,kills:0,time:0,heat:0,overheated:false,ended:false,cameraShake:0,stuckTime:0,recovering:false,recoveryShield:0,recoveryCooldown:0,recoveries:0,enemyRecoveries:0,arena:null,arenaLife:1,arenaRespawn:0,deaths:0,lastAttacker:null});
    gunTimer=groundTimer=dustTimer=ramCooldown=waterTimer=tapFire=0;critical=lastBoost=false;
    progressTime=progressDistance=0;blockedInWindow=false;
    contactTimer=0;playerContacts=wheelContacts(VEHICLES[vehicle]).map(()=>g.player.y);
    playerMesh=vehicles.create(vehicle,true);scene.add(playerMesh);vehicles.update(playerMesh,g.player,0);hud.reset();
    scatterSupplies();
    // Existing curb fires establish the ruined city before the first fight.
    for(const target of CITY.fires.map(([x,z])=>({x,z}))){
      const n=network.nearest(target.x,target.z,true);if(!n)continue;
      const {a,b}=n.segment,dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
      const x=n.x-dz/len*n.road.w*.43,z=n.z+dx/len*n.road.w*.43;
      if(!network.hitsBuilding(x,z,.5))effects.burn?.({x,y:city.groundAt(x,z)??terrainY(x,z),z},3600,1.4);
    }
    if(mode==='survival')spawnWave();
    audio.startEngine();audio.say('intro');
    hud.toast(mode==='survival'?'WAVE 01 — CLEAR THE STREETS':mode==='arena'?'ONLINE ARENA — HUNT THE OTHER DRIVERS':'FREE ROAM — THE WHOLE CITY IS OPEN',5);
    return g;
  }
  function spawnWave(){
    const count=2+g.wave*2;
    const candidates=network.nodes.filter(n=>n.links.length && Math.hypot(n.x-g.player.x,n.z-g.player.z)>55 && Math.hypot(n.x-g.player.x,n.z-g.player.z)<100&&(!city.geometryReady||city.geometryReady(n)));
    const used=[];
    for(let i=0;i<count;i++){
      const id=g.wave===3&&i%3===0?'wartruck':'raider';
      let n=null,heading=0;
      for(let attempt=0;attempt<200;attempt++){
        const candidate=candidates[Math.floor(Math.random()*candidates.length)];if(!candidate)break;
        const neighbor=network.nodes[candidate.links[0].id];
        const h=Math.atan2(-(neighbor.x-candidate.x),-(neighbor.z-candidate.z));
        const pose={...candidate,heading:h,y:city.groundAt(candidate.x,candidate.z)??terrainY(candidate.x,candidate.z)};
        if(!network.carCollision(pose,VEHICLES[id])&&(!city.poseClear||city.poseClear(pose,VEHICLES[id]))&&!used.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<9)){n=candidate;heading=h;break;}
      }
      if(!n)continue;used.push(n);
      const state=createCarState({x:n.x,z:n.z,heading,y:city.groundAt(n.x,n.z)??terrainY(n.x,n.z)});
      const mesh=vehicles.create(id);scene.add(mesh);vehicles.update(mesh,state,0);
      g.enemies.push({id,state,mesh,health:id==='wartruck'?140:65,path:[],pathIndex:0,routeTimer:0,groundTimer:0,fireTimer:2+Math.random()*2,stuck:0,reverse:0,wreckTime:0});
    }
  }
  function hurt(amount,attacker=null){
    if(g.ended||g.health<=0||g.recoveryShield>0||amount<=0)return;
    if(attacker)g.lastAttacker=attacker;
    g.health=Math.max(0,g.health-amount);
    g.cameraShake=Math.min(.6,Math.max(g.cameraShake,amount*.025));
    vehicles.damage?.(playerMesh,Math.max(g.panelDamage||0,1-g.health/VEHICLES[g.vehicle].health));
    const flash=document.getElementById('damage-flash');flash.style.opacity=String(Math.min(.65,amount/25));setTimeout(()=>flash.style.opacity='0',150);
    if(g.health<=VEHICLES[g.vehicle].health*.25&&!critical){critical=true;audio.say('critical');hud.toast('ARMOR CRITICAL — FIND A REPAIR CRATE',4);}
    if(g.health<=0){
      if(g.arena){g.deaths++;g.arenaRespawn=5;g.player.speed=g.player.vx=g.player.vz=0;
        g.arena.event('death',{killer:attacker||g.lastAttacker,life:g.arenaLife});
        effects.blast(new THREE.Vector3(g.player.x,g.player.y+1,g.player.z),1.4);effects.emit({x:g.player.x,y:g.player.y+1,z:g.player.z},70,'explosion');audio.effect('explosion',.9);hud.toast('WRECKED — RESPAWN IN 5s',5);
      }else finish(false);
    }
  }
  function finish(win){
    if(g.ended)return;g.ended=true;g.player.speed=0;
    if(!win){effects.emit({x:g.player.x,y:g.player.y+1,z:g.player.z},70,'explosion');effects.blast?.(new THREE.Vector3(g.player.x,g.player.y+1,g.player.z),1.4);effects.burn?.({x:g.player.x,y:g.player.y+.4,z:g.player.z},90,2.5);audio.effect('explosion',.9);}
    audio.pause(true);audio.say(win?'win':'wrecked');onEnd(win,g);
  }
  function destroyEnemy(enemy){
    enemy.health=0;enemy.state.speed=0;g.kills++;g.scrap+=25;
    effects.emit({x:enemy.state.x,y:enemy.state.y+1,z:enemy.state.z},65,'explosion');audio.effect('explosion',.6);
    effects.blast?.(new THREE.Vector3(enemy.state.x,enemy.state.y+1,enemy.state.z),1.2);
    effects.burn?.({x:enemy.state.x,y:enemy.state.y+.35,z:enemy.state.z},90,2.4);vehicles.damage?.(enemy.mesh,1);
    hud.feed(`RAIDER DESTROYED +25 SCRAP`);
    pickup(enemy.state.x,enemy.state.z,Math.random()<.4?'repair':'scrap');
  }
  function hitEnemy(e,amount,meta={}){if(e.health<=0)return;
    if(g.arena&&e.peerId){g.arena.hit(e.peerId,amount,{weapon:meta.weapon||'ram',origin:meta.origin||[g.player.x,g.player.y+1,g.player.z],life:e.life});return;}
    e.health-=amount;vehicles.damage?.(e.mesh,1-e.health/(e.id==='wartruck'?140:65));if(e.health<=0)destroyEnemy(e);
  }
  function shoot(){
    g.cameraShake=Math.max(g.cameraShake,.07);
    const s=g.player,f=new THREE.Vector3(-Math.sin(s.heading),0,-Math.cos(s.heading));
    projectileStart.copy(weaponMuzzle().position);
    let target=null,near=130;
    for(const e of g.enemies){
      if(e.health<=0)continue;const dx=e.state.x-s.x,dz=e.state.z-s.z,d=Math.hypot(dx,dz);
      if(d<near&&d>1&&(dx*f.x+dz*f.z)/d>.965){target=e;near=d;}
    }
    projectileEnd.copy(projectileStart).addScaledVector(f,130);
    if(target)projectileEnd.set(target.state.x,target.state.y+1.05,target.state.z);
    direction.subVectors(projectileEnd,projectileStart);const distance=direction.length();direction.normalize();
    const wall=city.solidRay(projectileStart,direction,distance);
    if(wall)projectileEnd.copy(wall.point);
    if(target&&(!wall||wall.distance>distance-2.8)){
      hitEnemy(target,9*VEHICLES[g.vehicle].damage,{weapon:'guns',origin:projectileStart.toArray()});effects.emit(projectileEnd,5);hud.feedTimer=0;
    }else if(wall){effects.emit(wall.point,3);city.damage?.(wall,9*VEHICLES[g.vehicle].damage);}
    const side=new THREE.Vector3(Math.cos(s.heading),0,-Math.sin(s.heading));
    for(const sign of [-1,1]){
      const start=projectileStart.clone().addScaledVector(side,sign*.14);
      effects.tracer(start,projectileEnd);effects.muzzleFlash?.(start,f,g.vehicle==='wartruck'?1.2:.9);
    }
    audio.effect('gun',.28,.9+Math.random()*.12);
    g.arena?.event('gun',{origin:projectileStart.toArray(),end:projectileEnd.toArray()});
  }
  function drive(state,input,dt,spec,isPlayer=false){
    const old={x:state.x,y:state.y,z:state.z,heading:state.heading},impact=Math.abs(state.speed);
    stepCar(state,input,dt,spec);
    if(city.geometryReady&&!city.geometryReady(state,spec.length*.5)){
      state.x=old.x;state.z=old.z;state.heading=old.heading;state.travel=old.heading;state.speed=state.vx=state.vz=0;return true;
    }
    let geometryHit=city.carHit?.(old,state,spec);
    if(geometryHit?.object?.userData.streetProp){
      const knocked=city.ramProp?.(geometryHit,state,spec);
      if(knocked){
        state.speed*=knocked.retained;state.vx*=knocked.retained;state.vz*=knocked.retained;
        state.suspensionKick=Math.min(1.3,.3+impact*.025);
        effects.emit(geometryHit.point,12,'rubble');effects.emit(geometryHit.point,6,'dust');playCollision({material:collisionMaterial(geometryHit),speed:impact,mass:spec.mass});
        if(isPlayer){hurt(knocked.damage);hud.feed('STREET OBSTACLE SMASHED');}
        geometryHit=city.carHit?.(old,state,spec);
      }
    }
    const collision=geometryHit||network.carCollision(state,spec);
    if(collision){
      const normal=geometryHit?.normal||{x:collision.nx,z:collision.nz},response=wallImpact(spec,state,normal);
      const normalSpeed=response.speed,energy=response.energy;
      if(isPlayer){const tangent=Math.sqrt(Math.max(0,state.vx*state.vx+state.vz*state.vz-normalSpeed*normalSpeed));if(tangent>3)audio.scrape?.(Math.min(1,tangent/22));}
      if(normalSpeed>3)state.suspensionKick=Math.min(.8,normalSpeed*.035);
      const dx=state.x-old.x,dz=state.z-old.z,into=dx*normal.x+dz*normal.z;
      const slide={...state,x:old.x+dx-Math.min(0,into)*normal.x,z:old.z+dz-Math.min(0,into)*normal.z};
      const clear=pose=>!network.carCollision(pose,spec)&&!city.carHit?.(old,pose,spec);
      if(clear(slide)){
        state.x=slide.x;state.z=slide.z;
      }else if(clear({...slide,heading:old.heading})){
        state.x=slide.x;state.z=slide.z;state.heading=old.heading;
      }else{
        state.x=old.x;state.z=old.z;state.heading=old.heading;
      }
      applyImpactVelocity(state,response.delta);
      if(isPlayer&&normalSpeed>1&&ramCooldown<=0){
        ramCooldown=.65;
        g.panelDamage=Math.min(.65,(g.panelDamage||0)+response.panelDamage);
        vehicles.damage?.(playerMesh,Math.max(g.panelDamage,1-g.health/spec.health));
        if(response.armorDamage>0)hurt(response.armorDamage);
        g.cameraShake=Math.max(g.cameraShake,Math.min(.2,normalSpeed*.009));
        playCollision({material:collisionMaterial(geometryHit),speed:normalSpeed,mass:spec.mass});
        effects.emit(geometryHit?.point||{x:old.x,y:state.y+.6,z:old.z},Math.min(15,3+Math.round(normalSpeed*.4)));
        let hit=geometryHit;
        if(!hit){
          const direction=new THREE.Vector3(-Math.sin(old.heading),0,-Math.cos(old.heading)).multiplyScalar(state.speed<0?1:-1);
          hit=city.solidRay(new THREE.Vector3(old.x,state.y+.75,old.z),direction,spec.length*.7);
        }
        if(hit&&normalSpeed>6)city.damage?.(hit,Math.min(450,energy/4000));
      }
      return true;
    }
    return false;
  }
  function playCollision(options){if(audio.impact)audio.impact(options);else audio.effect('impact',.35);}
  function tryMove(state,x,z,spec){
    const pose={...state,x,z};
    if(!network.onLand(x,z)||network.carCollision(pose,spec)||city.carHit?.(state,pose,spec)||(city.poseClear&&!city.poseClear(pose,spec))||(city.geometryReady&&!city.geometryReady(pose,spec.length*.5)))return false;
    state.x=x;state.z=z;return true;
  }
  function recoverEnemy(e){
    const occupied=[{state:g.player,spec:VEHICLES[g.vehicle],health:g.health},...g.enemies.filter(other=>other!==e).map(other=>({...other,spec:VEHICLES[other.id]}))];
    const pose=findRecoveryPose({player:e.state,spec:VEHICLES[e.id],network,city,enemies:occupied,fires:effects.fires||[],minDistance:7,maxDistance:45});
    if(!pose)return false;
    effects.emit({x:e.state.x,y:e.state.y+.6,z:e.state.z},5,'dust');
    Object.assign(e.state,createCarState(pose));
    Object.assign(e,{stuck:0,reverse:0,escapeAttempts:0,escapeCooldown:0,routeTimer:0,navTimer:0,progressTime:0,progressAnchor:{x:pose.x,z:pose.z},advanceAnchor:{x:pose.x,z:pose.z},noProgress:0,progressBlocked:false,invalidTime:0});
    e.recoveries=(e.recoveries||0)+1;g.enemyRecoveries++;return true;
  }
  function enemyPath(e){
    if(navRevision!==city.revision){navEdges.clear();navRevision=city.revision;}
    const spec=VEHICLES[e.id];
    const route=network.path(e.state,g.player,spec,(a,b)=>{
      // Plan through distant tiles, but validate every loaded road edge against
      // the Blender city as well as the footprint map. Movement still waits for tiles.
      if(city.geometryReady&&(!city.geometryReady(a,spec.length*.5)||!city.geometryReady(b,spec.length*.5)))return true;
      const key=`${e.id}:${a.x},${a.z}:${b.x},${b.z}`;
      if(!navEdges.has(key))navEdges.set(key,drivingCorridorClear({...a,y:city.groundAt(a.x,a.z,e.state.y)??e.state.y},b,spec,network,city));
      return navEdges.get(key);
    });
    e.pathIndex=route.length>1&&drivingCorridorClear(e.state,route[1],spec,network,city)?1:0;
    return route;
  }
  async function recover(manual=true){
    if(g.recovering||g.ended||g.recoveryCooldown>0)return false;
    g.recovering=true;
    const serial=sessionSerial;
    try{
      await city.ensure?.(g.player,70);
      if(serial!==sessionSerial)return false;
      const options={player:g.player,spec:VEHICLES[g.vehicle],network,city,enemies:g.enemies.map(e=>({...e,spec:VEHICLES[e.id]})),fires:effects.fires||[]};
      let pose=findRecoveryPose(options);
      if(!pose){
        await city.ensure?.({x:CITY.spawn.x,z:CITY.spawn.z},75);
        if(serial!==sessionSerial)return false;
        pose=findRecoveryPose({...options,player:{x:CITY.spawn.x,z:CITY.spawn.z,heading:CITY.spawn.heading}});
      }
      if(!pose){hud.toast('NO CLEAR STREET YET — TRY RESPAWN AGAIN',3);return false;}
      const nitro=g.player.nitro;
      Object.assign(g.player,createCarState(pose),{nitro});
      waterTimer=progressTime=progressDistance=0;blockedInWindow=lastBoost=false;
      contactTimer=0;playerContacts=wheelContacts(VEHICLES[g.vehicle]).map(()=>g.player.y);
      g.stuckTime=0;g.recoveryShield=3;g.recoveryCooldown=1.5;g.recoveries++;g.cameraShake=0;
      vehicles.update(playerMesh,g.player,0);
      hud.toast(manual?'RESPAWN — BACK ON A CLEAR STREET':'UNSTUCK — BACK ON A CLEAR STREET',3);
      return true;
    }finally{if(serial===sessionSerial)g.recovering=false;}
  }
  function syncArena(dt){
    if(!g.arena)return;
    const present=new Set();
    for(const peer of g.arena.samplePeers()){
      present.add(peer.id);const data=peer.state;
      let e=g.enemies.find(e=>e.peerId===peer.id);
      if(!e||e.id!==data.vehicle||e.life!==data.life){
        if(e){scene.remove(e.mesh);g.enemies.splice(g.enemies.indexOf(e),1);}
        e={peerId:peer.id,id:data.vehicle,name:peer.name,state:createCarState(data.pose),mesh:vehicles.create(data.vehicle),health:data.health,life:data.life,wreckTime:0};scene.add(e.mesh);g.enemies.push(e);
      }
      Object.assign(e.state,data.pose);e.health=peer.stale?0:data.health;e.kills=data.kills;e.deaths=data.deaths;
      vehicles.damage?.(e.mesh,1-data.health/VEHICLES[e.id].health);vehicles.update(e.mesh,e.state,dt);arenaEffects.sync(peer,e);
    }
    for(let i=g.enemies.length-1;i>=0;i--){const e=g.enemies[i];if(e.peerId&&!present.has(e.peerId)){scene.remove(e.mesh);arenaEffects.remove(e.peerId);g.enemies.splice(i,1);}}
  }
  function arenaEvent(message){
    if(!g.arena)return;
    if(message.type==='hit'){
      if(message.life!==g.arenaLife||g.health<=0||!Number.isFinite(message.amount)||message.amount<=0||message.amount>200)return;
      const e=g.enemies.find(e=>e.peerId===message.from);if(!e)return;
      const origin=message.origin;
      if(!Array.isArray(origin)||origin.length!==3||!origin.every(Number.isFinite))return;
      const range={guns:135,flame:38,blast:15,ram:15,fuel:10,afterburn:8}[message.weapon];if(!range)return;
      const distance=Math.hypot(g.player.x-origin[0],g.player.y+.8-origin[1],g.player.z-origin[2]);if(distance>range)return;
      if(['guns','flame','blast'].includes(message.weapon)&&distance>.1){const start=new THREE.Vector3(...origin),target=new THREE.Vector3(g.player.x,g.player.y+.8,g.player.z).sub(start),wall=city.solidRay(start,target.normalize(),distance);if(wall&&wall.distance<distance-3)return;}
      hurt(message.amount,message.from);
    }else if(message.type==='death'){
      const e=g.enemies.find(e=>e.peerId===message.from);if(e){e.health=0;effects.blast(new THREE.Vector3(e.state.x,e.state.y+1,e.state.z),1.3);effects.emit({x:e.state.x,y:e.state.y+1,z:e.state.z},50,'explosion');}
      if(message.killer===g.arena.id){g.kills++;g.scrap+=25;hud.feed(`${e?.name||'DRIVER'} WRECKED +1 FRAG`);}
      else hud.feed(`${e?.name||'DRIVER'} WRECKED`);
    }else arenaEffects.event(message);
  }
  function setArena(client){g.arena=client;syncArena(0);}
  async function arenaRespawn(){
    if(g.recovering)return;
    if(await recover(false)){
      g.health=VEHICLES[g.vehicle].health;g.panelDamage=g.heat=0;g.overheated=false;critical=false;g.arenaLife++;g.arenaRespawn=0;g.lastAttacker=null;
      scene.remove(playerMesh);playerMesh=vehicles.create(g.vehicle,true);scene.add(playerMesh);arsenal.clear();g.player.nitro=100;vehicles.update(playerMesh,g.player,0);
      g.arena?.event('respawn',{life:g.arenaLife});
    }
  }
  function remoteContact(e){
    const contact=carContact(g.player,VEHICLES[g.vehicle],e.state,VEHICLES[e.id]);if(!contact)return;
    const massA=VEHICLES[g.vehicle].mass,massB=VEHICLES[e.id].mass,push=Math.min(contact.depth+.025,.55)*massB/(massA+massB);
    tryMove(g.player,g.player.x-contact.nx*push,g.player.z-contact.nz*push,VEHICLES[g.vehicle]);
    if(ramCooldown<=0){const response=vehicleImpact(g.player,VEHICLES[g.vehicle],e.state,VEHICLES[e.id],contact);
      if(response.closing>.8){ramCooldown=.45;applyImpactVelocity(g.player,response.deltaA);hurt(response.damageA,e.peerId);playCollision({material:'metal',speed:response.closing,mass:massA*massB/(massA+massB)});}
    }
  }
  function update(dt,input){
    if(g.recovering)return;
    if(g.ended){effects.update(dt,g.player);return;}
    g.time+=dt;gunTimer-=dt;ramCooldown-=dt;
    g.recoveryShield=Math.max(0,g.recoveryShield-dt);g.recoveryCooldown=Math.max(0,g.recoveryCooldown-dt);
    syncArena(dt);
    if(g.arena&&g.health<=0){
      g.arenaRespawn=Math.max(0,g.arenaRespawn-dt);g.flaming=false;
      if(g.arenaRespawn<=0)arenaRespawn();
      effects.update(dt,g.player);audio.update(g.player,effects.fires);g.arena.publish(g,arsenal,dt);return;
    }
    const onroad=network.nearest(g.player.x,g.player.z);
    input={...input,fire:input.fire||tapFire>0,offroad:onroad?onroad.d>onroad.road.w/2+2:false};tapFire=Math.max(0,tapFire-dt);
    const before={x:g.player.x,z:g.player.z,speed:g.player.speed,heading:g.player.heading};
    const blocked=drive(g.player,input,dt,VEHICLES[g.vehicle],true);
    // Between wheel probes the ground reference rides the slope the wheels last measured (rise per metre ahead).
    setGroundReference(g.player,g.player.y+(g.player.grade||0)*Math.sign(g.player.speed)*Math.hypot(g.player.x-before.x,g.player.z-before.z));
    if((input.throttle||input.brake)&&!input.handbrake){
      progressTime+=dt;progressDistance+=Math.hypot(g.player.x-before.x,g.player.z-before.z);blockedInWindow||=blocked;
      if(progressTime>=.5){g.stuckTime=progressDistance<.35&&(blockedInWindow||Math.abs(g.player.speed)<1)?g.stuckTime+progressTime:0;progressTime=progressDistance=0;blockedInWindow=false;}
    }else{g.stuckTime=progressTime=progressDistance=0;blockedInWindow=false;}
    if(g.ended)return;
    g.flaming=false;
    if(g.player.boosting&&!lastBoost)audio.effect('nitro',.45);lastBoost=g.player.boosting;
    if(input.fire&&g.weapon!=='guns')arsenal.fire(dt);
    if(input.fire&&g.weapon==='guns'&&!g.overheated&&gunTimer<=0){shoot();gunTimer=.1;g.heat=Math.min(1,g.heat+.035);if(g.heat>=1){g.overheated=true;hud.toast('GUN OVERHEATED — COOLING',2);}}
    if(!input.fire||g.overheated)g.heat=Math.max(0,g.heat-dt*.27);
    if(g.overheated&&g.heat<.2)g.overheated=false;
    if((groundTimer-=dt)<=0){groundTimer=.07;
      if(!network.onLand(g.player.x,g.player.z))waterTimer+=.07;else waterTimer=0;
      if(waterTimer>1.5){g.stuckTime=6;}
    }
    if((dustTimer-=dt)<=0){dustTimer=.055;
      if(Math.abs(g.player.speed)>8)effects.emit({x:g.player.x+Math.sin(g.player.heading)*1.5,y:g.player.y+.15,z:g.player.z+Math.cos(g.player.heading)*1.5},g.player.drift?4:1,'dust');
      if(g.player.drift)effects.tireMarks(g.player);
      if(g.health<VEHICLES[g.vehicle].health*.45)effects.emit({x:g.player.x-Math.sin(g.player.heading)*1.7,y:g.player.y+1,z:g.player.z-Math.cos(g.player.heading)*1.7},1,'smoke');
    }
    if((contactTimer-=dt)<=0){
      contactTimer=1/35;
      let missed=false;const raw=[];
      const wheels=wheelContacts(VEHICLES[g.vehicle]);
      playerContacts=wheels.map(([x,z])=>{
        const px=g.player.x+Math.cos(g.player.heading)*x+Math.sin(g.player.heading)*z,pz=g.player.z-Math.sin(g.player.heading)*x+Math.cos(g.player.heading)*z;
        const ground=city.groundAt(px,pz,g.player.y);if(ground===null)missed=true;raw.push(ground??0);
        return (ground??g.player.y)+roadProfile(px,pz,input.offroad);
      });
      // The wheels probe the ground far more often than the centre ray; the chassis reference follows them, so a fast climb cannot outrun it.
      if(!missed)followGround(g.player,chassisGround(wheels,raw),Math.min(3,Math.hypot(g.player.x-contactProbe.x,g.player.z-contactProbe.z)));
      contactProbe.x=g.player.x;contactProbe.z=g.player.z;
    }
    stepSuspension(g.player,dt,VEHICLES[g.vehicle],playerContacts,before.speed,before.heading);
    for(const p of g.pickups){
      if(!p.active){if(g.mode==='roam'&&(p.respawn-=dt)<=0){p.active=true;p.root.visible=true;}continue;}
      p.root.rotation.y+=dt*.6;p.root.position.y=p.y+.6+Math.sin(g.time*2+p.x)*.06;
      if(Math.hypot(p.x-g.player.x,p.z-g.player.z)<2.8){
        p.active=false;p.root.visible=false;p.respawn=35;
        if(p.kind==='repair'){g.health=Math.min(VEHICLES[g.vehicle].health,g.health+45);g.panelDamage*=.45;vehicles.damage?.(playerMesh,Math.max(g.panelDamage,1-g.health/VEHICLES[g.vehicle].health));critical=false;hud.toast('REPAIR CRATE — +45 ARMOR');audio.say('repair');}
        else{g.scrap+=15;g.player.nitro=100;arsenal.refill();hud.toast('SALVAGED — AMMO / FUEL / NITRO REFILLED');}
        audio.effect('pickup',.5);effects.emit({x:p.x,y:p.y+.7,z:p.z},15,'pickup');
      }
    }
    for(const e of g.enemies){
      if(e.peerId){if(e.health>0)remoteContact(e);continue;}
      if(e.health<=0){e.wreckTime+=dt;e.mesh.rotation.z=Math.min(.17,e.wreckTime*.05);if(e.wreckTime>90)e.mesh.visible=false;continue;}
      const s=e.state,d=Math.hypot(s.x-g.player.x,s.z-g.player.z);
      const oldSpeed=s.speed,oldHeading=s.heading;
      const spec=VEHICLES[e.id];
      if((e.routeTimer-=dt)<=0){e.routeTimer=2+Math.random()*.5;e.path=enemyPath(e);e.navTimer=0;}
      if((e.navTimer=(e.navTimer||0)-dt)<=0){
        e.navTimer=.2;
        while(e.pathIndex<e.path.length-1&&Math.hypot(s.x-e.path[e.pathIndex].x,s.z-e.path[e.pathIndex].z)<2.8&&drivingCorridorClear(s,e.path[e.pathIndex+1],spec,network,city))e.pathIndex++;
        e.target=d<35&&drivingCorridorClear(s,g.player,spec,network,city)?{x:g.player.x,z:g.player.z}:e.path[e.pathIndex];
        const invalid=!network.onLand(s.x,s.z)||network.carCollision(s,spec)||(city.poseClear&&!city.poseClear(s,spec));
        e.invalidTime=invalid?(e.invalidTime||0)+.2:0;
      }
      const target=e.target||{x:s.x-Math.sin(s.heading)*8,z:s.z-Math.cos(s.heading)*8};
      const blocked=drive(s,enemyDrivingInput(s,target,{reverse:e.reverse>0,speedCap:20+g.wave*2}),dt,spec);
      trackEnemyProgress(e,dt,blocked);
      e.reverse=Math.max(0,e.reverse-dt);e.escapeCooldown=Math.max(0,(e.escapeCooldown||0)-dt);
      if(e.invalidTime>=.4||e.stuck>=5||e.noProgress>=7){recoverEnemy(e);}
      else if(e.stuck>=1.5&&e.reverse<=0&&e.escapeCooldown<=0){e.reverse=1.4;e.escapeCooldown=2.4;e.escapeAttempts=(e.escapeAttempts||0)+1;e.routeTimer=0;}
      if((e.groundTimer-=dt)<=0){e.groundTimer=.12;const ground=city.groundAt(s.x,s.z,s.y);if(ground!==null)setGroundReference(s,s.y+(ground-s.y)*.7);}
      const contact=carContact(g.player,VEHICLES[g.vehicle],s,VEHICLES[e.id]);
      if(contact){
        const push=Math.min(contact.depth+.025,.55),massA=VEHICLES[g.vehicle].mass,massB=VEHICLES[e.id].mass;
        const moveA=massB/(massA+massB),moveB=1-moveA;
        const px=g.player.x-contact.nx*push*moveA,pz=g.player.z-contact.nz*push*moveA;
        tryMove(g.player,px,pz,VEHICLES[g.vehicle]);
        const ex=s.x+contact.nx*push*moveB,ez=s.z+contact.nz*push*moveB;
        tryMove(s,ex,ez,VEHICLES[e.id]);
        if(ramCooldown<=0){
          const response=vehicleImpact(g.player,VEHICLES[g.vehicle],s,VEHICLES[e.id],contact);
          if(response.closing>.8){
            ramCooldown=.45;applyImpactVelocity(g.player,response.deltaA);applyImpactVelocity(s,response.deltaB);
            hitEnemy(e,response.damageB*VEHICLES[g.vehicle].damage);hurt(response.damageA);
            playCollision({material:'metal',speed:response.closing,mass:massA*massB/(massA+massB)});effects.emit({x:contact.x,y:s.y+.8,z:contact.z},Math.min(35,8+Math.round(response.closing)));
          }
        }
      }
      e.fireTimer-=dt;
      const aim=(-Math.sin(s.heading)*(g.player.x-s.x)-Math.cos(s.heading)*(g.player.z-s.z))/(d||1);
      if(e.fireTimer<=0&&d<65&&aim>.8){
        e.fireTimer=1.4+Math.random()*1.3;
        const muzzle=e.mesh.userData.flash.position;
        projectileStart.set(s.x-Math.sin(s.heading)*-muzzle.z,s.y+(s.heave||0)+muzzle.y,s.z-Math.cos(s.heading)*-muzzle.z);projectileEnd.set(g.player.x,g.player.y+.9,g.player.z);
        direction.subVectors(projectileEnd,projectileStart);const len=direction.length();direction.normalize();
        const wall=city.solidRay(projectileStart,direction,len);
        if(!wall||wall.distance>len-2){
          effects.tracer(projectileStart,projectileEnd);hurt(e.id==='wartruck'?7:4);effects.emit(projectileEnd,4);
          effects.muzzleFlash?.(projectileStart,direction,.7);audio.effect('gun',.1);
        }else{effects.tracer(projectileStart,wall.point);city.damage?.(wall,7);effects.emit(wall.point,3);}
      }
      const heights=wheelContacts(VEHICLES[e.id]).map(([x,z])=>s.y+roadProfile(s.x+Math.cos(s.heading)*x+Math.sin(s.heading)*z,s.z-Math.sin(s.heading)*x+Math.cos(s.heading)*z));
      stepSuspension(s,dt,VEHICLES[e.id],heights,oldSpeed,oldHeading);vehicles.update(e.mesh,s,dt);
    }
    arsenal.update(dt);
    // Vehicle separation stops overlapping enemies and keeps intersections navigable.
    const alive=g.enemies.filter(e=>e.health>0);
    for(let i=0;i<alive.length&&!g.arena;i++)for(let j=i+1;j<alive.length;j++){
      const a=alive[i].state,b=alive[j].state,hit=carContact(a,VEHICLES[alive[i].id],b,VEHICLES[alive[j].id]);
      if(hit){const push=Math.min(hit.depth*.5,.35);tryMove(a,a.x-hit.nx*push,a.z-hit.nz*push,VEHICLES[alive[i].id]);tryMove(b,b.x+hit.nx*push,b.z+hit.nz*push,VEHICLES[alive[j].id]);}
    }
    if(g.mode==='survival'&&!alive.length){
      if(g.wave===3){finish(true);return;}
      if(g.waveDelay<=0){g.waveDelay=7;hud.toast('WAVE CLEARED — SCAVENGE AND REPAIR',4);g.health=Math.min(VEHICLES[g.vehicle].health,g.health+15);}
      g.waveDelay-=dt;
      if(g.waveDelay<=0){g.wave++;spawnWave();audio.say('wave');hud.toast(`WAVE 0${g.wave} — RAIDERS INBOUND`,4);}
    }
    vehicles.update(playerMesh,g.player,dt);effects.update(dt,g.player);audio.update(g.player,effects.fires,{flame:g.flaming});
    g.arena?.publish(g,arsenal,dt);
  }
  return {state:g,reset,update,recover,setArena,arenaEvent,setWeapon:arsenal.select,fireBurst:()=>tapFire=g.weapon==='flame'?.75:.18,arsenal,get playerMesh(){return playerMesh;}};
}
