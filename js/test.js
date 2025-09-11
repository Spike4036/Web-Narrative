/* =================== DOM & 状态 =================== */
const app      = document.getElementById('app');
const sceneEl  = document.querySelector('.scene');
const sceneImg = document.getElementById('sceneImg');
const sceneCap = document.getElementById('sceneCap');
const hudSan   = document.getElementById('hudSan');
const hudO2    = document.getElementById('hudO2');           // NYX-INJECT
const sanVal   = document.getElementById('sanVal');
const o2Val    = document.getElementById('o2Val');           // NYX-INJECT
const sanFill  = document.getElementById('sanFill');
const o2Fill   = document.getElementById('o2Fill');          // NYX-INJECT
const statusEl = document.getElementById('status');
const typoBox  = document.getElementById('typo');
const choices  = document.getElementById('choices');
const alarmEl  = document.getElementById('alarm'); // <audio loop src="media/alarm.mp3">
const mouseEl = document.getElementById('mouse'); // 鼠标声占位

// NYX-INJECT 覆盖弹窗元素
const dockEl     = document.getElementById('dock');
const dockTitle  = document.getElementById('dockTitle');
const dockFrame  = document.getElementById('dockFrame');
const dockClose  = document.getElementById('dockClose');

const PANIC_THRESHOLD = 60; // SAN 低阈值
const O2_STEP = -5; 
const state = { san:100, o2:100, data:null, nodeKey:null }; // NYX-INJECT：加入 o2

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
function setO2(delta){  state.o2  = clamp(state.o2  + delta,  0, 100); renderO2(); } // NYX-INJECT

function renderSAN(){
  sanVal.textContent = state.san;
  hudSan.textContent = `SAN ${state.san}%`;
  sanFill.style.transform = `scaleX(${state.san/100})`;
  app.classList.toggle('panic', state.san <= PANIC_THRESHOLD);
}
function renderO2(){ // NYX-INJECT
  o2Val.textContent = state.o2;
  hudO2.textContent = `O₂ ${state.o2}%`;
  o2Fill.style.transform = `scaleX(${state.o2/100})`;
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

function appendLog(kind, text){ // NYX-INJECT：右侧打印“观测/殖民地”反馈
  const p = document.createElement('p');
  p.className = 'logline ' + (kind==='obs'?'log-obs':'log-col');
  p.textContent = text;
  typoBox.appendChild(p);
  typoBox.scrollTop = typoBox.scrollHeight;
}

function renderChoices(list){
  choices.innerHTML='';
  list.forEach((c,i)=>{
    const b=document.createElement('button');
    b.className='btn';
    b.textContent = `${i+1}. ${c.label}`;
    b.onclick = ()=>{
      // NYX-INJECT 支持 cmd（打开弹窗模块）且不强制跳转节点
      if (c.cmd) runCmd(c.cmd);
      if (typeof c.san === 'number') setSAN(c.san || 0);
      if (typeof c.o2  === 'number') setO2(c.o2 || O2_STEP);
      if (c.next) goto(c.next, 0, c.stopAlarm===true);
    };
    b.onpointerdown = () => {
  playMouse();
};
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

function playMouse() {
  // 有 src（你之后填上路径）就播样本；否则用现有的 clickTick()
  if (mouseEl && mouseEl.getAttribute('src')) {
    try { mouseEl.currentTime = 0; mouseEl.play().catch(()=>{}); } catch {}
  } else {
    clickTick();
  }
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

// NYX-INJECT：不改变警报状态的“轻脉冲”红闪（用于 SAN 惩罚）
function redPulse(){
  sceneEl.classList.remove('enter-flicker'); void sceneEl.offsetWidth;
  sceneEl.classList.add('enter-flicker');
  setTimeout(()=>sceneEl.classList.remove('enter-flicker'), 300);
}

/* =================== 覆盖弹窗（观测/殖民地） =================== */
// 打开/关闭 + ESC
function openDock(src, title){
  if (!dockEl) return;
  dockTitle.textContent = title || '—';
  if (dockFrame.src.indexOf(src) === -1) dockFrame.src = src;
  dockEl.style.display = 'block';
}
function closeDock(){ if(dockEl) dockEl.style.display = 'none'; }
dockClose && dockClose.addEventListener('click', closeDock);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDock(); });

// 暴露给选择项的命令
function runCmd(cmd){
  if (cmd === 'openObservatory') openDock('globe.html','Observatory — Nocturne');
  if (cmd === 'openRelay')       openDock('relay.html','Relay Inbox — Colonies');
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


/* =================== 子页面消息桥接（观测/殖民地/调谐） =================== */
window.addEventListener('message', (ev)=>{
  const msg = ev.data || {};
  if (msg.type === 'intel' && msg.payload){
    const t = msg.payload;
    const lines = Array.isArray(t.fragment) ? t.fragment : [t.label||''];
    lines.forEach(s => s && appendLog('obs', s));
    setSAN(-2); // 观测消耗
    redPulse();
  }
  if (msg.type === 'colony_msg' && msg.payload){
    const p = msg.payload;
    const lines = Array.isArray(p.lines) ? p.lines : [p.text||''];
    lines.forEach(s => s && appendLog('col', s));
    setSAN(-1); // 收件箱读取代价（可按需调整）
  }
  if (msg.type === 'colony_tune' && msg.payload){
    const d = Number(msg.payload.delta)||0; // 命中 +1 / 失误 -2（来自 relay.html v3）
    setSAN(d);
    if (d < 0) redPulse();
  }
});

/* =================== 键盘快捷键 =================== */
document.addEventListener('keydown',(e)=>{
  const btns=[...document.querySelectorAll('.choices .btn')];
  if(e.key==='1'&&btns[0]) btns[0].click();
  if(e.key==='2'&&btns[1]) btns[1].click();
  if(e.key==='3'&&btns[2]) btns[2].click();
});

/* =================== 启动：加载 JSON =================== */
fetch('data/story.json')
  .then(r=>r.json())
  .then(data=>{
    state.data = data;
    renderSAN(); renderO2(); // NYX-INJECT
    goto(data.startNode || 'start', 0);
  })
  .catch(err=>{
    console.error('Failed to load data.json:', err);
    // 兜底节点
    state.data = { startNode:'start', nodes:{ start:{
      img:'img/placeholder.jpg', cap:'—', status:'—', alarm:false,
      text:['No data.json found.'], choices:[]
    }}};
    renderSAN(); renderO2(); // NYX-INJECT
    goto('start',0);
  });