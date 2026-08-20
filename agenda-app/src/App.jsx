import { useState, useEffect, useCallback, useRef } from "react";
import { loadData, saveData } from "./supabase.js";

const BG      = "#F8F7F4";
const SURFACE = "#FFFFFF";
const BORDER  = "#EBEBEB";
const MUTED   = "#ADADAD";
const TEXT    = "#1C1C1E";
const SUB     = "#6E6E73";

const RS = {
  reveil:   { bg:"#F2F2F7", border:"#C7C7CC", text:"#636366" },
  sport:    { bg:"#F0FDF4", border:"#BBF7D0", text:"#15803D" },
  profond:  { bg:"#EFF6FF", border:"#BFDBFE", text:"#1D4ED8" },
  travail:  { bg:"#F0F9FF", border:"#BAE6FD", text:"#0369A1" },
  dejeuner: { bg:"#FFFBEB", border:"#FDE68A", text:"#B45309" },
  pause:    { bg:"#FAF5FF", border:"#E9D5FF", text:"#7E22CE" },
  autre:    { bg:"#F8FAFC", border:"#CBD5E1", text:"#475569" },
};

const CATS = [
  { id:"perso",   label:"Personnel",   color:"#E91E8C" },
  { id:"sport",   label:"Sport",       color:"#16A34A" },
  { id:"rdv",     label:"Rendez-vous", color:"#7C3AED" },
  { id:"travail", label:"Travail",     color:"#2563EB" },
  { id:"urgence", label:"Urgence",     color:"#DC2626" },
  { id:"autre",   label:"Autre",       color:"#6B7280" },
];
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

const JOURS   = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const JOURS_C = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_C  = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

const SLOT_MIN = 7  * 60;
const SLOT_MAX = 23 * 60;
const STEP     = 30;
const SLOTS    = Array.from({ length: (SLOT_MAX - SLOT_MIN) / STEP }, (_, i) => SLOT_MIN + i * STEP);
const SLOT_H   = 52;
const LABEL_W  = 52;

const p2      = n => String(n).padStart(2, "0");
const tm      = s => { const [h,m] = s.split(":").map(Number); return h*60+m; };
const mt      = m => `${p2(Math.floor(m/60))}:${p2(m%60)}`;
const toStr   = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const fromStr = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d=fromStr(s); d.setDate(d.getDate()+n); return toStr(d); };
const minToPx = min => ((min - SLOT_MIN) / STEP) * SLOT_H;
const durToPx = dur => (dur / STEP) * SLOT_H;

function todayDubai() {
  const n = new Date(), utc = n.getTime() + n.getTimezoneOffset()*60000;
  return toStr(new Date(utc + 4*3600000));
}

function routineFor(ds) {
  const dow = fromStr(ds).getDay();
  if (dow >= 1 && dow <= 5) return [
    { id:`R:${ds}:rev`, title:"Réveil",                     cat:"reveil",   s:"08:30", e:"09:00" },
    { id:`R:${ds}:spo`, title:"Salle + trajets",             cat:"sport",    s:"09:00", e:"11:00" },
    { id:`R:${ds}:pro`, title:"Travail profond",              cat:"profond",  s:"11:30", e:"13:30" },
    { id:`R:${ds}:dej`, title:"Déjeuner",                    cat:"dejeuner", s:"13:30", e:"14:30" },
    { id:`R:${ds}:tra`, title:"Travail",                     cat:"travail",  s:"14:30", e:"17:30" },
    { id:`R:${ds}:pau`, title:"Pause",                       cat:"pause",    s:"17:30", e:"18:00" },
    { id:`R:${ds}:der`, title:"Dernières tâches importantes", cat:"profond",  s:"18:00", e:"19:00" },
  ];
  if (dow === 6) return [
    { id:`R:${ds}:rev`, title:"Réveil",           cat:"reveil",   s:"09:00", e:"09:30" },
    { id:`R:${ds}:tra`, title:"Travail — Samedi",  cat:"profond",  s:"09:30", e:"12:00" },
    { id:`R:${ds}:dej`, title:"Déjeuner",          cat:"dejeuner", s:"12:00", e:"13:00" },
  ];
  return [
    { id:`R:${ds}:rev`, title:"Réveil",                     cat:"reveil",  s:"09:30", e:"10:00" },
    { id:`R:${ds}:org`, title:"Organisation de la semaine",  cat:"profond", s:"10:00", e:"12:00" },
    { id:`R:${ds}:dej`, title:"Déjeuner",                   cat:"dejeuner",s:"12:00", e:"13:00" },
  ];
}

// Column layout for overlapping custom events in right zone
function layoutEvents(events) {
  const sorted = [...events].sort((a,b) => a.sMin - b.sMin);
  const cols = [];
  const result = {};
  sorted.forEach(evt => {
    let placed = false;
    for (let ci = 0; ci < cols.length; ci++) {
      const last = sorted.find(e => e.id === cols[ci][cols[ci].length-1]);
      if (last.eMin <= evt.sMin) {
        cols[ci].push(evt.id);
        result[evt.id] = ci;
        placed = true;
        break;
      }
    }
    if (!placed) { result[evt.id] = cols.length; cols.push([evt.id]); }
  });
  return { colMap: result, numCols: cols.length || 1 };
}

const LS  = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const SS  = (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} };

export default function App() {
  const today = todayDubai();
  const [date,    setDate  ] = useState(today);
  const [tab,     setTab   ] = useState("jour");
  const [evts,    setEvts  ] = useState(() => LS("ag7_evts") || []);
  const [tasks,   setTasks ] = useState(() => LS("ag7_tsk")  || []);
  const [notes,   setNotes ] = useState(() => LS("ag7_nts")  || []);
  const [modal,   setModal ] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loaded,  setLoaded ] = useState(false);
  const [syncOk,  setSyncOk ] = useState(true);
  const saveTimer = useRef(null);
  const latest = useRef({ evts, tasks, notes });

  useEffect(() => {
    loadData().then(d => {
      if (d) {
        if (d.evts)  { setEvts(d.evts);   SS("ag7_evts", d.evts); }
        if (d.tasks) { setTasks(d.tasks);  SS("ag7_tsk",  d.tasks); }
        if (d.notes) { setNotes(d.notes);  SS("ag7_nts",  d.notes); }
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => { latest.current = { evts, tasks, notes }; }, [evts, tasks, notes]);

  const triggerSave = useCallback(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    setSyncing(true);
    saveTimer.current = setTimeout(async () => {
      const { evts, tasks, notes } = latest.current;
      SS("ag7_evts", evts); SS("ag7_tsk", tasks); SS("ag7_nts", notes);
      const res = await saveData({ evts, tasks, notes });
      setSyncing(false); setSyncOk(res !== false);
    }, 800);
  }, [loaded]);

  useEffect(() => { if (loaded) triggerSave(); }, [evts, tasks, notes]);

  const customFor = ds => evts.filter(e => e.ds === ds);

  function saveEvt(e) {
    setEvts(p => evts.find(x => x.id===e.id) ? p.map(x => x.id===e.id?e:x) : [...p,{...e,id:`C:${Date.now()}`}]);
    setModal(null);
  }
  function removeEvt(id) { setEvts(p => p.filter(x => x.id!==id)); setModal(null); }

  const todayTasks = tasks.filter(t => !t.done && (!t.due || t.due===today));

  if (!loaded) return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:BG,fontFamily:"-apple-system,sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:44,marginBottom:16}}>📅</div>
        <div style={{fontSize:15,color:MUTED,fontWeight:600,letterSpacing:"0.02em"}}>Chargement…</div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:BG,fontFamily:"'SF Pro Text',-apple-system,'Helvetica Neue',sans-serif",color:TEXT}}>
      {/* TOPBAR */}
      <header style={{position:"sticky",top:0,zIndex:50,background:"rgba(248,247,244,0.95)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${BORDER}`,height:52,display:"flex",alignItems:"center",padding:"0 16px",gap:10}}>
        <span style={{fontWeight:700,fontSize:17,letterSpacing:"-0.02em",flex:1}}>Mon agenda</span>
        <div style={{display:"flex",background:"#EEECEA",borderRadius:10,padding:"3px"}}>
          {[["jour","Jour"],["semaine","Sem."],["taches","✅"],["notes","📝"]].map(([v,l]) => (
            <button key={v} onClick={()=>setTab(v)} style={{
              background:tab===v?SURFACE:"transparent",
              color:tab===v?TEXT:MUTED,
              border:"none",borderRadius:8,padding:"5px 11px",
              fontWeight:600,fontSize:13,cursor:"pointer",
              boxShadow:tab===v?"0 1px 4px rgba(0,0,0,0.10)":"none",
              transition:"all 0.12s",
            }}>{l}</button>
          ))}
        </div>
        <div style={{fontSize:12,color:syncing?"#FF9500":syncOk?"#34C759":"#FF3B30",fontWeight:700,width:18,textAlign:"center"}}>
          {syncing?"↑":syncOk?"✓":"!"}
        </div>
      </header>

      {tab==="jour"    && <DayView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onAddAt={(ds,s)=>setModal({type:"add",ds,s})} onEditCustom={e=>setModal({type:"edit",evt:e})} todayTasks={todayTasks}/>}
      {tab==="semaine" && <WeekView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onDay={ds=>{setDate(ds);setTab("jour");}}/>}
      {tab==="taches"  && <TasksView tasks={tasks} setTasks={setTasks}/>}
      {tab==="notes"   && <NotesView notes={notes} setNotes={setNotes}/>}

      {(tab==="jour"||tab==="semaine") && (
        <button onClick={()=>setModal({type:"add",ds:date,s:"20:00"})} style={{
          position:"fixed",bottom:32,right:24,width:56,height:56,
          borderRadius:"50%",background:TEXT,color:"#fff",border:"none",
          fontSize:26,cursor:"pointer",zIndex:40,
          boxShadow:"0 4px 24px rgba(0,0,0,0.22)",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontWeight:300,
        }}>+</button>
      )}

      {modal && <EventModal modal={modal} onClose={()=>setModal(null)} onSave={saveEvt} onDelete={removeEvt}/>}
    </div>
  );
}

// ── DAY VIEW ──────────────────────────────────────────────────────────────────
function DayView({date,setDate,today,routineFor,customFor,onAddAt,onEditCustom,todayTasks}) {
  const d = fromStr(date), isToday = date===today;
  const routine = routineFor(date);
  const custom  = customFor(date);
  const totalH  = SLOTS.length * SLOT_H;

  // Prepare custom events with minute values
  const customEx = custom.map(c => ({
    ...c,
    sMin: tm(c.s),
    eMin: c.s===c.e ? tm(c.s)+30 : tm(c.e),
  }));

  // Layout for right column
  const { colMap, numCols } = customEx.length ? layoutEvents(customEx) : { colMap:{}, numCols:1 };

  // Does the day have any custom events? If yes, split layout
  const hasCustom = customEx.length > 0;

  // Widths: label=LABEL_W, routine zone, gap, custom zone
  // Routine: 58% of remaining, Custom: 40%
  const ROUTINE_PCT = hasCustom ? 58 : 98; // % of content after label
  const CUSTOM_PCT  = 40;
  const ZONE_GAP    = 2; // px

  return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"0 0 120px"}}>
      {/* DATE NAV */}
      <div style={{display:"flex",alignItems:"center",padding:"14px 16px 8px"}}>
        <button onClick={()=>setDate(addDays(date,-1))} style={navBtn()}>‹</button>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:700,color:MUTED,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:2}}>{JOURS[d.getDay()]}</div>
          <div style={{fontSize:30,fontWeight:700,letterSpacing:"-0.04em",lineHeight:1,color:isToday?TEXT:SUB}}>
            {d.getDate()}
            <span style={{fontSize:18,fontWeight:400,color:MUTED,marginLeft:6}}>{MOIS_C[d.getMonth()]} {d.getFullYear()}</span>
          </div>
          {isToday && <div style={{width:5,height:5,borderRadius:"50%",background:"#007AFF",margin:"4px auto 0"}}/>}
        </div>
        <button onClick={()=>setDate(addDays(date,1))} style={navBtn()}>›</button>
      </div>

      {!isToday && (
        <div style={{textAlign:"center",marginBottom:6}}>
          <button onClick={()=>setDate(today)} style={{background:"none",border:`1px solid ${BORDER}`,color:SUB,borderRadius:20,padding:"4px 16px",fontSize:12,cursor:"pointer",fontWeight:600}}>Aujourd'hui</button>
        </div>
      )}

      {/* TASKS STRIP */}
      {isToday && todayTasks.length>0 && (
        <div style={{margin:"0 16px 10px",background:SURFACE,borderRadius:14,padding:"11px 16px",border:`1px solid ${BORDER}`,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div style={{fontSize:10,fontWeight:700,color:MUTED,letterSpacing:"0.1em",marginBottom:7}}>TÂCHES DU JOUR</div>
          {todayTasks.map(t=><div key={t.id} style={{fontSize:13,color:TEXT,paddingBottom:3,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:MUTED,flexShrink:0}}/>
            {t.title}
          </div>)}
        </div>
      )}

      {/* COLUMN HEADERS when custom events exist */}
      {hasCustom && (
        <div style={{display:"flex",padding:"0 16px",marginBottom:4}}>
          <div style={{width:LABEL_W,flexShrink:0}}/>
          <div style={{flex:`0 0 ${ROUTINE_PCT}%`,paddingLeft:4}}>
            <span style={{fontSize:9,fontWeight:700,color:MUTED,letterSpacing:"0.1em",textTransform:"uppercase"}}>ROUTINE</span>
          </div>
          <div style={{width:ZONE_GAP}}/>
          <div style={{flex:`0 0 ${CUSTOM_PCT}%`,paddingLeft:4}}>
            <span style={{fontSize:9,fontWeight:700,color:MUTED,letterSpacing:"0.1em",textTransform:"uppercase"}}>PERSO</span>
          </div>
        </div>
      )}

      {/* TIMELINE */}
      <div style={{margin:"0 16px",background:SURFACE,borderRadius:18,border:`1px solid ${BORDER}`,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,0.04)"}}>
        <div style={{position:"relative",height:totalH}}>

          {/* Grid lines */}
          {SLOTS.map((slotMin,i) => {
            const isHour = slotMin%60===0;
            return (
              <div key={slotMin} style={{position:"absolute",left:0,right:0,top:i*SLOT_H,height:SLOT_H,borderTop:`1px solid ${isHour?"#E8E8E8":"#F5F5F5"}`,pointerEvents:"none",zIndex:1}}>
                <div style={{width:LABEL_W,paddingTop:5,paddingLeft:10,fontSize:isHour?11:9,fontWeight:isHour?600:400,color:isHour?SUB:MUTED,userSelect:"none",lineHeight:1}}>
                  {isHour?`${p2(slotMin/60)}h`:`${p2(Math.floor(slotMin/60))}h${p2(slotMin%60)}`}
                </div>
              </div>
            );
          })}

          {/* Vertical divider when custom events exist */}
          {hasCustom && (
            <div style={{position:"absolute",top:0,bottom:0,left:`calc(${LABEL_W}px + ${ROUTINE_PCT}% + ${ZONE_GAP}px)`,width:1,background:"#F0F0F0",zIndex:2}}/>
          )}

          {/* ROUTINE BLOCKS */}
          {routine.map(r => {
            const rS=tm(r.s), rE=tm(r.e);
            if(rS<SLOT_MIN||rS>=SLOT_MAX) return null;
            const top    = minToPx(rS);
            const height = durToPx(rE-rS);
            const st     = RS[r.cat]||RS.autre;
            const short  = height < SLOT_H*1.5;
            return (
              <div key={r.id}
                onClick={()=>onAddAt(date,r.s)}
                style={{
                  position:"absolute",
                  left: LABEL_W+4,
                  right: hasCustom ? `${CUSTOM_PCT+ZONE_GAP+1}%` : 8,
                  top: top+2, height: height-4,
                  background: st.bg,
                  border: `1.5px solid ${st.border}`,
                  borderRadius: 11,
                  zIndex: 5,
                  overflow: "hidden",
                  cursor: "pointer",
                  boxSizing: "border-box",
                  transition: "opacity 0.1s",
                }}>
                <div style={{padding:short?"5px 10px":"8px 12px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:st.border,flexShrink:0}}/>
                    <span style={{fontWeight:700,fontSize:short?11:13,color:st.text,lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>
                  </div>
                  {!short && <div style={{fontSize:10,color:st.text,opacity:0.5,marginTop:3}}>{r.s} – {r.e}</div>}
                </div>
                {!short && <div style={{position:"absolute",bottom:6,left:12,fontSize:9,color:st.text,opacity:0.35,letterSpacing:"0.05em"}}>+ AJOUTER</div>}
              </div>
            );
          })}

          {/* CUSTOM EVENTS — always right column */}
          {customEx.map(c => {
            if(c.sMin<SLOT_MIN||c.sMin>=SLOT_MAX) return null;
            const col     = colMap[c.id]??0;
            const top     = minToPx(c.sMin);
            const height  = Math.max(durToPx(c.eMin-c.sMin)-4, SLOT_H*0.85);
            const cat     = CAT[c.cat]||CAT.autre;
            const short   = height < SLOT_H*1.4;

            // Position within right zone
            const zoneW   = CUSTOM_PCT / numCols;
            const fromRight = (numCols - col - 1) * zoneW;

            return (
              <div key={c.id}
                onClick={()=>onEditCustom(c)}
                style={{
                  position:"absolute",
                  right: `${fromRight + 0.5}%`,
                  width: `${zoneW - 0.5}%`,
                  top: top+2, height: height,
                  background: cat.color,
                  borderRadius: 10,
                  padding: short?"5px 8px":"8px 10px",
                  cursor:"pointer",
                  zIndex: 8,
                  display:"flex",
                  flexDirection:"column",
                  justifyContent:"center",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
                  overflow:"hidden",
                  boxSizing:"border-box",
                  color:"#fff",
                }}>
                <div style={{fontWeight:700,fontSize:short?11:13,lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</div>
                {!short && <div style={{fontSize:10,opacity:0.82,marginTop:2}}>{c.s}{c.s!==c.e?` → ${c.e}`:""}</div>}
              </div>
            );
          })}

          {/* Clickable empty slots */}
          {SLOTS.map((slotMin,i) => {
            const inRoutine = routine.some(r=>slotMin>=tm(r.s)&&slotMin<tm(r.e));
            if(inRoutine) return null;
            return <div key={`e-${slotMin}`} onClick={()=>onAddAt(date,mt(slotMin))} style={{position:"absolute",left:LABEL_W+4,right:hasCustom?`${CUSTOM_PCT+ZONE_GAP+1}%`:8,top:i*SLOT_H,height:SLOT_H,cursor:"pointer",zIndex:4}}/>;
          })}
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
    <div style={{maxWidth:900,margin:"0 auto",padding:"0 12px 120px"}}>
      <div style={{display:"flex",alignItems:"center",padding:"14px 4px 12px"}}>
        <button onClick={()=>setDate(addDays(date,-7))} style={navBtn()}>‹</button>
        <div style={{flex:1,textAlign:"center",fontWeight:600,fontSize:14,color:SUB}}>
          {fromStr(days[0]).getDate()} {MOIS_C[fromStr(days[0]).getMonth()]} — {fromStr(days[6]).getDate()} {MOIS_C[fromStr(days[6]).getMonth()]} {fromStr(days[6]).getFullYear()}
        </div>
        <button onClick={()=>setDate(addDays(date,7))} style={navBtn()}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
        {days.map(ds=>{
          const dd=fromStr(ds),isTod=ds===today;
          const routine=routineFor(ds),custom=customFor(ds);
          return (
            <div key={ds} onClick={()=>onDay(ds)} style={{background:isTod?"#EEF4FF":SURFACE,border:`1px solid ${isTod?"#BFD4FF":BORDER}`,borderRadius:14,padding:"10px 7px",cursor:"pointer",minHeight:130,boxShadow:"0 1px 3px rgba(0,0,0,0.03)"}}>
              <div style={{textAlign:"center",marginBottom:8}}>
                <div style={{fontSize:9,fontWeight:700,color:MUTED,letterSpacing:"0.1em"}}>{JOURS_C[dd.getDay()]}</div>
                <div style={{fontSize:20,fontWeight:700,color:isTod?"#007AFF":TEXT,lineHeight:1.2}}>{dd.getDate()}</div>
              </div>
              {routine.map(r=>{const st=RS[r.cat]||RS.autre;return <div key={r.id} style={{background:st.bg,borderLeft:`2px solid ${st.border}`,borderRadius:4,padding:"2px 5px",marginBottom:3,fontSize:9,fontWeight:600,color:st.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.s.slice(0,5)} {r.title}</div>;})}
              {custom.map(c=>{const cat=CAT[c.cat]||CAT.autre;return <div key={c.id} style={{background:cat.color,borderRadius:4,padding:"2px 5px",marginBottom:3,fontSize:9,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.s.slice(0,5)} {c.title}</div>;})}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── EVENT MODAL ───────────────────────────────────────────────────────────────
function EventModal({modal,onClose,onSave,onDelete}) {
  const isEdit = modal.type==="edit";
  const base = isEdit?modal.evt:{ds:modal.ds,s:modal.s||"09:00",e:mt(Math.min(tm(modal.s||"09:00")+60,SLOT_MAX)),title:"",cat:"perso",note:""};
  const [f,sf]=useState({...base});
  const set=(k,v)=>sf(p=>({...p,[k]:v}));
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100,backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:SURFACE,borderRadius:"24px 24px 0 0",width:"100%",maxWidth:600,padding:"20px 22px 50px",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 -8px 40px rgba(0,0,0,0.15)"}}>
        <div style={{width:36,height:4,background:"#D0D0D0",borderRadius:2,margin:"0 auto 20px"}}/>
        <div style={{fontWeight:700,fontSize:19,marginBottom:20,letterSpacing:"-0.02em"}}>{isEdit?"Modifier l'événement":"Nouvel événement"}</div>
        <Fld label="Titre"><input style={inp()} value={f.title} onChange={e=>set("title",e.target.value)} placeholder="Ex : Padel, Copine, Rendez-vous..."/></Fld>
        <Fld label="Date"><input style={inp()} type="date" value={f.ds} onChange={e=>set("ds",e.target.value)}/></Fld>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Fld label="Début"><input style={inp()} type="time" value={f.s} onChange={e=>set("s",e.target.value)}/></Fld>
          <Fld label="Fin"><input style={inp()} type="time" value={f.e} onChange={e=>set("e",e.target.value)}/></Fld>
        </div>
        <Fld label="Catégorie">
          <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
            {CATS.map(c=>(
              <button key={c.id} onClick={()=>set("cat",c.id)} style={{
                background:f.cat===c.id?c.color:"transparent",
                color:f.cat===c.id?"#fff":SUB,
                border:`1.5px solid ${f.cat===c.id?c.color:BORDER}`,
                borderRadius:20,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer",
                transition:"all 0.12s",
              }}>{c.label}</button>
            ))}
          </div>
        </Fld>
        <Fld label="Note (optionnel)"><textarea style={{...inp(),height:72,resize:"vertical"}} value={f.note||""} onChange={e=>set("note",e.target.value)} placeholder="..."/></Fld>
        <div style={{display:"flex",gap:10,marginTop:20}}>
          {isEdit && <button onClick={()=>onDelete(f.id)} style={{flex:1,background:"#FFF0F0",color:"#FF3B30",border:"1.5px solid #FFD0CE",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer",fontSize:15}}>Supprimer</button>}
          <button onClick={()=>onSave(f)} style={{flex:2,background:TEXT,color:"#fff",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer",fontSize:16}}>{isEdit?"Enregistrer":"Ajouter"}</button>
        </div>
      </div>
    </div>
  );
}
function Fld({label,children}){return <div style={{marginBottom:15}}><div style={{fontSize:11,fontWeight:700,color:MUTED,letterSpacing:"0.08em",marginBottom:6,textTransform:"uppercase"}}>{label}</div>{children}</div>;}
function inp(){return {width:"100%",boxSizing:"border-box",background:BG,border:`1.5px solid ${BORDER}`,borderRadius:12,padding:"12px 14px",fontSize:15,color:TEXT,outline:"none",fontFamily:"inherit"};}
function navBtn(){return {background:"none",border:`1px solid ${BORDER}`,color:SUB,borderRadius:10,width:40,height:40,fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0};}

// ── TASKS ─────────────────────────────────────────────────────────────────────
function TasksView({tasks,setTasks}){
  const [form,setForm]=useState({title:"",priority:"normale",due:""});
  const [open,setOpen]=useState(false);
  const todo=tasks.filter(t=>!t.done),done=tasks.filter(t=>t.done);
  function add(){if(!form.title.trim())return;setTasks(p=>[...p,{...form,id:`T:${Date.now()}`,done:false}]);setForm({title:"",priority:"normale",due:""});setOpen(false);}
  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"16px 16px 100px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:22,letterSpacing:"-0.02em"}}>Tâches</div>
        <button onClick={()=>setOpen(!open)} style={{background:TEXT,color:"#fff",border:"none",borderRadius:12,padding:"9px 18px",fontWeight:700,cursor:"pointer",fontSize:14}}>{open?"Annuler":"+ Ajouter"}</button>
      </div>
      {open&&<div style={{background:SURFACE,border:`1.5px solid ${BORDER}`,borderRadius:16,padding:16,marginBottom:16}}>
        <input style={{...inp(),marginBottom:10}} placeholder="Titre de la tâche" value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <select style={inp()} value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))}>
            <option value="basse">Basse</option><option value="normale">Normale</option><option value="haute">Haute !</option>
          </select>
          <input style={inp()} type="date" value={form.due} onChange={e=>setForm(p=>({...p,due:e.target.value}))}/>
        </div>
        <button onClick={add} style={{width:"100%",background:TEXT,color:"#fff",border:"none",borderRadius:12,padding:13,fontWeight:700,cursor:"pointer",fontSize:15}}>Ajouter</button>
      </div>}
      {todo.length===0&&!open&&<div style={{textAlign:"center",color:MUTED,padding:"70px 0",fontSize:15}}>Aucune tâche</div>}
      {todo.map(t=><TRow key={t.id} task={t} onToggle={id=>setTasks(p=>p.map(x=>x.id===id?{...x,done:true}:x))} onDelete={id=>setTasks(p=>p.filter(x=>x.id!==id))}/>)}
      {done.length>0&&<><div style={{fontSize:11,fontWeight:700,color:MUTED,letterSpacing:"0.1em",margin:"20px 0 10px"}}>TERMINÉES</div>{done.map(t=><TRow key={t.id} task={t} done onToggle={id=>setTasks(p=>p.map(x=>x.id===id?{...x,done:false}:x))} onDelete={id=>setTasks(p=>p.filter(x=>x.id!==id))}/>)}</>}
    </div>
  );
}
function TRow({task,done,onToggle,onDelete}){
  const pc=task.priority==="haute"?"#FF3B30":task.priority==="basse"?"#AEAEB2":"#FF9500";
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:14,padding:"13px 16px",marginBottom:8,opacity:done?0.5:1,boxShadow:"0 1px 3px rgba(0,0,0,0.03)"}}>
      <button onClick={()=>onToggle(task.id)} style={{width:26,height:26,borderRadius:"50%",flexShrink:0,border:`2px solid ${done?"#34C759":BORDER}`,background:done?"#34C759":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {done&&<span style={{color:"#fff",fontSize:12,fontWeight:700}}>✓</span>}
      </button>
      <div style={{flex:1}}>
        <div style={{fontWeight:600,fontSize:14,textDecoration:done?"line-through":"none"}}>{task.title}</div>
        {task.due&&<div style={{fontSize:12,color:MUTED,marginTop:1}}>Échéance : {task.due}</div>}
      </div>
      <div style={{fontSize:11,fontWeight:700,color:pc,textTransform:"capitalize"}}>{task.priority}</div>
      <button onClick={()=>onDelete(task.id)} style={{background:"none",border:"none",color:MUTED,cursor:"pointer",fontSize:22,lineHeight:1,padding:"0 2px"}}>×</button>
    </div>
  );
}

// ── NOTES ─────────────────────────────────────────────────────────────────────
function NotesView({notes,setNotes}){
  const [editing,setEditing]=useState(null);
  function save(){if(!editing.title.trim())return;if(editing.id)setNotes(p=>p.map(n=>n.id===editing.id?{...editing}:n));else setNotes(p=>[{...editing,id:`N:${Date.now()}`,date:todayDubai()},...p]);setEditing(null);}
  if(editing) return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"16px 16px"}}>
      <button onClick={()=>setEditing(null)} style={{background:"none",border:"none",color:"#007AFF",fontSize:15,cursor:"pointer",marginBottom:14,fontWeight:500}}>← Retour</button>
      <input style={{...inp(),fontSize:18,fontWeight:700,marginBottom:12}} placeholder="Titre" value={editing.title} onChange={e=>setEditing(p=>({...p,title:e.target.value}))}/>
      <textarea style={{...inp(),height:300,resize:"vertical",fontSize:15,lineHeight:1.6}} placeholder="Écrivez ici..." value={editing.body||""} onChange={e=>setEditing(p=>({...p,body:e.target.value}))}/>
      <div style={{display:"flex",gap:10,marginTop:14}}>
        {editing.id&&<button onClick={()=>{setNotes(p=>p.filter(n=>n.id!==editing.id));setEditing(null);}} style={{flex:1,background:"#FFF0F0",color:"#FF3B30",border:"1.5px solid #FFD0CE",borderRadius:14,padding:13,fontWeight:700,cursor:"pointer"}}>Supprimer</button>}
        <button onClick={save} style={{flex:2,background:TEXT,color:"#fff",border:"none",borderRadius:14,padding:13,fontWeight:700,cursor:"pointer",fontSize:15}}>Enregistrer</button>
      </div>
    </div>
  );
  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"16px 16px 100px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:22,letterSpacing:"-0.02em"}}>Notes</div>
        <button onClick={()=>setEditing({title:"",body:""})} style={{background:TEXT,color:"#fff",border:"none",borderRadius:12,padding:"9px 18px",fontWeight:700,cursor:"pointer",fontSize:14}}>+ Nouvelle</button>
      </div>
      {notes.length===0&&<div style={{textAlign:"center",color:MUTED,padding:"70px 0",fontSize:15}}>Aucune note</div>}
      {notes.map(n=>(
        <div key={n.id} onClick={()=>setEditing({...n})} style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:16,padding:"16px",marginBottom:10,cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:5}}>{n.title}</div>
          {n.body&&<div style={{fontSize:13,color:SUB,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",lineHeight:1.5}}>{n.body}</div>}
          <div style={{fontSize:11,color:MUTED,marginTop:10}}>{n.date}</div>
        </div>
      ))}
    </div>
  );
}
