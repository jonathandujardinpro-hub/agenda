import { useState, useEffect, useCallback, useRef } from "react";
import { loadData, saveData } from "./supabase.js";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:       "#FFFFFF",
  bg2:      "#F9F9F9",
  border:   "#F0F0F0",
  border2:  "#E5E5E5",
  text:     "#0A0A0A",
  sub:      "#888888",
  muted:    "#BBBBBB",
  accent:   "#007AFF",
};

// Routine: left accent bar style (subtle)
const RS = {
  reveil:   { bar:"#AEAEB2", bg:"#FAFAFA",  text:"#636366", label:"Réveil" },
  sport:    { bar:"#30D158", bg:"#F5FFF8",  text:"#1A7F37", label:"Sport" },
  profond:  { bar:"#007AFF", bg:"#F5F9FF",  text:"#0051A8", label:"Travail profond" },
  travail:  { bar:"#5AC8FA", bg:"#F5FBFF",  text:"#0078A0", label:"Travail" },
  dejeuner: { bar:"#FF9F0A", bg:"#FFFBF5",  text:"#B36200", label:"Déjeuner" },
  pause:    { bar:"#BF5AF2", bg:"#FAF5FF",  text:"#7B2FB5", label:"Pause" },
  autre:    { bar:"#8E8E93", bg:"#FAFAFA",  text:"#636366", label:"Autre" },
};

// Custom event: full vivid card
const CATS = [
  { id:"perso",   label:"Personnel",   color:"#FF2D55", dark:"#CC0033" },
  { id:"sport",   label:"Sport",       color:"#30D158", dark:"#1A7F37" },
  { id:"rdv",     label:"Rendez-vous", color:"#BF5AF2", dark:"#7B2FB5" },
  { id:"travail", label:"Travail",     color:"#007AFF", dark:"#0051A8" },
  { id:"urgence", label:"Urgence",     color:"#FF3B30", dark:"#CC0000" },
  { id:"autre",   label:"Autre",       color:"#8E8E93", dark:"#636366" },
];
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

const JOURS   = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const JOURS_C = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_C  = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

// Timeline: 07h → 23h, 30min slots
const SLOT_MIN = 7  * 60;
const SLOT_MAX = 23 * 60;
const STEP     = 30;
const SLOTS    = Array.from({ length: (SLOT_MAX - SLOT_MIN) / STEP }, (_,i) => SLOT_MIN + i * STEP);
const SLOT_H   = 56; // px per 30min — generous spacing
const LABEL_W  = 48; // px for hour labels

const p2      = n => String(n).padStart(2,"0");
const tm      = s => { const [h,m] = s.split(":").map(Number); return h*60+m; };
const mt      = m => `${p2(Math.floor(m/60))}:${p2(m%60)}`;
const toStr   = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const fromStr = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d=fromStr(s); d.setDate(d.getDate()+n); return toStr(d); };
const minToPx = min => ((min - SLOT_MIN) / STEP) * SLOT_H;
const durToPx = dur => (dur / STEP) * SLOT_H;

function todayDubai() {
  const n=new Date(), utc=n.getTime()+n.getTimezoneOffset()*60000;
  return toStr(new Date(utc+4*3600000));
}

function routineFor(ds) {
  const dow = fromStr(ds).getDay();
  if (dow>=1&&dow<=5) return [
    { id:`R:${ds}:rev`, cat:"reveil",   s:"08:30", e:"09:00", title:"Réveil" },
    { id:`R:${ds}:spo`, cat:"sport",    s:"09:00", e:"11:00", title:"Salle + trajets" },
    { id:`R:${ds}:pro`, cat:"profond",  s:"11:30", e:"13:30", title:"Travail profond" },
    { id:`R:${ds}:dej`, cat:"dejeuner", s:"13:30", e:"14:30", title:"Déjeuner" },
    { id:`R:${ds}:tra`, cat:"travail",  s:"14:30", e:"17:30", title:"Travail" },
    { id:`R:${ds}:pau`, cat:"pause",    s:"17:30", e:"18:00", title:"Pause" },
    { id:`R:${ds}:der`, cat:"profond",  s:"18:00", e:"19:00", title:"Dernières tâches" },
  ];
  if (dow===6) return [
    { id:`R:${ds}:rev`, cat:"reveil",   s:"09:00", e:"09:30", title:"Réveil" },
    { id:`R:${ds}:tra`, cat:"profond",  s:"09:30", e:"12:00", title:"Travail — Samedi" },
    { id:`R:${ds}:dej`, cat:"dejeuner", s:"12:00", e:"13:00", title:"Déjeuner" },
  ];
  return [
    { id:`R:${ds}:rev`, cat:"reveil",  s:"09:30", e:"10:00", title:"Réveil" },
    { id:`R:${ds}:org`, cat:"profond", s:"10:00", e:"12:00", title:"Organisation semaine" },
    { id:`R:${ds}:dej`, cat:"dejeuner",s:"12:00", e:"13:00", title:"Déjeuner" },
  ];
}

// Layout: compute non-overlapping columns for a set of events
function layout(events) {
  const sorted = [...events].sort((a,b)=>a.sMin-b.sMin);
  const cols = [], result = {};
  sorted.forEach(e => {
    let ci = cols.findIndex(col => {
      const last = sorted.find(x=>x.id===col[col.length-1]);
      return last.eMin <= e.sMin;
    });
    if (ci<0) ci=cols.length, cols.push([]);
    cols[ci].push(e.id);
    result[e.id] = { col:ci, total:0 };
  });
  const n = cols.length||1;
  Object.values(result).forEach(r=>r.total=n);
  return result;
}

const LS = k=>{try{return JSON.parse(localStorage.getItem(k));}catch{return null;}};
const SS = (k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const today = todayDubai();
  const [date,  setDate ] = useState(today);
  const [tab,   setTab  ] = useState("jour");
  const [evts,  setEvts ] = useState(()=>LS("ag8_e")||[]);
  const [tasks, setTasks] = useState(()=>LS("ag8_t")||[]);
  const [notes, setNotes] = useState(()=>LS("ag8_n")||[]);
  const [modal, setModal] = useState(null);
  const [sync,  setSync ] = useState("ok"); // "ok"|"saving"|"err"
  const [loaded,setLoaded]=useState(false);
  const saveT = useRef(null);
  const ref   = useRef({evts,tasks,notes});

  useEffect(()=>{
    loadData().then(d=>{
      if(d){
        if(d.evts) {setEvts(d.evts); SS("ag8_e",d.evts);}
        if(d.tasks){setTasks(d.tasks);SS("ag8_t",d.tasks);}
        if(d.notes){setNotes(d.notes);SS("ag8_n",d.notes);}
      }
      setLoaded(true);
    });
  },[]);

  useEffect(()=>{ref.current={evts,tasks,notes};},[evts,tasks,notes]);

  const save = useCallback(()=>{
    if(!loaded) return;
    clearTimeout(saveT.current);
    setSync("saving");
    saveT.current=setTimeout(async()=>{
      const {evts,tasks,notes}=ref.current;
      SS("ag8_e",evts);SS("ag8_t",tasks);SS("ag8_n",notes);
      const ok=await saveData({evts,tasks,notes});
      setSync(ok===false?"err":"ok");
    },700);
  },[loaded]);

  useEffect(()=>{if(loaded)save();},[evts,tasks,notes]);

  const customFor = ds => evts.filter(e=>e.ds===ds);
  const saveEvt   = e => { setEvts(p=>evts.find(x=>x.id===e.id)?p.map(x=>x.id===e.id?e:x):[...p,{...e,id:`C:${Date.now()}`}]); setModal(null); };
  const removeEvt = id => { setEvts(p=>p.filter(x=>x.id!==id)); setModal(null); };
  const todayTasks= tasks.filter(t=>!t.done&&(!t.due||t.due===today));

  if(!loaded) return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bg}}>
      <div style={{fontSize:48,marginBottom:20}}>📅</div>
      <div style={{fontSize:14,color:T.muted,fontWeight:500,letterSpacing:"0.05em"}}>CHARGEMENT</div>
    </div>
  );

  const syncColor = sync==="saving"?"#FF9F0A":sync==="err"?"#FF3B30":"#30D158";
  const syncIcon  = sync==="saving"?"↑":sync==="err"?"!":"✓";

  return (
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"-apple-system,'SF Pro Text','Helvetica Neue',sans-serif",color:T.text}}>
      {/* ── TOPBAR ── */}
      <header style={{
        position:"sticky",top:0,zIndex:100,
        background:"rgba(255,255,255,0.92)",
        backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
        borderBottom:`1px solid ${T.border}`,
        height:50,display:"flex",alignItems:"center",padding:"0 20px",gap:12,
      }}>
        <span style={{fontWeight:700,fontSize:17,letterSpacing:"-0.03em",flex:1}}>Mon agenda</span>
        <div style={{display:"flex",background:T.bg2,borderRadius:10,padding:"3px 3px",gap:1}}>
          {[["jour","Jour"],["semaine","Sem."],["taches","✅"],["notes","📝"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)} style={{
              background:tab===v?T.bg:"transparent",
              color:tab===v?T.text:T.sub,
              border:"none",borderRadius:8,padding:"5px 12px",
              fontWeight:600,fontSize:13,cursor:"pointer",
              boxShadow:tab===v?"0 1px 6px rgba(0,0,0,0.08)":"none",
            }}>{l}</button>
          ))}
        </div>
        <div style={{color:syncColor,fontWeight:700,fontSize:14,width:16,textAlign:"center"}}>{syncIcon}</div>
      </header>

      {tab==="jour"    && <DayView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onSlot={(ds,s)=>setModal({type:"add",ds,s})} onEdit={e=>setModal({type:"edit",evt:e})} todayTasks={todayTasks}/>}
      {tab==="semaine" && <WeekView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onDay={ds=>{setDate(ds);setTab("jour");}}/>}
      {tab==="taches"  && <TasksView tasks={tasks} setTasks={setTasks}/>}
      {tab==="notes"   && <NotesView notes={notes} setNotes={setNotes}/>}

      {/* ── FAB ── */}
      {(tab==="jour"||tab==="semaine")&&(
        <button onClick={()=>setModal({type:"add",ds:date,s:"20:00"})} style={{
          position:"fixed",bottom:34,right:22,width:54,height:54,borderRadius:"50%",
          background:T.text,color:"#fff",border:"none",fontSize:28,cursor:"pointer",
          zIndex:50,boxShadow:"0 6px 28px rgba(0,0,0,0.25)",
          display:"flex",alignItems:"center",justifyContent:"center",
        }}>+</button>
      )}

      {modal&&<Modal modal={modal} onClose={()=>setModal(null)} onSave={saveEvt} onDelete={removeEvt}/>}
    </div>
  );
}

// ── DAY VIEW ──────────────────────────────────────────────────────────────────
function DayView({date,setDate,today,routineFor,customFor,onSlot,onEdit,todayTasks}) {
  const d=fromStr(date), isToday=date===today;
  const routine=routineFor(date), custom=customFor(date);
  const totalH=SLOTS.length*SLOT_H;

  const customEx=custom.map(c=>({...c,sMin:tm(c.s),eMin:c.s===c.e?tm(c.s)+30:tm(c.e)}));
  const lay=customEx.length?layout(customEx):{};

  return (
    <div style={{maxWidth:640,margin:"0 auto",paddingBottom:120}}>

      {/* DATE HEADER */}
      <div style={{display:"flex",alignItems:"center",padding:"16px 20px 10px",gap:8}}>
        <button onClick={()=>setDate(addDays(date,-1))} style={navB()}>‹</button>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.14em",textTransform:"uppercase"}}>{JOURS[d.getDay()]}</div>
          <div style={{fontSize:34,fontWeight:700,letterSpacing:"-0.04em",lineHeight:1.1,marginTop:2,color:isToday?T.text:T.sub}}>
            {d.getDate()}
            <span style={{fontSize:19,fontWeight:400,color:T.muted,marginLeft:8,letterSpacing:"-0.01em"}}>{MOIS_C[d.getMonth()]} {d.getFullYear()}</span>
          </div>
          {isToday&&<div style={{width:4,height:4,borderRadius:"50%",background:T.accent,margin:"5px auto 0"}}/>}
        </div>
        <button onClick={()=>setDate(addDays(date,1))} style={navB()}>›</button>
      </div>

      {!isToday&&(
        <div style={{textAlign:"center",marginBottom:8}}>
          <button onClick={()=>setDate(today)} style={{background:"none",border:`1px solid ${T.border2}`,color:T.sub,borderRadius:20,padding:"4px 16px",fontSize:12,cursor:"pointer",fontWeight:500}}>Aujourd'hui</button>
        </div>
      )}

      {/* TASKS STRIP */}
      {isToday&&todayTasks.length>0&&(
        <div style={{margin:"0 20px 12px",borderRadius:16,border:`1px solid ${T.border}`,overflow:"hidden"}}>
          {todayTasks.map((t,i)=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderTop:i>0?`1px solid ${T.border}`:"none",background:T.bg}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:T.accent,flexShrink:0}}/>
              <span style={{fontSize:13,fontWeight:500,color:T.text}}>{t.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* TIMELINE */}
      <div style={{margin:"0 20px",borderRadius:20,border:`1px solid ${T.border}`,overflow:"hidden",background:T.bg}}>
        <div style={{position:"relative",height:totalH}}>

          {/* Hour lines */}
          {SLOTS.map((slotMin,i)=>{
            const isHour=slotMin%60===0;
            return (
              <div key={slotMin} style={{
                position:"absolute",left:0,right:0,top:i*SLOT_H,height:SLOT_H,
                borderTop:`1px solid ${isHour?T.border:"#F8F8F8"}`,
                pointerEvents:"none",zIndex:1,
              }}>
                <div style={{
                  position:"absolute",left:0,top:0,width:LABEL_W,
                  paddingTop:6,paddingLeft:10,
                  fontSize:isHour?11:9,
                  fontWeight:isHour?600:400,
                  color:isHour?T.sub:T.muted,
                  letterSpacing:"0.02em",
                  userSelect:"none",
                }}>
                  {isHour?`${p2(slotMin/60)}h`:`${p2(Math.floor(slotMin/60))}h${p2(slotMin%60)}`}
                </div>
              </div>
            );
          })}

          {/* ── ROUTINE: thin left-bar style ── */}
          {routine.map(r=>{
            const rS=tm(r.s),rE=tm(r.e);
            if(rS<SLOT_MIN||rS>=SLOT_MAX) return null;
            const top=minToPx(rS), height=durToPx(rE-rS);
            const st=RS[r.cat]||RS.autre;
            const short=height<SLOT_H*1.8;
            return (
              <div key={r.id}
                onClick={()=>onSlot(date,r.s)}
                style={{
                  position:"absolute",
                  left:LABEL_W+6, right:8,
                  top:top+2, height:height-4,
                  background:st.bg,
                  borderRadius:12,
                  borderLeft:`3px solid ${st.bar}`,
                  zIndex:5,cursor:"pointer",
                  overflow:"hidden",
                  boxSizing:"border-box",
                  display:"flex",
                  flexDirection:"column",
                  justifyContent:"center",
                  padding:short?"0 10px":"6px 12px",
                }}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontWeight:600,fontSize:short?12:14,color:st.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>
                  {!short&&<span style={{fontSize:11,color:st.bar,marginLeft:"auto",whiteSpace:"nowrap",flexShrink:0}}>{r.s} – {r.e}</span>}
                </div>
                {!short&&height>SLOT_H*2.5&&<div style={{fontSize:10,color:st.text,opacity:0.4,marginTop:4,letterSpacing:"0.04em"}}>Appuyer pour ajouter</div>}
              </div>
            );
          })}

          {/* ── CUSTOM EVENTS: vivid full cards, overlaid on top ── */}
          {customEx.map(c=>{
            if(c.sMin<SLOT_MIN||c.sMin>=SLOT_MAX) return null;
            const l=lay[c.id]||{col:0,total:1};
            const top=minToPx(c.sMin);
            const height=Math.max(durToPx(c.eMin-c.sMin)-4,SLOT_H*0.9);
            const cat=CAT[c.cat]||CAT.autre;
            const short=height<SLOT_H*1.6;

            // Position: stagger columns within right 50% of content zone
            const contentW=100; // relative
            const colW=50/l.total;
            const leftPct=50+l.col*colW;

            return (
              <div key={c.id} onClick={()=>onEdit(c)} style={{
                position:"absolute",
                left:`calc(${LABEL_W+6}px + ${leftPct}%)`,
                width:`calc(${colW}% - 6px)`,
                top:top+2, height:height,
                background:`linear-gradient(135deg, ${cat.color}, ${cat.dark})`,
                color:"#fff",
                borderRadius:12,
                padding:short?"5px 10px":"9px 12px",
                cursor:"pointer",
                zIndex:10,
                display:"flex",flexDirection:"column",justifyContent:"center",
                boxShadow:`0 4px 16px ${cat.color}55`,
                overflow:"hidden",
                boxSizing:"border-box",
              }}>
                <div style={{fontWeight:700,fontSize:short?12:14,lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</div>
                {!short&&<div style={{fontSize:11,opacity:0.85,marginTop:3}}>{c.s}{c.s!==c.e?` — ${c.e}`:""}</div>}
              </div>
            );
          })}

          {/* Clickable empty areas */}
          {SLOTS.map((slotMin,i)=>(
            <div key={`tap-${slotMin}`} onClick={()=>onSlot(date,mt(slotMin))} style={{position:"absolute",left:LABEL_W+6,right:8,top:i*SLOT_H,height:SLOT_H,zIndex:3,cursor:"pointer"}}/>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── WEEK VIEW ─────────────────────────────────────────────────────────────────
function WeekView({date,setDate,today,routineFor,customFor,onDay}) {
  const d0=fromStr(date),mon=new Date(d0);
  mon.setDate(d0.getDate()-((d0.getDay()+6)%7));
  const days=Array.from({length:7},(_,i)=>{const x=new Date(mon);x.setDate(mon.getDate()+i);return toStr(x);});
  return (
    <div style={{maxWidth:900,margin:"0 auto",padding:"0 16px 100px"}}>
      <div style={{display:"flex",alignItems:"center",padding:"14px 0 14px"}}>
        <button onClick={()=>setDate(addDays(date,-7))} style={navB()}>‹</button>
        <div style={{flex:1,textAlign:"center",fontWeight:600,fontSize:15,color:T.sub,letterSpacing:"-0.01em"}}>
          {fromStr(days[0]).getDate()} {MOIS_C[fromStr(days[0]).getMonth()]} — {fromStr(days[6]).getDate()} {MOIS_C[fromStr(days[6]).getMonth()]} {fromStr(days[6]).getFullYear()}
        </div>
        <button onClick={()=>setDate(addDays(date,7))} style={navB()}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:7}}>
        {days.map(ds=>{
          const dd=fromStr(ds),isTod=ds===today;
          const r=routineFor(ds),c=customFor(ds);
          return (
            <div key={ds} onClick={()=>onDay(ds)} style={{
              background:isTod?"#EBF3FF":T.bg,
              border:`1px solid ${isTod?"#BDD9FF":T.border}`,
              borderRadius:16,padding:"10px 8px",cursor:"pointer",minHeight:120,
              boxShadow:"0 1px 4px rgba(0,0,0,0.03)",
            }}>
              <div style={{textAlign:"center",marginBottom:8}}>
                <div style={{fontSize:9,fontWeight:700,color:T.muted,letterSpacing:"0.1em"}}>{JOURS_C[dd.getDay()]}</div>
                <div style={{fontSize:20,fontWeight:700,lineHeight:1.2,color:isTod?T.accent:T.text}}>{dd.getDate()}</div>
              </div>
              {r.map(ev=>{const st=RS[ev.cat]||RS.autre;return(
                <div key={ev.id} style={{borderLeft:`2.5px solid ${st.bar}`,background:st.bg,borderRadius:5,padding:"2px 6px",marginBottom:3,fontSize:9,fontWeight:600,color:st.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {ev.s.slice(0,5)} {ev.title}
                </div>
              );})}
              {c.map(ev=>{const cat=CAT[ev.cat]||CAT.autre;return(
                <div key={ev.id} style={{background:cat.color,borderRadius:5,padding:"2px 6px",marginBottom:3,fontSize:9,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {ev.s.slice(0,5)} {ev.title}
                </div>
              );})}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function Modal({modal,onClose,onSave,onDelete}) {
  const isEdit=modal.type==="edit";
  const def=isEdit?modal.evt:{ds:modal.ds,s:modal.s||"20:00",e:mt(Math.min(tm(modal.s||"20:00")+60,SLOT_MAX)),title:"",cat:"perso",note:""};
  const [f,sf]=useState({...def});
  const set=(k,v)=>sf(p=>({...p,[k]:v}));
  const cat=CAT[f.cat]||CAT.autre;
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:200,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:T.bg,borderRadius:"28px 28px 0 0",
        width:"100%",maxWidth:620,
        padding:"0 0 48px",
        maxHeight:"94vh",overflowY:"auto",
        boxShadow:"0 -12px 60px rgba(0,0,0,0.2)",
      }}>
        {/* Colored header based on selected category */}
        <div style={{
          background:`linear-gradient(135deg,${cat.color},${cat.dark})`,
          borderRadius:"28px 28px 0 0",
          padding:"20px 24px 24px",
          marginBottom:0,
        }}>
          <div style={{width:36,height:4,background:"rgba(255,255,255,0.4)",borderRadius:2,margin:"0 auto 18px"}}/>
          <div style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.7)",letterSpacing:"0.06em",marginBottom:6}}>{isEdit?"MODIFIER":"NOUVEL ÉVÉNEMENT"}</div>
          <input
            value={f.title}
            onChange={e=>set("title",e.target.value)}
            placeholder="Titre de l'événement"
            style={{
              width:"100%",background:"transparent",border:"none",
              fontSize:24,fontWeight:700,color:"#fff",outline:"none",
              fontFamily:"inherit",caretColor:"#fff",
              "::placeholder":{color:"rgba(255,255,255,0.5)"},
            }}
          />
        </div>

        <div style={{padding:"20px 24px 0"}}>
          {/* Date & Time */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
            <div>
              <div style={lbl()}>Date</div>
              <input style={ipt()} type="date" value={f.ds} onChange={e=>set("ds",e.target.value)}/>
            </div>
            <div>
              <div style={lbl()}>Début</div>
              <input style={ipt()} type="time" value={f.s} onChange={e=>set("s",e.target.value)}/>
            </div>
            <div>
              <div style={lbl()}>Fin</div>
              <input style={ipt()} type="time" value={f.e} onChange={e=>set("e",e.target.value)}/>
            </div>
          </div>

          {/* Categories */}
          <div style={lbl()}>Catégorie</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:16}}>
            {CATS.map(c=>(
              <button key={c.id} onClick={()=>set("cat",c.id)} style={{
                background:f.cat===c.id?c.color:"transparent",
                color:f.cat===c.id?"#fff":T.sub,
                border:`1.5px solid ${f.cat===c.id?c.color:T.border2}`,
                borderRadius:20,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer",
                transition:"all 0.12s",
              }}>{c.label}</button>
            ))}
          </div>

          {/* Note */}
          <div style={lbl()}>Note (optionnel)</div>
          <textarea
            style={{...ipt(),height:80,resize:"vertical",marginBottom:20}}
            placeholder="Ajouter une note..."
            value={f.note||""}
            onChange={e=>set("note",e.target.value)}
          />

          {/* Actions */}
          <div style={{display:"flex",gap:10}}>
            {isEdit&&<button onClick={()=>onDelete(f.id)} style={{flex:1,background:"#FFF0F0",color:"#FF3B30",border:"1.5px solid #FFD0CE",borderRadius:16,padding:15,fontWeight:700,cursor:"pointer",fontSize:15}}>Supprimer</button>}
            <button onClick={()=>onSave(f)} style={{flex:2,background:`linear-gradient(135deg,${cat.color},${cat.dark})`,color:"#fff",border:"none",borderRadius:16,padding:15,fontWeight:700,cursor:"pointer",fontSize:16,boxShadow:`0 4px 16px ${cat.color}55`}}>
              {isEdit?"Enregistrer":"Ajouter"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const lbl = ()=>({fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:7,display:"block"});
const ipt = ()=>({width:"100%",boxSizing:"border-box",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:12,padding:"11px 14px",fontSize:15,color:T.text,outline:"none",fontFamily:"inherit",display:"block"});
const navB= ()=>({background:"none",border:"none",color:T.sub,width:40,height:40,fontSize:26,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:10,flexShrink:0});

// ── TASKS ─────────────────────────────────────────────────────────────────────
function TasksView({tasks,setTasks}) {
  const [form,sf]=useState({title:"",priority:"normale",due:""});
  const [open,setOpen]=useState(false);
  const todo=tasks.filter(t=>!t.done), done=tasks.filter(t=>t.done);
  const add=()=>{if(!form.title.trim())return;setTasks(p=>[...p,{...form,id:`T:${Date.now()}`,done:false}]);sf({title:"",priority:"normale",due:""});setOpen(false);};
  return (
    <div style={{maxWidth:580,margin:"0 auto",padding:"16px 20px 100px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:24,letterSpacing:"-0.03em"}}>Tâches</div>
        <button onClick={()=>setOpen(!open)} style={{background:T.text,color:"#fff",border:"none",borderRadius:14,padding:"9px 20px",fontWeight:700,cursor:"pointer",fontSize:14}}>{open?"Annuler":"+ Nouvelle"}</button>
      </div>
      {open&&(
        <div style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:18,padding:18,marginBottom:16,boxShadow:"0 4px 20px rgba(0,0,0,0.06)"}}>
          <input style={{...ipt(),marginBottom:10,fontSize:16}} placeholder="Titre de la tâche" value={form.title} onChange={e=>sf(p=>({...p,title:e.target.value}))}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <select style={ipt()} value={form.priority} onChange={e=>sf(p=>({...p,priority:e.target.value}))}>
              <option value="basse">Priorité basse</option>
              <option value="normale">Priorité normale</option>
              <option value="haute">Priorité haute !</option>
            </select>
            <input style={ipt()} type="date" value={form.due} onChange={e=>sf(p=>({...p,due:e.target.value}))}/>
          </div>
          <button onClick={add} style={{width:"100%",background:T.text,color:"#fff",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer",fontSize:15}}>Ajouter</button>
        </div>
      )}
      {todo.length===0&&!open&&<div style={{textAlign:"center",color:T.muted,padding:"80px 0",fontSize:15}}>Aucune tâche pour l'instant</div>}
      {todo.map(t=><TR key={t.id} task={t} onToggle={id=>setTasks(p=>p.map(x=>x.id===id?{...x,done:true}:x))} onDelete={id=>setTasks(p=>p.filter(x=>x.id!==id))}/>)}
      {done.length>0&&(<>
        <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.1em",margin:"24px 0 10px"}}>TERMINÉES ({done.length})</div>
        {done.map(t=><TR key={t.id} task={t} done onToggle={id=>setTasks(p=>p.map(x=>x.id===id?{...x,done:false}:x))} onDelete={id=>setTasks(p=>p.filter(x=>x.id!==id))}/>)}
      </>)}
    </div>
  );
}
function TR({task,done,onToggle,onDelete}) {
  const pc=task.priority==="haute"?"#FF3B30":task.priority==="basse"?"#AEAEB2":"#FF9F0A";
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,background:T.bg,border:`1px solid ${T.border}`,borderRadius:16,padding:"14px 16px",marginBottom:8,opacity:done?0.45:1,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
      <button onClick={()=>onToggle(task.id)} style={{width:26,height:26,borderRadius:"50%",flexShrink:0,border:`2px solid ${done?"#30D158":T.border2}`,background:done?"#30D158":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
        {done&&<span style={{color:"#fff",fontSize:13,fontWeight:700}}>✓</span>}
      </button>
      <div style={{flex:1}}>
        <div style={{fontWeight:600,fontSize:14,textDecoration:done?"line-through":"none",color:T.text}}>{task.title}</div>
        {task.due&&<div style={{fontSize:12,color:T.muted,marginTop:2}}>Échéance : {task.due}</div>}
      </div>
      <div style={{fontSize:11,fontWeight:700,color:pc,textTransform:"uppercase",letterSpacing:"0.04em"}}>{task.priority}</div>
      <button onClick={()=>onDelete(task.id)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:22,lineHeight:1,padding:"0 2px",marginLeft:2}}>×</button>
    </div>
  );
}

// ── NOTES ─────────────────────────────────────────────────────────────────────
function NotesView({notes,setNotes}) {
  const [ed,setEd]=useState(null);
  const save=()=>{if(!ed.title.trim())return;if(ed.id)setNotes(p=>p.map(n=>n.id===ed.id?{...ed}:n));else setNotes(p=>[{...ed,id:`N:${Date.now()}`,date:todayDubai()},...p]);setEd(null);};
  if(ed) return (
    <div style={{maxWidth:580,margin:"0 auto",padding:"16px 20px"}}>
      <button onClick={()=>setEd(null)} style={{background:"none",border:"none",color:T.accent,fontSize:15,cursor:"pointer",marginBottom:16,fontWeight:500}}>← Retour</button>
      <input style={{...ipt(),fontSize:20,fontWeight:700,marginBottom:12,letterSpacing:"-0.02em"}} placeholder="Titre" value={ed.title} onChange={e=>setEd(p=>({...p,title:e.target.value}))}/>
      <textarea style={{...ipt(),height:320,resize:"vertical",fontSize:15,lineHeight:1.7}} placeholder="Écrivez ici…" value={ed.body||""} onChange={e=>setEd(p=>({...p,body:e.target.value}))}/>
      <div style={{display:"flex",gap:10,marginTop:14}}>
        {ed.id&&<button onClick={()=>{setNotes(p=>p.filter(n=>n.id!==ed.id));setEd(null);}} style={{flex:1,background:"#FFF0F0",color:"#FF3B30",border:"1.5px solid #FFD0CE",borderRadius:16,padding:14,fontWeight:700,cursor:"pointer"}}>Supprimer</button>}
        <button onClick={save} style={{flex:2,background:T.text,color:"#fff",border:"none",borderRadius:16,padding:14,fontWeight:700,cursor:"pointer",fontSize:15}}>Enregistrer</button>
      </div>
    </div>
  );
  return (
    <div style={{maxWidth:580,margin:"0 auto",padding:"16px 20px 100px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:24,letterSpacing:"-0.03em"}}>Notes</div>
        <button onClick={()=>setEd({title:"",body:""})} style={{background:T.text,color:"#fff",border:"none",borderRadius:14,padding:"9px 20px",fontWeight:700,cursor:"pointer",fontSize:14}}>+ Nouvelle</button>
      </div>
      {notes.length===0&&<div style={{textAlign:"center",color:T.muted,padding:"80px 0",fontSize:15}}>Aucune note pour l'instant</div>}
      {notes.map(n=>(
        <div key={n.id} onClick={()=>setEd({...n})} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:18,padding:18,marginBottom:10,cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
          <div style={{fontWeight:700,fontSize:16,marginBottom:6,letterSpacing:"-0.01em"}}>{n.title}</div>
          {n.body&&<div style={{fontSize:13,color:T.sub,lineHeight:1.6,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{n.body}</div>}
          <div style={{fontSize:11,color:T.muted,marginTop:10,letterSpacing:"0.02em"}}>{n.date}</div>
        </div>
      ))}
    </div>
  );
}
