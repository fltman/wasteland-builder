import * as THREE from 'three';

// Hand-welded salvage additions on the authored Blender chassis, before batching.
export function addSalvageDetails(root,id){
  const truck=id==='wartruck',w=truck?1.04:.94;
  const rusty=new THREE.MeshStandardMaterial({name:'Salvage rust',color:0x653820,roughness:.97,metalness:.45});
  const steel=new THREE.MeshStandardMaterial({name:'Salvage burned steel',color:0x37322b,roughness:.92,metalness:.5});
  const pale=new THREE.MeshStandardMaterial({name:'Salvage chipped edge',color:0x8b795d,roughness:.82,metalness:.55});
  const rubber=new THREE.MeshStandardMaterial({name:'Salvage rubber',color:0x171310,roughness:1});
  const group=new THREE.Group();group.name='Welded wasteland salvage';root.add(group);
  let seed=id==='interceptor'?17:id==='raider'?31:49;
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const add=(geometry,material,x,y,z)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);group.add(mesh);return mesh;};
  const box=(mat,x,y,z,sx,sy,sz)=>add(new THREE.BoxGeometry(sx,sy,sz),mat,x,y,z);
  const rod=(a,b,r=.035,mat=steel)=>{
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);
    const mesh=add(new THREE.CylinderGeometry(r,r,start.distanceTo(end),8),mat,...start.clone().add(end).multiplyScalar(.5).toArray());
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.sub(start).normalize());return mesh;
  };
  // Uneven overlapping armor; broken symmetry makes the cars feel rebuilt.
  for(const side of [-1,1]){
    for(let j=0;j<7;j++){
      const z=-1.75+j*.52+(rand()-.5)*.15,y=.58+rand()*.16;
      const plate=box(j%3?rusty:steel,side*(w+.06),y,z,.065,.34+rand()*.25,.4+rand()*.26);
      plate.rotation.set((rand()-.5)*.16,(rand()-.5)*.12,(rand()-.5)*.14);
      for(const dy of [-.12,.12])add(new THREE.SphereGeometry(.022,5,4),pale,side*(w+.11),y+dy,z);
    }
    rod([side*(w+.12),.5,1.95],[side*(w+.12),1.03,-1.95],.045);
    // Window bars and roof cage are rusty, bent and visually prominent.
    for(let j=0;j<4;j++)rod([side*.75,1.15,-.54+j*.23],[side*.77,1.78,-.48+j*.23],.027,pale);
    rod([side*.85,.8,1.48],[side*.64,1.94,.67],.045,pale);
    rod([side*.64,1.94,.67],[side*.6,1.91,-.43],.04,pale);
  }
  // Jagged welded plow, with irregular teeth instead of a factory bumper.
  const front=truck?-3.08:-2.78,verts=[],indices=[];
  for(let i=0;i<9;i++){
    const x=-1.24+i*.31;
    verts.push(x,.83+(i%3)*.025,front+.16,x,.22+(i%2)*.17,front-.12);
    if(i<8){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  const blade=new THREE.BufferGeometry();blade.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));blade.setIndex(indices);blade.computeVertexNormals();
  const bladeMat=rusty.clone();bladeMat.name='Salvage plow rust';bladeMat.side=THREE.DoubleSide;add(blade,bladeMat,0,0,0);
  rod([-1.24,.85,front+.16],[1.24,.85,front+.16],.075,pale);
  for(const x of [-1.13,-.65,0,.65,1.13]){
    rod([x,.57,front+.35],[x,.48,front-.23],.06,steel);
    const spike=add(new THREE.ConeGeometry(.08,.38,6),pale,x,.47,front-.36);spike.rotation.x=-Math.PI/2;
  }
  // Rear salvage rack, a vertically strapped spare wheel and hanging tow chains.
  const rear=truck?2.55:2.2;
  box(steel,0,.73,rear,1.75,.08,.48);
  for(const side of [-1,1])rod([side*.72,.64,rear+.15],[side*.72,1.44,rear+.15],.04);
  const tire=add(new THREE.TorusGeometry(.39,.14,8,24),rubber,-.28,1.13,rear+.15);tire.rotation.y=.12;
  add(new THREE.CylinderGeometry(.25,.25,.09,12),steel,-.28,1.13,rear+.15).rotation.x=Math.PI/2;
  rod([-.77,.68,rear+.35],[.21,1.57,rear+.35],.035,pale);
  for(const side of [-1,1])for(let i=0;i<12;i++){
    const x=side*.71+Math.sin(i*.35)*.08,y=.64-i*.045,z=rear+.37;
    const link=add(new THREE.TorusGeometry(.049,.011,4,8),rusty,x,y,z);link.rotation.y=i%2?Math.PI/2:0;
  }
  // Scavenged hood plates and roof spikes, with individual weld angles.
  for(let i=0;i<9;i++){
    const plate=box(i%2?rusty:steel,(rand()-.5)*1.5,.94,-1.1-rand()*.88,.27+rand()*.25,.025,.25+rand()*.38);
    plate.rotation.y=(rand()-.5)*.9;
  }
  for(const side of [-1,1])for(let i=0;i<4;i++){
    const spike=add(new THREE.ConeGeometry(.065,.3+(i%2)*.13,5),pale,side*.65,2.04,.52-i*.27);
    spike.rotation.z=-side*.28;
  }
  box(rusty,.55,1.12,1.67,.36,.62,.18).rotation.z=.1;
  // Dent the existing Blender shell, leaving wheel pivots and running gear intact.
  root.traverse(o=>{
    if(!o.isMesh||!/^Armored_chassis|^Cabin/.test(o.name))return;
    o.geometry=o.geometry.clone();const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const dent=Math.sin(x*7.3+y*4.1+z*8.7)*.04;
      p.setXYZ(i,x*(1+dent*.7),y+dent,z+dent*.3);
    }
    p.needsUpdate=true;o.geometry.computeVertexNormals();
  });
}

export function addHeadlights(root,positions=[[-.73,.97,-2.35],[.73,.97,-2.35]]){
  for(const [x,y,z] of positions){
    const lamp=new THREE.SpotLight(0xffbf75,6,25,.3,.65,2);lamp.position.set(x,y,z);
    lamp.target.position.set(x,.18,-30);root.add(lamp,lamp.target);
  }
  // Soft transparent beam volume: light catching the airborne sand.
  const geometry=new THREE.ConeGeometry(3.1,25,24,1,true);
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec2 vUv;void main(){float fade=pow(vUv.y,2.0)*(1.0-vUv.y);gl_FragColor=vec4(0.45,0.28,0.1,fade*0.045);}'
  });
  for(const [x,y,z] of positions){const beam=new THREE.Mesh(geometry,mat);beam.rotation.x=Math.PI/2;beam.position.set(x,y-.24,z-12.45);root.add(beam);}
}
