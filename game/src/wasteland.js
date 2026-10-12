import * as THREE from 'three';

// Shared Imagegen surface, projected onto the existing city and Blender armor.
export async function loadWeathering(){
  const texture=await new THREE.TextureLoader().loadAsync('art/wasteland-grunge.png');
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
  return texture;
}
export function weatherMaterial(material,texture,vehicle=false){
  if(!texture||!material.isMeshStandardMaterial||material.userData.wasteland)return;
  material.userData.wasteland=true;
  if(/lamp|insignia|clean/i.test(material.name))return;   // "clean": a cherished car (a city's bonus vehicle)
  if(/nitro/i.test(material.name))material.color.set(0x405044);
  if(vehicle){
    if(/graphite/i.test(material.name))material.color.set(0x343b42);
    if(/red oxide/i.test(material.name))material.color.set(0xa64728);
    if(/ochre/i.test(material.name))material.color.set(0xa08c51);
  }
  material.roughness=Math.max(material.roughness??.5,/glass/i.test(material.name)?.6:.88);
  material.metalness=Math.min(material.metalness??0,.55);
  const prior=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    prior?.(shader);
    shader.uniforms.wastelandGrunge={value:texture};
    shader.vertexShader='varying vec3 vWastelandPosition; varying vec3 vWastelandNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      #ifdef USE_BATCHING
        vWastelandPosition=(modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;
        vWastelandNormal=normalize(mat3(modelMatrix) * mat3(batchingMatrix) * normal);
      #else
        vWastelandPosition=${vehicle?'transformed':'(modelMatrix * vec4(transformed, 1.0)).xyz'};
        vWastelandNormal=normalize(${vehicle?'normal':'mat3(modelMatrix) * normal'});
      #endif`);
    shader.fragmentShader='uniform sampler2D wastelandGrunge; varying vec3 vWastelandPosition; varying vec3 vWastelandNormal;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 wWeights=pow(abs(vWastelandNormal),vec3(4.0));wWeights/=max(dot(wWeights,vec3(1.0)),0.001);
      vec3 wP=vWastelandPosition*${vehicle?'0.55':'0.13'};
      vec3 wG=texture2D(wastelandGrunge,wP.yz).rgb*wWeights.x
              +texture2D(wastelandGrunge,wP.xz).rgb*wWeights.y
              +texture2D(wastelandGrunge,wP.xy).rgb*wWeights.z;
      float wGrain=dot(wG,vec3(0.299,0.587,0.114));
      ${vehicle?`float wRust=smoothstep(0.045,0.14,wG.r-wG.b);
      diffuseColor.rgb=mix(diffuseColor.rgb*(0.6+wGrain),pow(wG,vec3(2.2))*0.65,0.22+wRust*0.3);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.19,0.12,0.055),clamp(1.0-vWastelandPosition.y,0.0,0.6)*0.38);`
      :`float wSoot=1.0-smoothstep(0.14,0.45,wGrain);
      diffuseColor.rgb*=0.48+wGrain*0.55;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.08,0.054,0.03),wSoot*0.23);
      float wFoot=exp(-max(vWastelandPosition.y,0.0)*0.23);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.17,0.12,0.068),wFoot*0.2);`}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      normal=normalize(normal+vec3(-dFdx(wGrain),-dFdy(wGrain),0.0)*${vehicle?'1.65':'1.1'});`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(roughnessFactor*(0.68+wGrain*0.5),0.48,1.0);`);
  };
  material.customProgramCacheKey=()=>`wasteland-v3-${vehicle?'armor':'city'}`;
  material.needsUpdate=true;
}

export function createWasteland(scene,network,city,{lite=false}={}){
  let seed=49;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const points=[];
  // Curb rubble leaves the road's central driving corridor open.
  for(const {a,b,road} of network.segments){
    if(road.w<4||['footway','path','cycleway','steps'].includes(road.kind))continue;
    const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
    for(let d=5+rand()*8;d<len;d+=16+rand()*13){
      const side=rand()<.5?-1:1,offset=road.w*.46;
      const x=a[0]+dx*d/len-dz/len*offset*side,z=a[1]+dz*d/len+dx/len*offset*side;
      if(network.hitsBuilding(x,z,.35)||!network.onLand(x,z))continue;
      points.push({x,z,angle:rand()*Math.PI*2,size:rand(),y:null,checked:0});
    }
  }
  const pool=lite?240:400;
  const rubble=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:0x79664e,roughness:1}),pool);
  const scraps=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x5c3823,roughness:.95,metalness:.3}),pool);
  rubble.castShadow=scraps.castShadow=true;rubble.receiveShadow=scraps.receiveShadow=true;
  rubble.frustumCulled=scraps.frustumCulled=false;scene.add(rubble,scraps);
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  let refresh=0,time=0;
  const count=lite?400:700,positions=new Float32Array(count*3),speeds=new Float32Array(count);
  for(let i=0;i<count;i++){positions[i*3]=(rand()-.5)*105;positions[i*3+1]=rand()*13;positions[i*3+2]=(rand()-.5)*105;speeds[i]=.7+rand()*2;}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const dust=new THREE.Points(geo,new THREE.PointsMaterial({color:0xc4a878,size:.09,transparent:true,opacity:.28,depthWrite:false}));dust.frustumCulled=false;scene.add(dust);
  function update(dt,player){
    time+=dt;dust.position.set(player.x,player.y,player.z);
    for(let i=0;i<count;i++){
      positions[i*3]+=(3.3+speeds[i])*dt;positions[i*3+2]+=dt*.8;positions[i*3+1]+=Math.sin(time+speeds[i]*3)*dt*.18;
      if(positions[i*3]>52.5)positions[i*3]=-52.5;
      if(positions[i*3+2]>52.5)positions[i*3+2]=-52.5;
    }
    geo.attributes.position.needsUpdate=true;
    if((refresh-=dt)>0)return;refresh=.8;
    const nearby=points.filter(p=>Math.abs(p.x-player.x)<80&&Math.abs(p.z-player.z)<80)
      .sort((a,b)=>(a.x-player.x)**2+(a.z-player.z)**2-(b.x-player.x)**2-(b.z-player.z)**2).slice(0,pool);
    let n=0;
    for(const p of nearby){
      if(p.y===null||time-p.checked>4){p.y=city.groundAt(p.x,p.z);p.checked=time;}
      if(p.y===null)continue;
      dummy.position.set(p.x,p.y+.11,p.z);dummy.rotation.set(p.size*.4,p.angle,p.size*.5);
      dummy.scale.set(.2+p.size*.55,.1+p.size*.15,.25+p.size*.65);dummy.updateMatrix();rubble.setMatrixAt(n,dummy.matrix);
      color.setHSL(.08,.12,.19+p.size*.15);rubble.setColorAt(n,color);
      dummy.position.x+=Math.sin(p.angle)*.55;dummy.position.z+=Math.cos(p.angle)*.55;dummy.position.y=p.y+.065;
      dummy.scale.set(.3+p.size*.7,.045,.22+p.size*.35);dummy.updateMatrix();scraps.setMatrixAt(n,dummy.matrix);n++;
    }
    rubble.count=scraps.count=n;rubble.instanceMatrix.needsUpdate=scraps.instanceMatrix.needsUpdate=true;
    if(rubble.instanceColor)rubble.instanceColor.needsUpdate=true;
  }
  return {update};
}
