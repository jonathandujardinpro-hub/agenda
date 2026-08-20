import { useState, useEffect, useCallback, useRef } from "react";
import { loadData, saveData } from "./supabase.js";

const BG      = "#F7F6F2";
const SURFACE = "#FFFFFF";
const BORDER  = "#E8E5DF";
const MUTED   = "#B0ABA3";
const TEXT    = "#1A1917";
const SUB     = "#6B6860";

const ROUTINE_STYLE = {
  reveil:   { bg:"#F3F4F6", border:"#9CA3AF", text:"#6B7280" },
  sport:    { bg:"#DCFCE7", border:"#86EFAC", text:"#166534" },
  profond:  { bg:"#DBEAFE", border:"#93C5FD", text:"#1E3A8A" },
  travail:  { bg:"#EFF6FF", border:"#BAE6FD", text:"#1D4ED8" },
  dejeuner: { bg:"#FEF3C7", border:"#FCD34D", text:"#92400E" },
  pause:    { bg:"#F3E8FF", border:"#D8B4FE", text:"#6B21A8" },
  autre:    { bg:"#F1F5F9", border:"#CBD5E1", text:"#475569" },
};

const CATS = [
  { id:"perso",   label:"Personnel",   color:"#EC4899" },
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
const SLOT_H   = 48;

// Layout constants
const LABEL_W  = 58;  // px - hour label
const GAP      = 4;   // px - gap between label and content
const R_PCT    = 0.62; // routine takes 62% of content width
const C_PCT    = 0.36; // custom takes 36% of content width

const p2      = n => String(n).padStart(2, "0");
const tm      = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const mt      = m => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const toStr   = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const fromStr = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (s, n) => { const d = fromStr(s); d.setDate(d.getDate()+n); return toStr(d); };
const minToPx = min => ((min - SLOT_MIN) / STEP) * SLOT_H;
const durToPx = dur => (dur / STEP) * SLOT_H;

function todayDubai() {
  const n = new Date(), utc = n.getTime() + n.getTimezoneOffset() * 60000;
  return toStr(new Date(utc + 4 * 3600000));
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

// Column layout for overlapping custom events
function computeColumns(events) {
  const sorted = [...events].sort((a,b) => a.sMin - b.sMin);
  const cols = [];
  const result = {};
  sorted.forEach(evt => {
    let placed = false;
    for (let ci = 0; ci < cols.length; ci++) {
      const lastId = cols[ci][cols[ci].length - 1];
      const last = sorted.find(e => e.id === lastId);
      if (last.eMin <= evt.sMin) {
        cols[ci].push(evt.id);
        result[evt.id] = { col: ci, total: 0 };
        placed = true;
        break;
      }
    }
    if (!placed) {
      result[evt.id] = { col: cols.length, total: 0 };
      cols.push([evt.id]);
    }
  });
  const total = cols.length || 1;
  Object.keys(result).forEach(id => { result[id].total = total; });
  return result;
}

const LS  = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const SS  = (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export default function App() {
  const today = todayDubai();
  const [date,    setDate  ] = useState(today);
  const [tab,     setTab   ] = useState("jour");
  const [evts,    setEvts  ] = useState(() => LS("ag6_evts") || []);
  const [tasks,   setTasks ] = useState(() => LS("ag6_tsk")  || []);
  const [notes,   setNotes ] = useState(() => LS("ag6_nts")  || []);
  const [modal,   setModal ] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loaded,  setLoaded ] = useState(false);
  const [syncOk,  setSyncOk ] = useState(true);
  const saveTimer = useRef(null);
  const latest = useRef({ evts, tasks, notes });

  useEffect(() => {
    loadData().then(d => {
      if (d) {
        if (d.evts)  { setEvts(d.evts);   SS("ag6_evts", d.evts); }
        if (d.tasks) { setTasks(d.tasks);  SS("ag6_tsk",  d.tasks); }
        if (d.notes) { setNotes(d.notes);  SS("ag6_nts",  d.notes); }
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
      SS("ag6_evts", evts); SS("ag6_tsk", tasks); SS("ag6_nts", notes);
      const res = await saveData({ evts, tasks, notes });
      setSyncing(false);
      setSyncOk(res !== false);
    }, 800);
  }, [loaded]);

  useEffect(() => { if (loaded) triggerSave(); }, [evts, tasks, notes]);

  const customFor = ds => evts.filter(e => e.ds === ds);

  function saveEvt(e) {
    setEvts(p => evts.find(x => x.id === e.id)
      ? p.map(x => x.id === e.id ? e : x)
      : [...p, { ...e, id:`C:${Date.now()}` }]
    );
    setModal(null);
  }
  function removeEvt(id) { setEvts(p => p.filter(x => x.id !== id)); setModal(null); }

  const todayTasks = tasks.filter(t => !t.done && (!t.due || t.due === today));

  if (!loaded) return (
    <div style={{ height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:BG, fontFamily:"'SF Pro Display',-apple-system,sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:14 }}>📅</div>
        <div style={{ fontSize:15, color:MUTED, fontWeight:600 }}>Chargement…</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:BG, fontFamily:"'SF Pro Display',-apple-system,'Helvetica Neue',sans-serif", color:TEXT }}>
      <header style={{ position:"sticky", top:0, zIndex:50, background:"rgba(247,246,242,0.97)", backdropFilter:"blur(16px)", borderBottom:`1px solid ${BORDER}`, height:54, display:"flex", alignItems:"center", padding:"0 16px", gap:12 }}>
        <span style={{ fontWeight:800, fontSize:16, letterSpacing:"-0.03em", flex:1 }}>Mon agenda</span>
        <div style={{ display:"flex", gap:2, background:"#EEEDE9", borderRadius:10, padding:3 }}>
          {[["jour","Jour"],["semaine","Sem."],["taches","✅"],["notes","📝"]].map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)} style={{ background:tab===v?SURFACE:"transparent", color:tab===v?TEXT:MUTED, border:"none", borderRadius:8, padding:"5px 12px", fontWeight:600, fontSize:13, cursor:"pointer", boxShadow:tab===v?"0 1px 3px rgba(0,0,0,0.09)":"none", transition:"all 0.15s" }}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize:13, color:syncing?"#F59E0B":syncOk?"#10B981":"#EF4444", fontWeight:700, width:20, textAlign:"center" }}>
          {syncing?"↑":syncOk?"✓":"!"}
        </div>
      </header>

      {tab==="jour"    && <DayView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onAddAt={(ds,s) => setModal({type:"add",ds,s})} onEditCustom={e => setModal({type:"edit",evt:e})} todayTasks={todayTasks}/>}
      {tab==="semaine" && <WeekView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onDay={ds => { setDate(ds); setTab("jour"); }}/>}
      {tab==="taches"  && <TasksView tasks={tasks} setTasks={setTasks}/>}
      {tab==="notes"   && <NotesView notes={notes} setNotes={setNotes}/>}

      {(tab==="jour"||tab==="semaine") && (
        <button onClick={() => setModal({type:"add",ds:date,s:"09:00"})} style={{ position:"fixed", bottom:28, right:20, width:56, height:56, borderRadius:"50%", background:TEXT, color:BG, border:"none", fontSize:28, cursor:"pointer", zIndex:40, boxShadow:"0 4px 24px rgba(0,0,0,0.2)", display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
      )}

      {modal && <EventModal modal={modal} onClose={() => setModal(null)} onSave={saveEvt} onDelete={removeEvt}/>}
    </div>
  );
}

// ── DAY VIEW ──────────────────────────────────────────────────────────────────
function DayView({ date, setDate, today, routineFor, customFor, onAddAt, onEditCustom, todayTasks }) {
  const d = fromStr(date), isToday = date === today;
  const routine = routineFor(date);
  const custom  = customFor(date);
  const totalH  = SLOTS.length * SLOT_H;

  // Prepare custom events with pixel data
  const customWithPx = custom.map(c => ({
    ...c,
    sMin: tm(c.s),
    eMin: c.s === c.e ? tm(c.s) + 30 : tm(c.e),
  }));

  // Compute column layout for custom events
  const colLayout = customWithPx.length ? computeColumns(customWithPx) : {};

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"0 0 120px" }}>
      {/* DATE NAV */}
      <div style={{ display:"flex", alignItems:"center", padding:"16px 16px 10px" }}>
        <button onClick={() => setDate(addDays(date,-1))} style={arrow()}>‹</button>
        <div style={{ flex:1, textAlign:"center" }}>
          <div style={{ fontSize:12, fontWeight:700, color:MUTED, letterSpacing:"0.1em", textTransform:"uppercase" }}>{JOURS[d.getDay()]}</div>
          <div style={{ fontSize:28, fontWeight:800, letterSpacing:"-0.04em", lineHeight:1.15, color:isToday?TEXT:SUB }}>
            {d.getDate()} <span style={{ fontSize:17, fontWeight:400, color:MUTED }}>{MOIS_C[d.getMonth()]} {d.getFullYear()}</span>
          </div>
          {isToday && <div style={{ width:5, height:5, borderRadius:"50%", background:"#2563EB", margin:"3px auto 0" }}/>}
        </div>
        <button onClick={() => setDate(addDays(date,1))} style={arrow()}>›</button>
      </div>

      {!isToday && (
        <div style={{ textAlign:"center", marginBottom:8 }}>
          <button onClick={() => setDate(today)} style={{ background:"none", border:`1px solid ${BORDER}`, color:SUB, borderRadius:20, padding:"4px 14px", fontSize:12, cursor:"pointer", fontWeight:600 }}>Aujourd'hui</button>
        </div>
      )}

      {/* TASKS STRIP */}
      {isToday && todayTasks.length > 0 && (
        <div style={{ margin:"0 16px 10px", background:SURFACE, borderRadius:12, padding:"10px 14px", border:`1px solid ${BORDER}` }}>
          <div style={{ fontSize:10, fontWeight:700, color:MUTED, letterSpacing:"0.08em", marginBottom:6 }}>TÂCHES DU JOUR</div>
          {todayTasks.map(t => <div key={t.id} style={{ fontSize:13, color:TEXT, paddingBottom:3 }}>· {t.title}</div>)}
        </div>
      )}

      {/* TIMELINE */}
      <div style={{ margin:"0 16px", background:SURFACE, borderRadius:18, border:`1px solid ${BORDER}`, overflow:"hidden" }}>
        <div style={{ position:"relative", height:totalH }}>

          {/* Grid lines + hour labels */}
          {SLOTS.map((slotMin, i) => {
            const isHour = slotMin % 60 === 0;
            return (
              <div key={slotMin} style={{ position:"absolute", left:0, right:0, top:i*SLOT_H, height:SLOT_H, borderTop:`1px solid ${isHour?BORDER:"#F3F1ED"}`, pointerEvents:"none", zIndex:1 }}>
                <div style={{ paddingTop:5, paddingLeft:12, fontSize:isHour?11:10, fontWeight:isHour?600:400, color:isHour?SUB:MUTED, userSelect:"none", lineHeight:1, width:LABEL_W }}>
                  {isHour ? `${p2(slotMin/60)}h` : `${p2(Math.floor(slotMin/60))}h${p2(slotMin%60)}`}
                </div>
              </div>
            );
          })}

          {/* ── ROUTINE BLOCKS — left column, always full width of left zone ── */}
          {routine.map(r => {
            const rStart = tm(r.s), rEnd = tm(r.e);
            if (rStart < SLOT_MIN || rStart >= SLOT_MAX) return null;
            const top    = minToPx(rStart);
            const height = durToPx(rEnd - rStart);
            const st     = ROUTINE_STYLE[r.cat] || ROUTINE_STYLE.autre;

            // Does any custom event overlap this routine block?
            const hasOverlap = customWithPx.some(c => c.sMin < rEnd && c.eMin > rStart);

            return (
              <div key={r.id}
                onClick={() => onAddAt(date, r.s)}
                style={{
                  position:"absolute",
                  left: LABEL_W + GAP,
                  // If custom events overlap, routine takes left 62%, else full width
                  right: hasOverlap ? "38%" : 10,
                  top: top + 1,
                  height: height - 2,
                  background: st.bg,
                  border: `1.5px solid ${st.border}`,
                  borderRadius: 12,
                  zIndex: 5,
                  overflow: "hidden",
                  boxSizing: "border-box",
                  cursor: "pointer",
                }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 10px 5px" }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:st.border, flexShrink:0 }}/>
                  <span style={{ fontWeight:700, fontSize:12, color:st.text, lineHeight:1 }}>{r.title}</span>
                  <span style={{ fontSize:10, color:st.text, opacity:0.55, marginLeft:"auto" }}>{r.s}–{r.e}</span>
                </div>
                <div style={{ position:"absolute", bottom:6, left:10, fontSize:10, color:st.text, opacity:0.3 }}>+ ajouter</div>
              </div>
            );
          })}

          {/* ── CUSTOM EVENTS — always in right column, never overlap routine ── */}
          {customWithPx.map(c => {
            if (c.sMin < SLOT_MIN || c.sMin >= SLOT_MAX) return null;
            const layout   = colLayout[c.id] || { col:0, total:1 };
            const top      = minToPx(c.sMin);
            const height   = Math.max(durToPx(c.eMin - c.sMin) - 3, SLOT_H * 0.85);
            const cat      = CAT[c.cat] || CAT.autre;
            const short    = height < SLOT_H * 1.2;

            // Right zone: from 38% right edge, split into columns if needed
            const zoneRight   = 10;  // px from right edge
            const zoneLeft    = "38%"; // start from 38% from right
            const colW        = `${38 / layout.total}%`;
            const colRight    = `${zoneRight + (layout.total - layout.col - 1) * (38 / layout.total)}%`;

            return (
              <div key={c.id}
                onClick={() => onEditCustom(c)}
                style={{
                  position:"absolute",
                  right: colRight,
                  width: colW,
                  top: top + 2,
                  height: height,
                  background: cat.color,
                  color: "#fff",
                  borderRadius: 10,
                  padding: short ? "4px 8px" : "7px 10px",
                  cursor: "pointer",
                  zIndex: 8,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
                  overflow: "hidden",
                  boxSizing: "border-box",
                }}>
                <div style={{ fontWeight:700, fontSize:short?11:13, lineHeight:1.2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.title}</div>
                {!short && <div style={{ fontSize:10, opacity:0.8, marginTop:2 }}>{c.s}{c.s!==c.e?` → ${c.e}`:""}</div>}
              </div>
            );
          })}

          {/* Clickable empty slots (left zone only) */}
          {SLOTS.map((slotMin, i) => {
            const covered = routine.some(r => slotMin >= tm(r.s) && slotMin < tm(r.e));
            if (covered) return null;
            return (
              <div key={`e-${slotMin}`}
                onClick={() => onAddAt(date, mt(slotMin))}
                style={{ position:"absolute", left:LABEL_W+GAP, right:"38%", top:i*SLOT_H, height:SLOT_H, cursor:"pointer", zIndex:4 }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── WEEK VIEW ─────────────────────────────────────────────────────────────────
function WeekView({ date, setDate, today, routineFor, customFor, onDay }) {
  const d0 = fromStr(date), mon = new Date(d0);
  mon.setDate(d0.getDate() - ((d0.getDay()+6)%7));
  const days = Array.from({length:7}, (_,i) => { const x=new Date(mon); x.setDate(mon.getDate()+i); return toStr(x); });
  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"0 12px 120px" }}>
      <div style={{ display:"flex", alignItems:"center", padding:"14px 4px 12px" }}>
        <button onClick={() => setDate(addDays(date,-7))} style={arrow()}>‹</button>
        <div style={{ flex:1, textAlign:"center", fontWeight:700, fontSize:14, color:SUB }}>
          {fromStr(days[0]).getDate()} {MOIS_C[fromStr(days[0]).getMonth()]} — {fromStr(days[6]).getDate()} {MOIS_C[fromStr(days[6]).getMonth()]} {fromStr(days[6]).getFullYear()}
        </div>
        <button onClick={() => setDate(addDays(date,7))} style={arrow()}>›</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6 }}>
        {days.map(ds => {
          const dd=fromStr(ds), isTod=ds===today;
          const routine=routineFor(ds), custom=customFor(ds);
          return (
            <div key={ds} onClick={() => onDay(ds)} style={{ background:isTod?"#EEF2FF":SURFACE, border:`1px solid ${isTod?"#C7D2FE":BORDER}`, borderRadius:12, padding:"10px 6px", cursor:"pointer", minHeight:130 }}>
              <div style={{ textAlign:"center", marginBottom:8 }}>
                <div style={{ fontSize:9, fontWeight:700, color:MUTED, letterSpacing:"0.08em" }}>{JOURS_C[dd.getDay()]}</div>
                <div style={{ fontSize:18, fontWeight:800, color:isTod?"#1E40AF":TEXT }}>{dd.getDate()}</div>
              </div>
              {routine.map(r => { const st=ROUTINE_STYLE[r.cat]||ROUTINE_STYLE.autre; return <div key={r.id} style={{ background:st.bg, border:`1px solid ${st.border}`, borderRadius:5, padding:"2px 5px", marginBottom:3, fontSize:9, fontWeight:700, color:st.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.s.slice(0,5)} {r.title}</div>; })}
              {custom.map(c => { const cat=CAT[c.cat]||CAT.autre; return <div key={c.id} style={{ background:cat.color, borderRadius:5, padding:"2px 5px", marginBottom:3, fontSize:9, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.s.slice(0,5)} {c.title}</div>; })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── EVENT MODAL ───────────────────────────────────────────────────────────────
function EventModal({ modal, onClose, onSave, onDelete }) {
  const isEdit = modal.type === "edit";
  const base = isEdit ? modal.evt : { ds:modal.ds, s:modal.s||"09:00", e:mt(Math.min(tm(modal.s||"09:00")+60,SLOT_MAX)), title:"", cat:"perso", note:"" };
  const [f, sf] = useState({...base});
  const set = (k,v) => sf(p => ({...p,[k]:v}));
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.35)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100, backdropFilter:"blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:SURFACE, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:600, padding:"20px 20px 48px", maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ width:36, height:4, background:BORDER, borderRadius:2, margin:"0 auto 18px" }}/>
        <div style={{ fontWeight:800, fontSize:18, marginBottom:18 }}>{isEdit?"Modifier l'événement":"Ajouter un événement"}</div>
        <Fld label="Titre"><input style={inp()} value={f.title} onChange={e=>set("title",e.target.value)} placeholder="Ex : Padel, Copine, Rendez-vous..."/></Fld>
        <Fld label="Date"><input style={inp()} type="date" value={f.ds} onChange={e=>set("ds",e.target.value)}/></Fld>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <Fld label="Début"><input style={inp()} type="time" value={f.s} onChange={e=>set("s",e.target.value)}/></Fld>
          <Fld label="Fin"><input style={inp()} type="time" value={f.e} onChange={e=>set("e",e.target.value)}/></Fld>
        </div>
        <Fld label="Catégorie">
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {CATS.map(c => (
              <button key={c.id} onClick={() => set("cat",c.id)} style={{ background:f.cat===c.id?c.color:"transparent", color:f.cat===c.id?"#fff":SUB, border:`1px solid ${f.cat===c.id?c.color:BORDER}`, borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" }}>{c.label}</button>
            ))}
          </div>
        </Fld>
        <Fld label="Note (optionnel)"><textarea style={{...inp(),height:68,resize:"vertical"}} value={f.note||""} onChange={e=>set("note",e.target.value)} placeholder="..."/></Fld>
        <div style={{ display:"flex", gap:10, marginTop:18 }}>
          {isEdit && <button onClick={() => onDelete(f.id)} style={{ flex:1, background:"#FEF2F2", color:"#EF4444", border:"1px solid #FECACA", borderRadius:12, padding:13, fontWeight:700, cursor:"pointer", fontSize:14 }}>Supprimer</button>}
          <button onClick={() => onSave(f)} style={{ flex:2, background:TEXT, color:BG, border:"none", borderRadius:12, padding:13, fontWeight:700, cursor:"pointer", fontSize:15 }}>{isEdit?"Enregistrer":"Ajouter"}</button>
        </div>
      </div>
    </div>
  );
}

function Fld({ label, children }) {
  return <div style={{ marginBottom:14 }}><div style={{ fontSize:11, fontWeight:700, color:MUTED, letterSpacing:"0.07em", marginBottom:5, textTransform:"uppercase" }}>{label}</div>{children}</div>;
}
function inp() {
  return { width:"100%", boxSizing:"border-box", background:BG, border:`1px solid ${BORDER}`, borderRadius:10, padding:"11px 13px", fontSize:15, color:TEXT, outline:"none", fontFamily:"inherit" };
}
function arrow() {
  return { background:"none", border:`1px solid ${BORDER}`, color:SUB, borderRadius:10, width:38, height:38, fontSize:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 };
}

// ── TASKS ─────────────────────────────────────────────────────────────────────
function TasksView({ tasks, setTasks }) {
  const [form, setForm] = useState({ title:"", priority:"normale", due:"" });
  const [open, setOpen] = useState(false);
  const todo = tasks.filter(t => !t.done), done = tasks.filter(t => t.done);
  function add() {
    if (!form.title.trim()) return;
    setTasks(p => [...p, {...form, id:`T:${Date.now()}`, done:false}]);
    setForm({ title:"", priority:"normale", due:"" });
    setOpen(false);
  }
  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"16px 16px 100px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
        <div style={{ fontWeight:800, fontSize:22 }}>Tâches</div>
        <button onClick={() => setOpen(!open)} style={{ background:TEXT, color:BG, border:"none", borderRadius:10, padding:"8px 16px", fontWeight:700, cursor:"pointer" }}>{open?"Annuler":"+ Ajouter"}</button>
      </div>
      {open && (
        <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:14, marginBottom:14 }}>
          <input style={{...inp(),marginBottom:10}} placeholder="Titre de la tâche" value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            <select style={inp()} value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))}>
              <option value="basse">Basse</option><option value="normale">Normale</option><option value="haute">Haute !</option>
            </select>
            <input style={inp()} type="date" value={form.due} onChange={e=>setForm(p=>({...p,due:e.target.value}))}/>
          </div>
          <button onClick={add} style={{ width:"100%", background:TEXT, color:BG, border:"none", borderRadius:10, padding:12, fontWeight:700, cursor:"pointer", fontSize:15 }}>Ajouter</button>
        </div>
      )}
      {todo.length===0 && !open && <div style={{ textAlign:"center", color:MUTED, padding:"60px 0", fontSize:15 }}>Aucune tâche</div>}
      {todo.map(t => <TRow key={t.id} task={t} onToggle={id=>setTasks(p=>p.map(x=>x.id===id?{...x,done:true}:x))} onDelete={id=>setTasks(p=>p.filter(x=>x.id!==id))}/>)}
      {done.length > 0 && <>
        <div style={{ fontSize:11, fontWeight:700, color:MUTED, letterSpacing:"0.08em", margin:"18px 0 8px" }}>TERMINÉES</div>
        {done.map(t => <TRow key={t.id} task={t} done onToggle={id=>setTasks(p=>p.map(x=>x.id===id?{...x,done:false}:x))} onDelete={id=>setTasks(p=>p.filter(x=>x.id!==id))}/>)}
      </>}
    </div>
  );
}
function TRow({ task, done, onToggle, onDelete }) {
  const pc = task.priority==="haute"?"#DC2626":task.priority==="basse"?"#9CA3AF":"#D97706";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:12, padding:"12px 14px", marginBottom:8, opacity:done?0.5:1 }}>
      <button onClick={() => onToggle(task.id)} style={{ width:24, height:24, borderRadius:"50%", flexShrink:0, border:`2px solid ${done?"#10B981":BORDER}`, background:done?"#10B981":"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {done && <span style={{ color:"#fff", fontSize:11 }}>✓</span>}
      </button>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:600, fontSize:14, textDecoration:done?"line-through":"none" }}>{task.title}</div>
        {task.due && <div style={{ fontSize:12, color:MUTED }}>Échéance : {task.due}</div>}
      </div>
      <div style={{ fontSize:11, fontWeight:700, color:pc }}>{task.priority}</div>
      <button onClick={() => onDelete(task.id)} style={{ background:"none", border:"none", color:MUTED, cursor:"pointer", fontSize:20, lineHeight:1 }}>×</button>
    </div>
  );
}

// ── NOTES ─────────────────────────────────────────────────────────────────────
function NotesView({ notes, setNotes }) {
  const [editing, setEditing] = useState(null);
  function save() {
    if (!editing.title.trim()) return;
    if (editing.id) setNotes(p => p.map(n => n.id===editing.id?{...editing}:n));
    else setNotes(p => [{...editing, id:`N:${Date.now()}`, date:todayDubai()}, ...p]);
    setEditing(null);
  }
  if (editing) return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"16px 16px" }}>
      <button onClick={() => setEditing(null)} style={{ background:"none", border:"none", color:SUB, fontSize:15, cursor:"pointer", marginBottom:12 }}>← Retour</button>
      <input style={{...inp(),fontSize:17,fontWeight:700,marginBottom:10}} placeholder="Titre" value={editing.title} onChange={e=>setEditing(p=>({...p,title:e.target.value}))}/>
      <textarea style={{...inp(),height:280,resize:"vertical",fontSize:14}} placeholder="Écrivez ici..." value={editing.body||""} onChange={e=>setEditing(p=>({...p,body:e.target.value}))}/>
      <div style={{ display:"flex", gap:10, marginTop:12 }}>
        {editing.id && <button onClick={() => { setNotes(p=>p.filter(n=>n.id!==editing.id)); setEditing(null); }} style={{ flex:1, background:"#FEF2F2", color:"#EF4444", border:"1px solid #FECACA", borderRadius:12, padding:12, fontWeight:700, cursor:"pointer" }}>Supprimer</button>}
        <button onClick={save} style={{ flex:2, background:TEXT, color:BG, border:"none", borderRadius:12, padding:12, fontWeight:700, cursor:"pointer", fontSize:15 }}>Enregistrer</button>
      </div>
    </div>
  );
  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"16px 16px 100px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
        <div style={{ fontWeight:800, fontSize:22 }}>Notes</div>
        <button onClick={() => setEditing({title:"",body:""})} style={{ background:TEXT, color:BG, border:"none", borderRadius:10, padding:"8px 16px", fontWeight:700, cursor:"pointer" }}>+ Nouvelle</button>
      </div>
      {notes.length===0 && <div style={{ textAlign:"center", color:MUTED, padding:"60px 0", fontSize:15 }}>Aucune note</div>}
      {notes.map(n => (
        <div key={n.id} onClick={() => setEditing({...n})} style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"14px", marginBottom:10, cursor:"pointer" }}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>{n.title}</div>
          {n.body && <div style={{ fontSize:13, color:SUB, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{n.body}</div>}
          <div style={{ fontSize:11, color:MUTED, marginTop:8 }}>{n.date}</div>
        </div>
      ))}
    </div>
  );
}
