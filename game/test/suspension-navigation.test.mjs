import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCarState,VEHICLES} from '../src/physics.js';
import {stepSuspension,wheelContacts,setGroundReference,followGround} from '../src/suspension.js';
import {nearestDirections,directionBearing} from '../src/navigation.js';

test('Suspension compresses on a bump, rebounds, and settles while separate wheels follow uneven ground',()=>{
  const s=createCarState({y:0}),spec=VEHICLES.wartruck;
  for(let i=0;i<30;i++)stepSuspension(s,1/90,spec,[.16,.16,0,0,0,0],0,0);
  assert(s.heave>.04);assert(s.pitch>.02);assert(s.wheelOffsets[0]!==s.wheelOffsets[2]);
  let lowest=Infinity;
  for(let i=0;i<450;i++){stepSuspension(s,1/90,spec,[0,0,0,0,0,0],0,0);lowest=Math.min(lowest,s.heave);}
  assert(lowest<0);assert(Math.abs(s.heave)<.001);assert(Math.abs(s.pitch)<.001);
});
test('A right corner transfers load toward the outside; acceleration lifts the nose and braking dives it',()=>{
  const s=createCarState({y:0});s.speed=15;s.heading=-.006;
  for(let i=0;i<90;i++)stepSuspension(s,1/90,VEHICLES.wartruck,[0,0,0,0,0,0],s.speed-.06,s.heading+.006);
  assert(s.roll>.05);assert(s.pitch>.02);
  for(let i=0;i<100;i++)stepSuspension(s,1/90,VEHICLES.wartruck,[0,0,0,0,0,0],s.speed+.15,s.heading);
  assert(s.pitch<-.035);
});
test('The six-wheel rig follows a sloped road without shifting its chassis centre and its tandem wheels move independently',()=>{
  const spec=VEHICLES.wartruck,s=createCarState({y:0}),contacts=wheelContacts(spec);
  assert.equal(contacts.length,6);
  const heights=contacts.map(([x,z])=>.035*x-.04*z);
  for(let i=0;i<450;i++)stepSuspension(s,1/90,spec,heights,0,0);
  assert(Math.abs(s.heave)<.001);assert(Math.abs(s.pitch-.04)<.001);assert(Math.abs(s.roll-.035)<.001);
  assert(s.wheelOffsets.every(offset=>Math.abs(offset)<.001));
  heights[4]+=.2;
  stepSuspension(s,1/90,spec,heights,0,0);
  assert(s.wheelOffsets[4]-s.wheelOffsets[2]>.035);
  assert(s.wheelOffsets[4]-s.wheelOffsets[5]>.035);
});
test('A curb moves the wheel contact reference immediately but the sprung chassis rises over time',()=>{
  const s=createCarState({y:0}),spec=VEHICLES.wartruck;
  setGroundReference(s,.18);
  assert.equal(s.y+s.heave,0);
  stepSuspension(s,1/90,spec,Array(6).fill(.18),0,0);
  assert(s.y+s.heave>0&&s.y+s.heave<.01);
  for(let i=0;i<450;i++)stepSuspension(s,1/90,spec,Array(6).fill(.18),0,0);
  assert(Math.abs(s.y+s.heave-.18)<.001);
});
test('Direction markers use only the closest three living enemies and closest active repair',()=>{
  const enemy=(x,health=10)=>({health,state:{x,z:0}}),pickup=(x,active=true,kind='repair')=>({x,z:0,active,kind});
  const markers=nearestDirections({player:{x:0,z:0},enemies:[enemy(40),enemy(5,0),enemy(10),enemy(30),enemy(20)],pickups:[pickup(2,false),pickup(12,true,'scrap'),pickup(80),pickup(60)]});
  assert.deepEqual(markers.map(m=>m.distance),[10,20,30,60]);assert.equal(markers[3].kind,'repair');
  assert.equal(directionBearing({x:0,z:0},{x:1,z:0},0),Math.PI/2);
  assert(Math.abs(directionBearing({x:0,z:0},{x:0,z:1},0))===Math.PI);
});
test('A fast car climbing a steep offroad slope never sinks below the ground it is probed against',()=>{
  // The game probes the ground every 0.07 s; the slope below rises .45 m per metre (a coarse-terrain hill).
  for(const speed of [8,15,22,30]){
    const s=createCarState({y:0}),slope=.45,dt=.07;let x=0,lowest=Infinity;
    for(let tick=0;tick<120;tick++){
      const before=x;x+=speed*dt;
      followGround(s,slope*x,x-before);
      lowest=Math.min(lowest,s.y-slope*x);
    }
    assert(lowest>=-1e-6,`at ${speed} m/s the car sat ${(-lowest).toFixed(2)} m under the surface`);
  }
});
