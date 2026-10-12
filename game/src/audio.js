import {collisionSound} from './collision-audio.js';
import {CITY} from './city-config.js';

export async function createAudio(){
  let enabled=true,active=false,context=null,master=null,engineSource=null,engineGain=null,voice=null,music=null,musicTitle='';
  // The music runs through an analyser once the audio context exists, so lights can pulse with the bass.
  let analyser=null,spectrum=null,bassLevel=0;
  function listen(element){
    if(!context||!element||element.dataset.analysed)return;
    try{
      if(!analyser){analyser=context.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.5;spectrum=new Uint8Array(analyser.frequencyBinCount);analyser.connect(context.destination);}
      context.createMediaElementSource(element).connect(analyser);element.dataset.analysed='1';
    }catch{}
  }
  function level(){
    if(!analyser||!music||music.paused)return bassLevel*=.9;
    analyser.getByteFrequencyData(spectrum);
    const bins=Math.max(2,Math.round(140/(context.sampleRate/analyser.fftSize)));   // up to ~140 Hz: kick and bass
    let sum=0;for(let i=1;i<=bins;i++)sum+=spectrum[i];
    const v=Math.max(0,(sum/bins/255-.45)/.5);
    return bassLevel=Math.max(v,bassLevel*.82);
  }
  const buffers=new Map(),offsets=new Map();let assets={voices:[],effects:[]},playlist=[],trackIndex=0;
  const ambience=new Map();let gunOffset=0,scrapeUntil=0,scrapeStrength=0,noiseBuffer=null;
  try{const response=await fetch('audio/generation.json');if(response.ok)assets=await response.json();}catch{}
  // The installed city can bring its own voice lines (city/audio/voice-*.mp3) that name the place.
  const cityVoices=new Set(CITY.voices||[]);assets.voices=[...new Set([...(assets.voices||[]),...cityVoices])];
  async function unlock(){
    // Begin media playback inside the Start button's trusted gesture.
    if(music&&enabled)music.play().catch(()=>{});
    if(!context){context=new AudioContext();master=context.createGain();master.gain.value=enabled?.65:0;
      listen(music);
      const limiter=context.createDynamicsCompressor();limiter.threshold.value=-10;limiter.knee.value=10;limiter.ratio.value=4;limiter.attack.value=.003;limiter.release.value=.18;master.connect(limiter);limiter.connect(context.destination);
      await Promise.all((assets.effects||[]).map(async name=>{
        try{const r=await fetch(`audio/sfx-${name}.mp3`);if(r.ok){
          const buffer=await context.decodeAudioData(await r.arrayBuffer());buffers.set(name,buffer);
          if(name.startsWith('impact-')||['rocket','mine'].includes(name)){const data=buffer.getChannelData(0);let peak=0;for(const sample of data)peak=Math.max(peak,Math.abs(sample));
            const onset=data.findIndex(sample=>Math.abs(sample)>peak*.12);offsets.set(name,Math.max(0,onset/buffer.sampleRate-.006));}
          if(name==='gun'){const data=buffer.getChannelData(0);let peak=0;for(const sample of data)peak=Math.max(peak,Math.abs(sample));const onset=data.findIndex(sample=>Math.abs(sample)>peak*.22);gunOffset=Math.max(0,onset/buffer.sampleRate-.003);}
        }}catch{}
      }));
    }
    await context.resume();
  }
  function impact(options){
    if(!enabled||!context)return;
    const p=collisionSound(options),now=context.currentTime;
    const buffer=buffers.get(p.sample)||buffers.get('impact');
    if(buffer){
      const source=context.createBufferSource(),gain=context.createGain(),filter=context.createBiquadFilter();source.buffer=buffer;source.playbackRate.value=p.rate;
      filter.type=p.material==='glass'?'highpass':'lowpass';filter.frequency.value=p.material==='glass'?900:p.heavy?12000:3500+p.strength*3500;
      const duration=p.heavy?1.25:p.material==='glass'?.8:.48;
      source.connect(filter);filter.connect(gain);gain.connect(master);gain.gain.setValueAtTime(p.volume,now);gain.gain.setValueAtTime(p.volume,now+.035);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
      source.start(now,offsets.get(p.sample)||0);source.stop(now+duration+.03);
      source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
    }
    // Add a little chassis body beneath the distinct material recording.
    const bass=context.createOscillator(),body=context.createGain();bass.type='sine';bass.frequency.setValueAtTime(p.heavy?74:110,now);bass.frequency.exponentialRampToValueAtTime(p.heavy?29:56,now+p.duration);
    body.gain.setValueAtTime(p.volume*p.bass,now);body.gain.exponentialRampToValueAtTime(.0001,now+p.duration);bass.connect(body);body.connect(master);bass.start(now);bass.stop(now+p.duration);bass.onended=()=>{bass.disconnect();body.disconnect();};
    if(!noiseBuffer){noiseBuffer=context.createBuffer(1,Math.ceil(context.sampleRate*.35),context.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;}
    const grit=context.createBufferSource(),tone=context.createBiquadFilter(),gain=context.createGain();grit.buffer=noiseBuffer;
    tone.type=p.material==='glass'?'highpass':'bandpass';tone.frequency.value={concrete:650,wood:1700,metal:p.heavy?950:2300,glass:3800}[p.material];tone.Q.value=p.material==='metal'?2:.7;
    const duration=p.heavy?.22:.09;gain.gain.setValueAtTime(p.volume*(p.material==='glass'?.32:.18),now);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);grit.connect(tone);tone.connect(gain);gain.connect(master);grit.start(now);grit.stop(now+duration);grit.onended=()=>{grit.disconnect();tone.disconnect();gain.disconnect();};
  }
  function scrape(strength){if(!context||!active)return;scrapeUntil=context.currentTime+.1;scrapeStrength=Math.min(1,strength);}
  function effect(name,volume=.5,rate=1){
    if(!enabled||!context)return;
    const fallback={rocket:'nitro',mine:'pickup',flame:'nitro'};
    const buffer=buffers.get(name)||buffers.get(fallback[name]);if(!buffer)return;
    const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;source.playbackRate.value=rate;
    source.connect(gain);gain.connect(master);source.onended=()=>{source.disconnect();gain.disconnect();};
    if(name==='gun'){
      // Use a single attack from the recorded burst instead of overlapping ten
      // full one-second bursts each second of automatic fire.
      const now=context.currentTime;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume,now+.003);
      gain.gain.setValueAtTime(volume,now+.055);gain.gain.exponentialRampToValueAtTime(.0001,now+.155);
      source.start(now,gunOffset);source.stop(now+.18);
    }else{gain.gain.value=volume;source.start(context.currentTime,offsets.get(name)||0);}
  }
  function say(name){
    if(!enabled||!assets.voices.includes(name))return;
    if(voice){voice.pause();voice=null;}
    voice=new Audio(cityVoices.has(name)?`city/audio/voice-${name}.mp3`:`audio/voice-${name}.mp3`);voice.volume=.85;voice.play().catch(()=>{});
  }
  function startEngine(){
    active=true;
    if(context&&buffers.has('engine')&&!engineSource){engineSource=context.createBufferSource();engineGain=context.createGain();engineSource.buffer=buffers.get('engine');engineSource.loop=true;
      engineGain.gain.value=.16;engineSource.connect(engineGain);engineGain.connect(master);engineSource.start();}
    if(music&&enabled)music.play().catch(()=>{});
    for(const name of ['wind','fire','burner','burner-crackle','scrape'])if(context&&!ambience.has(name)){
      const buffer=buffers.get(name==='burner'?'flame':name==='burner-crackle'?'fire':name==='scrape'?'scrape-metal':name)|| (name==='burner'?buffers.get('nitro'):name==='scrape'?buffers.get('impact'):null);if(!buffer)continue;
      const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=name==='wind'?.08:0;
      if(name==='burner')source.playbackRate.value=.95;if(name==='burner-crackle')source.playbackRate.value=1.2;
      if(name==='scrape'){source.playbackRate.value=1;source.loopEnd=buffer.duration;}
      source.connect(gain);gain.connect(master);source.start();ambience.set(name,{source,gain});
    }
  }
  function pause(paused){active=!paused;if(engineGain&&context)engineGain.gain.setTargetAtTime(paused?0:.16,context.currentTime,.1);for(const [name,item]of ambience)item.gain.gain.setTargetAtTime(paused?0:name==='wind'?.08:0,context.currentTime,.1);if(voice&&paused)voice.pause();if(music){if(paused)music.pause();else if(enabled)music.play().catch(()=>{});}}
  function update(s,fires=[],{flame=false}={}){if(engineSource&&active){engineSource.playbackRate.setTargetAtTime(.75+Math.abs(s.speed)/26+(s.boosting?.3:0),context.currentTime,.06);engineGain.gain.setTargetAtTime(.14+Math.min(Math.abs(s.speed)/200,.16),context.currentTime,.1);
    const fire=ambience.get('fire');if(fire){const distance=Math.min(100,...fires.map(f=>Math.hypot(f.x-s.x,f.z-s.z)));fire.gain.gain.setTargetAtTime(.3*Math.max(0,1-distance/45)**2,context.currentTime,.15);}
    for(const [name,volume]of [['burner',.34],['burner-crackle',.24]])ambience.get(name)?.gain.gain.setTargetAtTime(flame?volume:0,context.currentTime,.045);
    ambience.get('scrape')?.gain.gain.setTargetAtTime(context.currentTime<scrapeUntil?.12*scrapeStrength:0,context.currentTime,.045);
  }}
  function toggle(){enabled=!enabled;if(master&&context)master.gain.setTargetAtTime(enabled?.65:0,context.currentTime,.05);if(!enabled){voice?.pause();music?.pause();}else if(active)music?.play().catch(()=>{});return enabled;}
  function playTrack(index,{play=active||Boolean(music&&!music.paused)}={}){
    if(!playlist.length)return;
    trackIndex=(index+playlist.length)%playlist.length;const track=playlist[trackIndex];
    if(music){music.pause();music.remove();}musicTitle=track.title;
    music=new Audio(track.file);music.id='soundtrack';music.hidden=true;music.preload='auto';music.loop=playlist.length===1;music.volume=.36;
    music.addEventListener('ended',()=>playTrack(trackIndex+1));document.body.append(music);listen(music);
    document.dispatchEvent(new CustomEvent('radio-track',{detail:{title:musicTitle,index:trackIndex,count:playlist.length}}));
    if(play&&enabled)music.play().catch(()=>{});
  }
  function nextMusic(){playTrack(trackIndex+1,{play:true});}
  function previousMusic(){playTrack(trackIndex-1,{play:true});}
  function loadMusic(url,title='CUSTOM SOUNDTRACK'){playlist.push({file:url,title});playTrack(playlist.length-1,{play:true});}
  // Playlists by URL: the city's soundtrack (or the bundled one) and any bonus vehicle's own radio.
  const playlists=new Map();
  async function readPlaylist(url){
    if(playlists.has(url))return playlists.get(url);
    let tracks=[];
    try{const r=await fetch(url);if(r.ok){const m=await r.json();const base=url.slice(0,url.lastIndexOf('/')+1);
      tracks=(m.tracks||[m]).filter(t=>t.file&&t.title).map(t=>({...t,file:url.startsWith('city/')&&!t.file.startsWith('city/')?base+t.file.replace(/^audio\//,''):t.file}));}}catch{}
    playlists.set(url,tracks);return tracks;
  }
  let soundtrack=null,station=null;
  for(const url of [CITY.music,'audio/music.json'].filter(Boolean)){
    const tracks=await readPlaylist(url);
    if(tracks.length){soundtrack=station=url;playlist=tracks;playTrack(0);break;}
  }
  // Choosing a vehicle with its own music (theme.json bonus_vehicles[].music) changes the station;
  // any other vehicle brings the city's soundtrack back.
  async function setVehicle(id){
    const url=(CITY.bonus_vehicles||[]).find(v=>v.id===id)?.music||soundtrack;
    if(!url||url===station)return;
    const tracks=await readPlaylist(url);if(!tracks.length)return;
    station=url;playlist=tracks;playTrack(0);
  }
  return {unlock,effect,impact,scrape,say,startEngine,pause,update,toggle,loadMusic,nextMusic,previousMusic,setVehicle,level,get enabled(){return enabled;},get musicTitle(){return musicTitle;},get trackCount(){return playlist.length;}};
}
