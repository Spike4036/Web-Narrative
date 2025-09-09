/* =================== DOM & 状态 =================== */
const app      = document.getElementById('app');
const sceneEl  = document.querySelector('.scene');
const sceneImg = document.getElementById('sceneImg');
const sceneCap = document.getElementById('sceneCap');
const hudSan   = document.getElementById('hudSan');
const sanVal   = document.getElementById('sanVal');
const sanFill  = document.getElementById('sanFill');
const statusEl = document.getElementById('status');
const typoBox  = document.getElementById('typo');
const choices  = document.getElementById('choices');
const alarmEl  = document.getElementById('alarm'); // <audio loop src="media/alarm.mp3">

const PANIC_THRESHOLD = 60; // SAN 低阈值
const state = { san:100, data:null, nodeKey:null };

let userInteracted = false;

window.addEventListener('pointerdown', () => {
  userInteracted = true;
  // 如果此刻警报应当是开启状态，但没在响，尝试补播
  if (alarmState.active && alarmEl && alarmEl.paused) {
    alarmEl.play().catch(e => console.warn('retry alarm play failed', e));
  }
}, { passive:true });

/* =================== 工具 =================== */
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
function setSAN(delta){ state.san = clamp(state.san + delta, 0, 100); renderSAN(); }
function renderSAN(){
  sanVal.textContent = state.san;
  hudSan.textContent = `SAN ${state.san}%`;
  sanFill.style.transform = `scaleX(${state.san/100})`;
  app.classList.toggle('panic', state.san <= PANIC_THRESHOLD);
}
function setScene(src, cap){ if(src) sceneImg.src = src; if(cap) sceneCap.textContent = cap; }
function setStatus(s){ statusEl.textContent = s || 'COMMS: —'; }

/* =================== 打字机 =================== */
let typing=false, caret=null;
function clearType(){
  typoBox.innerHTML=''; choices.innerHTML='';
  if(caret){ caret.remove(); caret=null; }
}
function pushCaret(){
  if(!caret){ caret = document.createElement('span'); caret.className='caret'; typoBox.appendChild(caret); }
}
function typeLines(lines, onDone){
  clearType();
  typing=true;
  const speed=22, paraGap=200;
  let idx=0;
  const nextPara=()=>{
    if(idx>=lines.length){ typing=false; onDone && onDone(); return; }
    const line = lines[idx++];
    const p = document.createElement('p'); typoBox.appendChild(p);
    let i=0;
    (function step(){
      if(i<=line.length){
        p.textContent = line.slice(0,i++);
        clickTick(); pushCaret();
        setTimeout(step, speed);
      }else{
        setTimeout(nextPara, paraGap);
      }
    })();
  };
  nextPara();
}

function renderChoices(list){
  choices.innerHTML='';
  list.forEach((c,i)=>{
    const b=document.createElement('button');
    b.className='btn';
    b.textContent = `${i+1}. ${c.label}`;
    b.onclick = ()=> goto(c.next, c.san||0, c.stopAlarm===true);
    b.onpointerdown = clickTick;
    choices.appendChild(b);
  });
}

/* =================== 点击音（唯一内置音效） =================== */
let actx=null, master=null, clickOsc=null, clickGain=null, audioArmed=false;

function armAudio(){
  if(audioArmed) return;
  actx = new (window.AudioContext||window.webkitAudioContext)();
  master = actx.createGain(); master.gain.value = 0.22; master.connect(actx.destination);

  clickOsc = actx.createOscillator(); 
  clickOsc.type='square'; 
  clickOsc.frequency.value=880;
  clickGain = actx.createGain(); 
  clickGain.gain.value=0;
  clickOsc.connect(clickGain).connect(master); 
  clickOsc.start();

  audioArmed = true;
}
function clickTick(){
  if(!audioArmed) return;
  const t=actx.currentTime;
  clickGain.gain.cancelScheduledValues(t);
  clickGain.gain.setValueAtTime(0.08,t);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
}
addEventListener('pointerdown', armAudio, {once:true});

/* =================== 红 = 警报 = 闪烁（强同步控制） =================== */
let alarmState = { active:false, flickerLock:false };

async function setAlarm(on){
  if(alarmState.active === on) return;
  alarmState.active = on;

  // 主题
  document.documentElement.dataset.theme = on ? 'red-quiet' : 'green-crt';
  // 连动边框闪烁
  document.body.classList.toggle('alarm-on', on);

  // 播放/停止 <audio>
  if (alarmEl && alarmEl.src) {
    try {
      if (on) { await alarmEl.play(); }
      else { alarmEl.pause(); alarmEl.currentTime = 0; }
    } catch (e) {
      console.warn('Alarm autoplay blocked (theme/flicker still synced).', e);
    }
  }

  // 入场一次性红闪（仅在开启瞬间）
  if (on) {
    if (alarmState.flickerLock) return;
    alarmState.flickerLock = true;
    sceneEl.classList.remove('enter-flicker'); void sceneEl.offsetWidth;
    sceneEl.classList.add('enter-flicker');
    setTimeout(()=>{
      sceneEl.classList.remove('enter-flicker');
      alarmState.flickerLock = false;
    }, 600);
  } else {
    sceneEl.classList.remove('enter-flicker');
  }
}

/* =================== 导航 =================== */
function goto(key, sanDelta=0, stopAlarmFlag=false){
  const node = state.data.nodes[key]; if(!node) return;

  state.nodeKey = key;
  setSAN(sanDelta);
  setScene(node.img, node.cap);
  setStatus(node.status);

  // 红/绿 + 警报 + 闪烁：唯一入口
  if (stopAlarmFlag === true) {
    setAlarm(false);
  } else if (node.hasOwnProperty('alarm')) {
    setAlarm(!!node.alarm); // 写了 true/false 就执行；未写则保持
  }

  typeLines(node.text, ()=> renderChoices(node.choices||[]));
}

/* =================== 键盘快捷键 =================== */
document.addEventListener('keydown',(e)=>{
  const btns=[...document.querySelectorAll('.choices .btn')];
  if(e.key==='1'&&btns[0]) btns[0].click();
  if(e.key==='2'&&btns[1]) btns[1].click();
  if(e.key==='3'&&btns[2]) btns[2].click();
});

/* =================== 启动：加载 JSON =================== */
fetch('data/data.json')
  .then(r=>r.json())
  .then(data=>{
    state.data = data;
    renderSAN();
    goto(data.startNode || 'start', 0);
  })
  .catch(err=>{
    console.error('Failed to load data.json:', err);
    // 兜底节点
    state.data = { startNode:'start', nodes:{ start:{
      img:'img/placeholder.jpg', cap:'—', status:'—', alarm:false,
      text:['No data.json found.'], choices:[]
    }}};
    goto('start',0);
  });