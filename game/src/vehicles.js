import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addSalvageDetails,addHeadlights } from './salvage.js';
import { weatherMaterial } from './wasteland.js';
import { prepareVehicleDesign,finishVehicleDesign } from './vehicle-design.js';
import { VEHICLES } from './physics.js';
import { createCockpit } from './cockpit.js';
import { CITY } from './city-config.js';

// Merge Blender's static armor by material. Preserve every wheel pivot for animation.
function optimize(root){
  root.updateMatrixWorld(true);
  const wheels=[];root.traverse(o=>{if(/^Wheel_[FRT][LR](?:\.?\d+)?$/.test(o.name))wheels.push(o);});
  const wheelMeshes=new Set();for(const w of wheels)w.traverse(o=>{if(o.isMesh)wheelMeshes.add(o);});
  const batches=new Map();
  root.traverse(o=>{
    if(!o.isMesh||wheelMeshes.has(o)||Array.isArray(o.material))return;
    const material=o.material;
    if(!batches.has(material))batches.set(material,[]);
    const g=o.geometry.clone().applyMatrix4(o.matrixWorld);
    // All Blender meshes export the same attributes; remove tangents if an exporter varied.
    g.deleteAttribute('tangent');
    if(!g.attributes.uv){
      const p=g.attributes.position,uv=new Float32Array(p.count*2);
      for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i)*.55;uv[i*2+1]=p.getZ(i)*.55;}
      g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    }
    if(!g.attributes.normal)g.computeVertexNormals();
    if(g.index)g.setIndex(Array.from(g.index.array));
    batches.get(material).push([o,g]);
  });
  for(const [mat,items]of batches){
    const geometries=items.map(([,g])=>g.index?g.toNonIndexed():g.clone());
    const geometry=mergeGeometries(geometries,false);
    if(!geometry){geometries.forEach(g=>g.dispose());continue;}
    const mesh=new THREE.Mesh(geometry,mat);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
    for(const [o,g] of items){o.removeFromParent();g.dispose();}
    geometries.forEach(g=>g.dispose());
  }
  // Each wheel exported 35 parts (tyre, rim, tread blocks, bolts) in only three materials, so a car
  // cost 140-210 draw calls per pass. The parts never move relative to each other: merge them per
  // material in the wheel's own space, under the same pivot that steers, compresses and spins.
  const inverse=new THREE.Matrix4(),local=new THREE.Matrix4();
  for(const wheel of wheels){
    const byMaterial=new Map();
    wheel.traverse(o=>{if(o!==wheel&&o.isMesh&&!Array.isArray(o.material)){if(!byMaterial.has(o.material))byMaterial.set(o.material,[]);byMaterial.get(o.material).push(o);}});
    inverse.copy(wheel.matrixWorld).invert();
    for(const [material,parts] of byMaterial){
      if(parts.length<2)continue;
      const geometries=parts.map(o=>{
        const g=o.geometry.clone().applyMatrix4(local.multiplyMatrices(inverse,o.matrixWorld));g.deleteAttribute('tangent');
        if(!g.attributes.normal)g.computeVertexNormals();
        return g.index?g.toNonIndexed():g;
      });
      // A part without UVs would make the merge fail; give it the same planar UVs as the armour.
      for(const g of geometries)if(!g.attributes.uv){const p=g.attributes.position,uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i)*.55;uv[i*2+1]=p.getZ(i)*.55;}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));}
      const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
      if(!geometry)continue;
      const mesh=new THREE.Mesh(geometry,material);mesh.name=`${wheel.name} ${material.name}`;wheel.add(mesh);
      for(const o of parts)o.removeFromParent();
    }
  }
  root.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});
  return root;
}
// A rotating blue beacon on the roof (spec.beacon = [x, y, z] in car space): a translucent dome, a
// reflector turning inside it and two soft additive beams that sweep the street.
const beaconBeam=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'varying vec2 vUv;void main(){float fade=pow(vUv.y,2.2);gl_FragColor=vec4(0.12,0.32,1.0,fade*0.13);}'});
function addBeacon(root,[x,y,z]){
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.11,.12,.04,20),new THREE.MeshStandardMaterial({name:'Beacon base',color:0x111111,roughness:.5,metalness:.4}));
  base.position.set(x,y+.02,z);root.add(base);
  const dome=new THREE.Mesh(new THREE.CylinderGeometry(.085,.1,.17,24,1,false),new THREE.MeshStandardMaterial({name:'Beacon dome lamp',color:0x1d4dff,emissive:0x2a5cff,emissiveIntensity:2,transparent:true,opacity:.85,roughness:.15}));
  dome.position.set(x,y+.125,z);root.add(dome);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.085,20,8,0,Math.PI*2,0,Math.PI/2),dome.material);cap.position.set(x,y+.21,z);root.add(cap);
  const spin=new THREE.Group();spin.position.set(x,y+.12,z);root.add(spin);
  const mirror=new THREE.Mesh(new THREE.BoxGeometry(.11,.08,.01),new THREE.MeshBasicMaterial({color:0xbfd4ff}));spin.add(mirror);
  for(const a of [0,Math.PI]){const beam=new THREE.Mesh(new THREE.ConeGeometry(.9,7,16,1,true),beaconBeam);beam.rotation.z=Math.PI/2;beam.position.x=3.5;const arm=new THREE.Group();arm.rotation.y=a;arm.add(beam);spin.add(arm);}
  root.userData.beacon={spin,dome};
}
export async function loadVehicles(loader,weathering=null){
  const templates={};
  // The three battle cars, then any bonus vehicle the installed city brings (city/vehicles/<id>.glb).
  const bonus=new Map((CITY.bonus_vehicles||[]).filter(v=>VEHICLES[v.id]).map(v=>[v.id,v.model]));
  for(const id of ['interceptor','raider','wartruck',...bonus.keys()]){
    let gltf;
    try{gltf=await loader.loadAsync(bonus.get(id)||`models/${id}.glb`);}
    catch(error){if(bonus.has(id)){console.warn('Bonus vehicle',id,'could not load',error);delete VEHICLES[id];continue;}throw error;}let salvage=false;gltf.scene.traverse(o=>{if(o.userData.salvage_v2)salvage=true;});
    if(!salvage)addSalvageDetails(gltf.scene,id);
    const upgrade=prepareVehicleDesign(gltf.scene,id);templates[id]=optimize(gltf.scene);
    if(upgrade)templates[id]=optimize(finishVehicleDesign(templates[id],id));
    templates[id].traverse(o=>{if(o.isMesh)for(const mat of [o.material].flat())weatherMaterial(mat,weathering,true);});
    cityInsignia(templates[id]);
    // LED rings round a bonus car's speakers ("… speaker LED …" materials) pulse with the music.
    const pulse=new Set();templates[id].traverse(o=>{if(o.isMesh&&/speaker LED/i.test(o.material?.name||''))pulse.add(o.material);});
    templates[id].userData.pulse=[...pulse].map(material=>({material,base:material.emissiveIntensity||1}));
  }
  const flameMat=new THREE.MeshBasicMaterial({color:0x8ae7ff,transparent:true,opacity:.8,depthWrite:false});
  const flashMat=new THREE.MeshBasicMaterial({color:0xffcd75});
  function create(id,player=false){
    const root=templates[id].clone(true);
    const wheels=(id==='wartruck'?['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR','Wheel_TL','Wheel_TR']:['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']).map(n=>{
      let found=null;root.traverse(o=>{if(new RegExp('^'+n+'(?:\\.?\\d+)?$').test(o.name))found=o;});return found;
    });
    const spins=wheels.map(w=>{
      if(!w)return null;const spin=new THREE.Group();
      for(const child of [...w.children])spin.add(child);w.add(spin);return spin;
    });
    const spec=VEHICLES[id],flames=[];
    for(const [x,y,z] of spec.exhaust||[[-.74,.75,id==='raider'?2.1:2.5],[.74,.75,id==='raider'?2.1:2.5]]){
      const flame=new THREE.Mesh(new THREE.ConeGeometry(.12,.7,6),flameMat);
      flame.rotation.x=-Math.PI/2;flame.position.set(x,y,z);flame.visible=false;root.add(flame);flames.push(flame);
    }
    const flash=new THREE.Mesh(new THREE.SphereGeometry(.19,6,5),flashMat);
    flash.position.fromArray(spec.muzzle||[0,id==='wartruck'?2.94:id==='raider'?2.05:1.85,id==='wartruck'?-2.29:id==='raider'?-1.0:-1.48]);flash.visible=false;root.add(flash);
    root.userData={wheels,spins,flames,flash,id,roll:0,wheelRest:wheels.map(w=>w?.position.clone())};root.rotation.order='YXZ';
    const shadow=new THREE.Mesh(new THREE.PlaneGeometry(VEHICLES[id].width,VEHICLES[id].length*.94),new THREE.ShaderMaterial({transparent:true,depthWrite:false,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec2 vUv;void main(){vec2 p=(vUv-.5)*2.0;float a=(1.0-smoothstep(.3,1.0,length(p)))*.58;gl_FragColor=vec4(0.015,0.011,0.008,a);}'
    }));shadow.rotation.x=-Math.PI/2;shadow.position.y=.045;root.add(shadow);
    if(player)addHeadlights(root,spec.headlights);
    if(spec.beacon)addBeacon(root,spec.beacon);
    return root;
  }
  let beat=0;
  function setBeat(level){beat=level||0;for(const t of Object.values(templates))for(const p of t.userData.pulse||[])p.material.emissiveIntensity=p.base*(.25+beat*1.9);}
  function update(root,s,dt){
    root.position.set(s.x,s.y+(s.heave||0),s.z);root.rotation.set(s.pitch||0,s.heading,s.roll||0);
    const id=root.userData.id;root.userData.roll+=s.speed*dt/(VEHICLES[id]?.wheelRadius||(id==='wartruck'?.56:id==='raider'?.5:.45));
    for(let i=0;i<root.userData.wheels.length;i++){
      const w=root.userData.wheels[i];if(!w)continue;
      // Positive input turns the car right (negative Three.js yaw).
      w.rotation.y=i<2?-s.steer:0;
      w.position.y=root.userData.wheelRest[i].y+(s.wheelOffsets?.[i]||0);
      // Spin the tire meshes without losing the exported wheel pivot orientation.
      root.userData.spins[i].rotation.x=-root.userData.roll;
    }
    root.userData.flames.forEach(f=>{f.visible=s.boosting;f.scale.y=.8+Math.random()*.6;});
    const beacon=root.userData.beacon;
    if(beacon){beacon.spin.rotation.y-=dt*7.5;const flash=.55+.45*Math.max(0,Math.sin(performance.now()*.0125));beacon.dome.material.emissiveIntensity=1.2+flash*2.6;}
  }
  function damage(root,severity){
    if(!root)return;severity=Math.min(1,Math.max(0,severity));
    if(Math.abs(severity-(root.userData.damage||0))<.025)return;root.userData.damage=severity;
    if(!root.userData.crumple){
      root.userData.crumple=[];
      for(const mesh of root.children){
        if(!mesh.isMesh||!mesh.geometry.attributes.position||!/steel|rust|graphite|ochre|oxide|paint/i.test(mesh.material.name))continue;
        mesh.geometry=mesh.geometry.clone();root.userData.crumple.push({mesh,original:mesh.geometry.attributes.position.array.slice()});
      }
    }
    for(const {mesh,original} of root.userData.crumple){
      const p=mesh.geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const x=original[i*3],y=original[i*3+1],z=original[i*3+2];
        const nose=Math.max(0,Math.min(1,(-z-1.05)*.7)),dent=Math.sin(x*5.2+z*3.4)*severity*.1;
        p.setXYZ(i,x*(1-nose*severity*.12),y+dent*nose,z+nose*severity*.55);
      }
      p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
    }
  }
  // Driver view: hide the smoked cabin glass, cut the window band out of the player's own shell and
  // show the interior. Built the first time someone climbs in.
  function setCockpit(root,inside,state,game){
    if(!root)return;
    if(inside&&!root.userData.cockpit)root.userData.cockpit=createCockpit(root,root.userData.id,{weathering});
    const cockpit=root.userData.cockpit;
    if(root.userData.inside!==inside){
      root.userData.inside=inside;cockpit?.set(inside);
      // The glass, and a bonus car's own interior ("Interior …" materials), give way to the cockpit.
      root.traverse(o=>{if(o.isMesh&&/glass|^Interior/i.test(o.material?.name||''))o.visible=!inside;});
    }
    if(inside&&state)cockpit?.update(state,game,beat);
  }
  return {create,update,damage,setCockpit,setBeat,templates};
}

// The Blender models carry the original 'KALMAR' rear lettering. Hide it and paint the installed city's
// name in the same place, as a stencilled decal.
function cityInsignia(root){
  root.updateMatrixWorld(true);
  const box=new THREE.Box3(),inverse=new THREE.Matrix4().copy(root.matrixWorld).invert(),found=[];
  root.traverse(o=>{if(/insignia/i.test(o.name)&&o.isMesh){found.push(o);o.geometry.computeBoundingBox();box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));}});
  if(!found.length)return;
  for(const o of found)o.visible=false;
  const text=(CITY.name||'').toUpperCase();if(!text||typeof document==='undefined')return;
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=192;const ctx=canvas.getContext('2d');
  let size=150;ctx.font=`900 ${size}px Impact, 'Arial Black', sans-serif`;
  while(ctx.measureText(text).width>980&&size>40){size-=6;ctx.font=`900 ${size}px Impact, 'Arial Black', sans-serif`;}
  ctx.fillStyle='#d9cdb4';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,100);
  ctx.globalCompositeOperation='destination-out';
  for(let i=0;i<900;i++){ctx.globalAlpha=Math.random()*.5;ctx.fillRect(Math.random()*1024,Math.random()*192,Math.random()*9+1,Math.random()*3+1);}
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  const size3=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const width=Math.max(size3.x,.7)*1.15,height=width*192/1024;
  const decal=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.25,roughness:.85,name:'Insignia city'}));
  decal.name='Insignia city';decal.position.set(center.x,center.y,box.max.z+.006);root.add(decal);
}
