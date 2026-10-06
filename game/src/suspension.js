import {clamp,angleDiff} from './physics.js';

export const WHEEL_CONTACTS=[[-.99,-1.48],[.99,-1.48],[-.99,1.48],[.99,1.48]];
export function wheelContacts(spec){
  const front=spec.mass>4000?1.68:spec.mass<1500?1.17:1.44,track=spec.mass>4000?1.13:spec.mass<1500?1.11:1.03;
  const contacts=WHEEL_CONTACTS.map(([x,z])=>[Math.sign(x)*track,Math.sign(z)*front]);
  if(spec.mass>4000)contacts.push([-track,2.54],[track,2.54]);
  return contacts;
}
export function roadProfile(x,z,offroad=false){
  // Spatial roughness: the same cobble is under the same wheel on every pass.
  return (Math.sin(x*8.7+z*4.1)*.009+Math.sin(x*23.1-z*16.4)*.005+Math.sin(x*.73+z*.91)*.015)*(offroad?2.4:1);
}
export function setGroundReference(s,height){
  // Changing the ground reference must not teleport the sprung chassis up a
  // curb. Its world height stays continuous and the springs lift it afterward.
  s.heave-=height-s.y;s.y=height;
}
// Follow the ground under the car between probes. Dropping is limited (a fast car follows a downhill
// road without hopping) and a step up is limited to a curb, plus the climb the slope allows over the
// horizontal distance driven since the last probe: a fixed cap let a fast car on a hill fall behind
// the surface and sink into it.
export function followGround(s,ground,travel=0){
  setGroundReference(s,s.y+clamp(ground-s.y,-.75,.4+1.2*travel));
}
// Ground height under the chassis centre from the wheel heights (fits the plane along the car, as stepSuspension does).
export function chassisGround(contacts,heights){
  const n=contacts.length,meanZ=contacts.reduce((a,[,z])=>a+z,0)/n,mean=heights.reduce((a,h)=>a+h,0)/n;
  let slope=0,square=0;
  contacts.forEach(([,z],i)=>{slope+=(z-meanZ)*(heights[i]-mean);square+=(z-meanZ)**2;});
  return mean-(square?slope/square:0)*meanZ;
}
export function stepSuspension(s,dt,spec,heights,previousSpeed,previousHeading){
  const truck=spec.mass>4000,frequency=truck?9.5:spec.mass<1500?14:12;
  const spring=(value,velocity,target,omega,damping)=>{
    velocity+=((target-value)*omega*omega-2*damping*omega*velocity)*dt;
    return [value+velocity*dt,velocity];
  };
  const contacts=wheelContacts(spec),count=contacts.length;
  const samples=contacts.map((_,i)=>heights[i]??s.y);
  const meanHeight=samples.reduce((sum,h)=>sum+h,0)/count;
  const meanZ=contacts.reduce((sum,[,z])=>sum+z,0)/count;
  let xSlope=0,zSlope=0,xSquare=0,zSquare=0;
  for(let i=0;i<count;i++){
    const [x,z]=contacts[i],dz=z-meanZ,dh=samples[i]-meanHeight;
    xSlope+=x*dh;xSquare+=x*x;zSlope+=dz*dh;zSquare+=dz*dz;
  }
  xSlope/=xSquare;zSlope/=zSquare;
  s.grade=clamp(-zSlope,-.5,.5);   // rise per metre ahead: hills slow the car and roll it on (physics.js)
  // Fit the road plane at the chassis centre. The truck's rear tandem is
  // asymmetric, so averaging its six heights would pitch/raise it incorrectly.
  const road=meanHeight-zSlope*meanZ-s.y;
  if(s.wheelOffsets.length!==count)s.wheelOffsets=contacts.map((_,i)=>s.wheelOffsets[i]||0);
  s.heaveVelocity+=s.suspensionKick||0;s.suspensionKick=0;
  [s.heave,s.heaveVelocity]=spring(s.heave,s.heaveVelocity,clamp(road,-.25,.3),frequency,truck?.48:.55);
  s.heave=clamp(s.heave,-.25,.32);
  const longitudinal=clamp((s.speed-previousSpeed)/dt,-28,20);
  const lateral=clamp(-angleDiff(s.heading,previousHeading)/dt*s.speed,-22,22);
  const pitch=clamp(-zSlope+longitudinal*(truck?.006:.0045),-.19,.18);
  const roll=clamp(xSlope+lateral*(truck?.013:.009),-.24,.24);
  [s.pitch,s.pitchVelocity]=spring(s.pitch,s.pitchVelocity,pitch,truck?7.5:10,.58);
  [s.roll,s.rollVelocity]=spring(s.roll,s.rollVelocity,roll,truck?6.5:9,.5);
  for(let i=0;i<count;i++){
    const [x,z]=contacts[i],body=s.y+s.heave-s.pitch*z+s.roll*x;
    const target=clamp(samples[i]-body,truck?-.32:-.22,truck?.3:.22);
    s.wheelOffsets[i]+=(target-s.wheelOffsets[i])*(1-Math.exp(-24*dt));
  }
  return s;
}
