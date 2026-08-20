import { useState, useEffect, useCallback, useRef } from "react";
import { loadData, saveData } from "./supabase.js";

const T = {
  bg:     "#FFFFFF",
  bg2:    "#F7F7F7",
  border: "#EBEBEB",
  text:   "#111111",
  sub:    "#888888",
  muted:  "#C0C0C0",
  accent: "#007AFF",
};

const RS = {
  reveil:   { bar:"#AEAEB2", bg:"#FAFAFA", text:"#555555" },
  sport:    { bar:"#34C759", bg:"#F4FFF7", text:"#1A6630" },
  profond:  { bar:"#007AFF", bg:"#F0F6FF", text:"#004DBD" },
  travail:  { bar:"#5AC8FA", bg:"#F0FBFF", text:"#0077A0" },
  dejeuner: { bar:"#FF9500", bg:"#FFFAF0", text:"#995800" },
  pause:    { bar:"#AF52DE", bg:"#FAF5FF", text:"#6B1E9A" },
  autre:    { bar:"#8E8E93", bg:"#F9F9F9", text:"#555555" },
};

const CATS = [
  { id:"perso",   label:"Personnel",   color:"#FF2D55" },
  { id:"sport",   label:"Sport",       color:"#34C759" },
  { id:"rdv",     label:"Rendez-vous", color:"#AF52DE" },
  { id:"travail", label:"Travail",     color:"#007AFF" },
  { id:"urgence", label:"Urgence",     color:"#FF3B30" },
  { id:"autre",   label:"Autre",       color:"#8E8E93" },
];
const CAT = Object.fromEntries(CATS.map(c=>[c.id,c]));

const JOURS   = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const JOURS_C = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_C  = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

const SLOT_MIN = 7  * 60;
const SLOT_MAX = 23 * 60;
const STEP     = 30;
const SLOTS    = Array.from({length:(SLOT_MAX-SLOT_MIN)/STEP},(_,i)=>SLOT_MIN+i*STEP);
const SLOT_H   = 56;
const LABEL_W  = 52;

const p2      = n=>String(n).padStart(2,"0");
const tm      = s=>{const[h,m]=s.split(":").map(Number);return h*60+m;};
const mt      = m=>`${p2(Math.floor(m/60))}:${p2(m%60)}`;
const toStr   = d=>`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const fromStr = s=>{const[y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);};
const addDays = (s,n)=>{const d=fromStr(s);d.setDate(d.getDate()+n);return toStr(d);};
const minToPx = min=>((min-SLOT_MIN)/STEP)*SLOT_H;
const durToPx = dur=>(dur/STEP)*SLOT_H;

function todayDubai(){
  const n=new Date(),utc=n.getTime()+n.getTimezoneOffset()*60000;
  return toStr(new Date(utc+4*3600000));
}

function routineFor(ds){
  const dow=fromStr(ds).getDay();
  if(dow>=1&&dow<=5) return [
    {id:`R:${ds}:rev`,cat:"reveil",  s:"08:30",e:"09:00",title:"Réveil"},
    {id:`R:${ds}:spo`,cat:"sport",   s:"09:00",e:"11:00",title:"Salle + trajets"},
    {id:`R:${ds}:pro`,cat:"profond", s:"11:30",e:"13:30",title:"Travail profond"},
    {id:`R:${ds}:dej`,cat:"dejeuner",s:"13:30",e:"14:30",title:"Déjeuner"},
    {id:`R:${ds}:tra`,cat:"travail", s:"14:30",e:"17:30",title:"Travail"},
    {id:`R:${ds}:pau`,cat:"pause",   s:"17:30",e:"18:00",title:"Pause"},
    {id:`R:${ds}:der`,cat:"profond", s:"18:00",e:"19:00",title:"Dernières tâches"},
  ];
  if(dow===6) return [
    {id:`R:${ds}:rev`,cat:"reveil",  s:"09:00",e:"09:30",title:"Réveil"},
    {id:`R:${ds}:tra`,cat:"profond", s:"09:30",e:"12:00",title:"Travail — Samedi"},
    {id:`R:${ds}:dej`,cat:"dejeuner",s:"12:00",e:"13:00",title:"Déjeuner"},
  ];
  return [
    {id:`R:${ds}:rev`,cat:"reveil", s:"09:30",e:"10:00",title:"Réveil"},
    {id:`R:${ds}:org`,cat:"profond",s:"10:00",e:"12:00",title:"Organisation semaine"},
    {id:`R:${ds}:dej`,cat:"dejeuner",s:"12:00",e:"13:00",title:"Déjeuner"},
  ];
}

const LS=(k)=>{try{return JSON.parse(localStorage.getItem(k));}catch{return null;}};
const SS=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};

export default function App(){
  const today=todayDubai();
  const [date,  setDate ]=useState(today);
  const [tab,   setTab  ]=useState("jour");
  const [evts,  setEvts ]=useState(()=>LS("ag9_e")||[]);
  const [tasks, setTasks]=useState(()=>LS("ag9_t")||[]);
  const [notes, setNotes]=useState(()=>LS("ag9_n")||[]);
  const [modal, setModal]=useState(null);
  const [sync,  setSync ]=useState("ok");
  const [loaded,setLoaded]=useState(false);
  const st=useRef(null), ref=useRef({evts,tasks,notes});

  useEffect(()=>{
    loadData().then(d=>{
      if(d){
        if(d.evts) {setEvts(d.evts); SS("ag9_e",d.evts);}
        if(d.tasks){setTasks(d.tasks);SS("ag9_t",d.tasks);}
        if(d.notes){setNotes(d.notes);SS("ag9_n",d.notes);}
      }
      setLoaded(true);
    });
  },[]);

  useEffect(()=>{ref.current={evts,tasks,notes};},[evts,tasks,notes]);

  const doSave=useCallback(()=>{
    if(!loaded)return;
    clearTimeout(st.current);
    setSync("saving");
    st.current=setTimeout(async()=>{
      const{evts,tasks,notes}=ref.current;
      SS("ag9_e",evts);SS("ag9_t",tasks);SS("ag9_n",notes);
      const ok=await saveData({evts,tasks,notes});
      setSync(ok===false?"err":"ok");
    },700);
  },[loaded]);

  useEffect(()=>{if(loaded)doSave();},[evts,tasks,notes]);

  const customFor=ds=>evts.filter(e=>e.ds===ds);
  const saveEvt=e=>{setEvts(p=>evts.find(x=>x.id===e.id)?p.map(x=>x.id===e.id?e:x):[...p,{...e,id:`C:${Date.now()}`}]);setModal(null);};
  const removeEvt=id=>{setEvts(p=>p.filter(x=>x.id!==id));setModal(null);};
  const todayTasks=tasks.filter(t=>!t.done&&(!t.due||t.due===today));

  if(!loaded) return(
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,fontFamily:"-apple-system,sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16}}>📅</div>
        <div style={{fontSize:14,color:T.muted,letterSpacing:"0.1em",fontWeight:600}}>CHARGEMENT</div>
      </div>
    </div>
  );

  const sc=sync==="saving"?"#FF9500":sync==="err"?"#FF3B30":"#34C759";

  return(
    <div style={{minHeight:"100vh",background:T.bg2,fontFamily:"-apple-system,'SF Pro Text','Helvetica Neue',sans-serif",color:T.text}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(255,255,255,0.95)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${T.border}`,height:50,display:"flex",alignItems:"center",padding:"0 20px",gap:12}}>
        <span style={{fontWeight:700,fontSize:17,letterSpacing:"-0.03em",flex:1}}>Mon agenda</span>
        <div style={{display:"flex",background:"#F0F0F0",borderRadius:10,padding:3,gap:1}}>
          {[["jour","Jour"],["semaine","Sem."],["taches","✅"],["notes","📝"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)} style={{background:tab===v?T.bg:"transparent",color:tab===v?T.text:T.sub,border:"none",borderRadius:8,padding:"5px 12px",fontWeight:600,fontSize:13,cursor:"pointer",boxShadow:tab===v?"0 1px 5px rgba(0,0,0,0.10)":"none",transition:"all 0.12s"}}>{l}</button>
          ))}
        </div>
        <div style={{color:sc,fontWeight:700,fontSize:14,width:16,textAlign:"center"}}>{sync==="saving"?"↑":sync==="err"?"!":"✓"}</div>
      </header>

      {tab==="jour"    && <DayView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onSlot={(ds,s)=>setModal({type:"add",ds,s})} onEdit={e=>setModal({type:"edit",evt:e})} todayTasks={todayTasks}/>}
      {tab==="semaine" && <WeekView date={date} setDate={setDate} today={today} routineFor={routineFor} customFor={customFor} onDay={ds=>{setDate(ds);setTab("jour");}}/>}
      {tab==="taches"  && <TasksView tasks={tasks} setTasks={setTasks}/>}
      {tab==="notes"   && <NotesView notes={notes} setNotes={setNotes}/>}

      {(tab==="jour"||tab==="semaine")&&(
        <button onClick={()=>setModal({type:"add",ds:date,s:"20:00"})} style={{position:"fixed",bottom:34,right:22,width:54,height:54,borderRadius:"50%",background:T.text,color:"#fff",border:"none",fontSize:28,cursor:"pointer",zIndex:50,boxShadow:"0 6px 28px rgba(0,0,0,0.25)",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      )}

      {modal&&<Modal modal={modal} onClose={()=>setModal(null)} onSave={saveEvt} onDelete={removeEvt}/>}
    </div>
  );
}

// ── DAY VIEW ──────────────────────────────────────────────────────────────────
function DayView({date,setDate,today,routineFor,customFor,onSlot,onEdit,todayTasks}){
  const d=fromStr(date),isToday=date===today;
  const routine=routineFor(date),custom=customFor(date);
  const totalH=SLOTS.length*SLOT_H;

  return(
    <div style={{maxWidth:640,margin:"0 auto",paddingBottom:100}}>
      {/* DATE NAV */}
      <div style={{display:"flex",alignItems:"center",padding:"16px 20px 10px",gap:8}}>
        <button onClick={()=>setDate(addDays(date,-1))} style={NB()}>‹</button>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.14em",textTransform:"uppercase"}}>{JOURS[d.getDay()]}</div>
          <div style={{fontSize:34,fontWeight:700,letterSpacing:"-0.04em",lineHeight:1.1,marginTop:2,color:isToday?T.text:T.sub}}>
            {d.getDate()}
            <span style={{fontSize:18,fontWeight:400,color:T.muted,marginLeft:8}}>{MOIS_C[d.getMonth()]} {d.getFullYear()}</span>
          </div>
          {isToday&&<div style={{width:4,height:4,borderRadius:"50%",background:T.accent,margin:"5px auto 0"}}/>}
        </div>
        <button onClick={()=>setDate(addDays(date,1))} style={NB()}>›</button>
      </div>

      {!isToday&&(
        <div style={{textAlign:"center",marginBottom:8}}>
          <button onClick={()=>setDate(today)} style={{background:"none",border:`1px solid ${T.border}`,color:T.sub,borderRadius:20,padding:"4px 16px",fontSize:12,cursor:"pointer",fontWeight:500}}>Aujourd'hui</button>
        </div>
      )}

      {/* TASKS STRIP */}
      {isToday&&todayTasks.length>0&&(
        <div style={{margin:"0 20px 12px",background:T.bg,borderRadius:16,border:`1px solid ${T.border}`,overflow:"hidden"}}>
          {todayTasks.map((t,i)=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderTop:i>0?`1px solid ${T.border}`:"none"}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:T.accent,flexShrink:0}}/>
              <span style={{fontSize:13,fontWeight:500}}>{t.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* TIMELINE */}
      <div style={{margin:"0 20px",background:T.bg,borderRadius:20,border:`1px solid ${T.border}`,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.04)"}}>
        <div style={{position:"relative",height:totalH}}>

          {/* Grid lines */}
          {SLOTS.map((slotMin,i)=>{
            const isHour=slotMin%60===0;
            return(
              <div key={slotMin} style={{position:"absolute",left:0,right:0,top:i*SLOT_H,height:SLOT_H,borderTop:`1px solid ${isHour?"#EBEBEB":"#F5F5F5"}`,pointerEvents:"none",zIndex:1}}>
                <div style={{paddingTop:6,paddingLeft:12,fontSize:isHour?11:9,fontWeight:isHour?600:400,color:isHour?T.sub:T.muted,userSelect:"none",width:LABEL_W}}>
                  {isHour?`${p2(slotMin/60)}h`:`${p2(Math.floor(slotMin/60))}h${p2(slotMin%60)}`}
                </div>
              </div>
            );
          })}

          {/* ROUTINE BLOCKS — full width, left accent bar */}
          {routine.map(r=>{
            const rS=tm(r.s),rE=tm(r.e);
            if(rS<SLOT_MIN||rS>=SLOT_MAX)return null;
            const top=minToPx(rS),height=durToPx(rE-rS);
            const st=RS[r.cat]||RS.autre;
            const short=height<SLOT_H*1.8;

            // Custom events that fall inside this routine block
            const inside=custom.filter(c=>{
              const cs=tm(c.s),ce=c.s===c.e?cs+30:tm(c.e);
              return cs>=rS&&cs<rE;
            });

            return(
              <div key={r.id} style={{
                position:"absolute",
                left:LABEL_W+6,right:8,
                top:top+2,height:height-4,
                background:st.bg,
                borderRadius:14,
                borderLeft:`3.5px solid ${st.bar}`,
                zIndex:5,overflow:"hidden",
                boxSizing:"border-box",
                display:"flex",flexDirection:"column",
              }}>
                {/* Routine label row */}
                <div onClick={()=>onSlot(date,r.s)} style={{display:"flex",alignItems:"center",gap:8,padding:short?"6px 12px":"8px 14px",cursor:"pointer",flexShrink:0}}>
                  <span style={{fontWeight:700,fontSize:short?12:14,color:st.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{r.title}</span>
                  <span style={{fontSize:10,color:st.bar,fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>{r.s}–{r.e}</span>
                </div>

                {/* Custom event chips — small fixed-height pills */}
                {inside.length>0&&(
                  <div style={{padding:"0 10px 10px",display:"flex",flexDirection:"column",gap:5}}>
                    {inside.map(c=>{
                      const cat=CAT[c.cat]||CAT.autre;
                      return(
                        <div key={c.id} onClick={ev=>{ev.stopPropagation();onEdit(c);}} style={{
                          background:cat.color,
                          color:"#fff",
                          borderRadius:9,
                          padding:"7px 12px",
                          cursor:"pointer",
                          display:"flex",alignItems:"center",gap:8,
                          boxShadow:`0 2px 8px ${cat.color}44`,
                          flexShrink:0,
                          overflow:"hidden",
                        }}>
                          <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{c.title}</div>
                          <div style={{fontSize:11,opacity:0.85,whiteSpace:"nowrap",flexShrink:0}}>{c.s}{c.s!==c.e?`–${c.e}`:""}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add hint */}
                {!short&&inside.length===0&&(
                  <div onClick={()=>onSlot(date,r.s)} style={{marginTop:"auto",padding:"0 14px 8px",fontSize:10,color:st.bar,opacity:0.5,cursor:"pointer",letterSpacing:"0.04em"}}>+ AJOUTER</div>
                )}
              </div>
            );
          })}

          {/* CUSTOM EVENTS outside routine blocks */}
          {custom.filter(c=>{
            const cs=tm(c.s);
            return !routine.some(r=>cs>=tm(r.s)&&cs<tm(r.e));
          }).map(c=>{
            const sMin=tm(c.s),eMin=c.s===c.e?sMin+30:tm(c.e);
            if(sMin<SLOT_MIN||sMin>=SLOT_MAX)return null;
            const top=minToPx(sMin),height=Math.max(durToPx(eMin-sMin)-4,SLOT_H*0.9);
            const cat=CAT[c.cat]||CAT.autre;
            const short=height<SLOT_H*1.4;
            return(
              <div key={c.id} onClick={()=>onEdit(c)} style={{
                position:"absolute",
                left:LABEL_W+6,right:8,
                top:top+2,height:height,
                background:cat.color,color:"#fff",
                borderRadius:14,
                padding:short?"6px 12px":"10px 14px",
                cursor:"pointer",zIndex:6,
                display:"flex",flexDirection:"column",justifyContent:"center",
                boxShadow:`0 4px 18px ${cat.color}55`,
                overflow:"hidden",boxSizing:"border-box",
              }}>
                <div style={{fontWeight:700,fontSize:short?13:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</div>
                {!short&&<div style={{fontSize:11,opacity:0.85,marginTop:2}}>{c.s}{c.s!==c.e?` — ${c.e}`:""}</div>}
              </div>
            );
          })}

          {/* Clickable empty slots */}
          {SLOTS.map((slotMin,i)=>{
            const inRoutine=routine.some(r=>slotMin>=tm(r.s)&&slotMin<tm(r.e));
            if(inRoutine)return null;
            return<div key={`t-${slotMin}`} onClick={()=>onSlot(date,mt(slotMin))} style={{position:"absolute",left:LABEL_W+6,right:8,top:i*SLOT_H,height:SLOT_H,cursor:"pointer",zIndex:4}}/>;
          })}
        </div>
      </div>
    </div>
  );
}

// ── WEEK VIEW ─────────────────────────────────────────────────────────────────
function WeekView({date,setDate,today,routineFor,customFor,onDay}){
  const d0=fromStr(date),mon=new Date(d0);
  mon.setDate(d0.getDate()-((d0.getDay()+6)%7));
  const days=Array.from({length:7},(_,i)=>{const x=new Date(mon);x.setDate(mon.getDate()+i);return toStr(x);});
  return(
    <div style={{maxWidth:900,margin:"0 auto",padding:"0 16px 100px"}}>
      <div style={{display:"flex",alignItems:"center",padding:"14px 0"}}>
        <button onClick={()=>setDate(addDays(date,-7))} style={NB()}>‹</button>
        <div style={{flex:1,textAlign:"center",fontWeight:600,fontSize:15,color:T.sub}}>
          {fromStr(days[0]).getDate()} {MOIS_C[fromStr(days[0]).getMonth()]} — {fromStr(days[6]).getDate()} {MOIS_C[fromStr(days[6]).getMonth()]} {fromStr(days[6]).getFullYear()}
        </div>
        <button onClick={()=>setDate(addDays(date,7))} style={NB()}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:7}}>
        {days.map(ds=>{
          const dd=fromStr(ds),isTod=ds===today;
          const r=routineFor(ds),c=customFor(ds);
          return(
            <div key={ds} onClick={()=>onDay(ds)} style={{background:isTod?"#EBF3FF":T.bg,border:`1px solid ${isTod?"#BDD9FF":T.border}`,borderRadius:16,padding:"10px 7px",cursor:"pointer",minHeight:120,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
              <div style={{textAlign:"center",marginBottom:8}}>
                <div style={{fontSize:9,fontWeight:700,color:T.muted,letterSpacing:"0.12em"}}>{JOURS_C[dd.getDay()]}</div>
                <div style={{fontSize:20,fontWeight:700,color:isTod?T.accent:T.text,lineHeight:1.2}}>{dd.getDate()}</div>
              </div>
              {r.map(ev=>{const st=RS[ev.cat]||RS.autre;return(
                <div key={ev.id} style={{borderLeft:`2.5px solid ${st.bar}`,background:st.bg,borderRadius:5,padding:"2px 6px",marginBottom:3,fontSize:9,fontWeight:600,color:st.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.s.slice(0,5)} {ev.title}</div>
              );})}
              {c.map(ev=>{const cat=CAT[ev.cat]||CAT.autre;return(
                <div key={ev.id} style={{background:cat.color,borderRadius:5,padding:"2px 6px",marginBottom:3,fontSize:9,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.s.slice(0,5)} {ev.title}</div>
              );})}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function Modal({modal,onClose,onSave,onDelete}){
  const isEdit=modal.type==="edit";
  const def=isEdit?modal.evt:{ds:modal.ds,s:modal.s||"20:00",e:mt(Math.min(tm(modal.s||"20:00")+60,SLOT_MAX)),title:"",cat:"perso",note:""};
  const[f,sf]=useState({...def});
  const set=(k,v)=>sf(p=>({...p,[k]:v}));
  const cat=CAT[f.cat]||CAT.autre;
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:200,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.bg,borderRadius:"28px 28px 0 0",width:"100%",maxWidth:620,maxHeight:"94vh",overflowY:"auto",boxShadow:"0 -16px 60px rgba(0,0,0,0.18)"}}>
        {/* Colored header */}
        <div style={{background:cat.color,borderRadius:"28px 28px 0 0",padding:"18px 24px 22px"}}>
          <div style={{width:36,height:4,background:"rgba(255,255,255,0.35)",borderRadius:2,margin:"0 auto 16px"}}/>
          <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.65)",letterSpacing:"0.08em",marginBottom:8}}>{isEdit?"MODIFIER":"NOUVEL ÉVÉNEMENT"}</div>
          <input value={f.title} onChange={e=>set("title",e.target.value)} placeholder="Titre…" style={{width:"100%",background:"transparent",border:"none",outline:"none",fontSize:26,fontWeight:700,color:"#fff",fontFamily:"inherit",caretColor:"#fff"}}/>
        </div>

        <div style={{padding:"22px 24px 48px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:18}}>
            <div><div style={LB()}>Date</div><input style={IP()} type="date" value={f.ds} onChange={e=>set("ds",e.target.value)}/></div>
            <div><div style={LB()}>Début</div><input style={IP()} type="time" value={f.s} onChange={e=>set("s",e.target.value)}/></div>
            <div><div style={LB()}>Fin</div><input style={IP()} type="time" value={f.e} onChange={e=>set("e",e.target.value)}/></div>
          </div>

          <div style={LB()}>Catégorie</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:18}}>
            {CATS.map(c=>(
              <button key={c.id} onClick={()=>set("cat",c.id)} style={{background:f.cat===c.id?c.color:"transparent",color:f.cat===c.id?"#fff":T.sub,border:`1.5px solid ${f.cat===c.id?c.color:T.border}`,borderRadius:20,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.1s"}}>{c.label}</button>
            ))}
          </div>

          <div style={LB()}>Note (optionnel)</div>
          <textarea style={{...IP(),height:80,resize:"vertical",marginBottom:22}} placeholder="…" value={f.note||""} onChange={e=>set("note",e.target.value)}/>

          <div style={{display:"flex",gap:10}}>
            {isEdit&&<button onClick={()=>onDelete(f.id)} style={{flex:1,background:"#FFF0F0",color:"#FF3B30",border:"1.5px solid #FFCDD0",borderRadius:16,padding:15,fontWeight:700,cursor:"pointer",fontSize:15}}>Supprimer</button>}
            <button onClick={()=>onSave(f)} style={{flex:2,background:cat.color,color:"#fff",border:"none",borderRadius:16,padding:15,fontWeight:700,cursor:"pointer",fontSize:16,boxShadow:`0 4px 18px ${cat.color}55`}}>
              {isEdit?"Enregistrer":"Ajouter"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const LB=()=>({fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:7,display:"block"});
const IP=()=>({width:"100%",boxSizing:"border-box",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:12,padding:"11px 14px",fontSize:15,color:T.text,outline:"none",fontFamily:"inherit",display:"block"});
const NB=()=>({background:"none",border:"none",color:T.sub,width:40,height:40,fontSize:26,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:10,flexShrink:0});

// ── TASKS ─────────────────────────────────────────────────────────────────────
function TasksView({tasks,setTasks}){
  const[form,sf]=useState({title:"",priority:"normale",due:""});
  const[open,setOpen]=useState(false);
  const todo=tasks.filter(t=>!t.done),done=tasks.filter(t=>t.done);
  const add=()=>{if(!form.title.trim())return;setTasks(p=>[...p,{...form,id:`T:${Date.now()}`,done:false}]);sf({title:"",priority:"normale",due:""});setOpen(false);};
  return(
    <div style={{maxWidth:580,margin:"0 auto",padding:"16px 20px 100px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:24,letterSpacing:"-0.03em"}}>Tâches</div>
        <button onClick={()=>setOpen(!open)} style={{background:T.text,color:"#fff",border:"none",borderRadius:14,padding:"9px 20px",fontWeight:700,cursor:"pointer",fontSize:14}}>{open?"Annuler":"+ Nouvelle"}</button>
      </div>
      {open&&(
        <div style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:18,padding:18,marginBottom:16,boxShadow:"0 4px 20px rgba(0,0,0,0.06)"}}>
          <input style={{...IP(),marginBottom:10,fontSize:16}} placeholder="Titre de la tâche" value={form.title} onChange={e=>sf(p=>({...p,title:e.target.value}))}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <select style={IP()} value={form.priority} onChange={e=>sf(p=>({...p,priority:e.target.value}))}>
              <option value="basse">Priorité basse</option>
              <option value="normale">Priorité normale</option>
              <option value="haute">Priorité haute !</option>
            </select>
            <input style={IP()} type="date" value={form.due} onChange={e=>sf(p=>({...p,due:e.target.value}))}/>
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
function TR({task,done,onToggle,onDelete}){
  const pc=task.priority==="haute"?"#FF3B30":task.priority==="basse"?"#AEAEB2":"#FF9500";
  return(
    <div style={{display:"flex",alignItems:"center",gap:12,background:T.bg,border:`1px solid ${T.border}`,borderRadius:16,padding:"14px 16px",marginBottom:8,opacity:done?0.4:1,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
      <button onClick={()=>onToggle(task.id)} style={{width:26,height:26,borderRadius:"50%",flexShrink:0,border:`2px solid ${done?"#34C759":T.border}`,background:done?"#34C759":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
        {done&&<span style={{color:"#fff",fontSize:13,fontWeight:700}}>✓</span>}
      </button>
      <div style={{flex:1}}>
        <div style={{fontWeight:600,fontSize:14,textDecoration:done?"line-through":"none"}}>{task.title}</div>
        {task.due&&<div style={{fontSize:12,color:T.muted,marginTop:2}}>Échéance : {task.due}</div>}
      </div>
      <div style={{fontSize:11,fontWeight:700,color:pc,textTransform:"uppercase",letterSpacing:"0.04em"}}>{task.priority}</div>
      <button onClick={()=>onDelete(task.id)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
    </div>
  );
}

// ── NOTES ─────────────────────────────────────────────────────────────────────
function NotesView({notes,setNotes}){
  const[ed,setEd]=useState(null);
  const save=()=>{if(!ed.title.trim())return;if(ed.id)setNotes(p=>p.map(n=>n.id===ed.id?{...ed}:n));else setNotes(p=>[{...ed,id:`N:${Date.now()}`,date:todayDubai()},...p]);setEd(null);};
  if(ed) return(
    <div style={{maxWidth:580,margin:"0 auto",padding:"16px 20px"}}>
      <button onClick={()=>setEd(null)} style={{background:"none",border:"none",color:T.accent,fontSize:15,cursor:"pointer",marginBottom:16,fontWeight:500}}>← Retour</button>
      <input style={{...IP(),fontSize:20,fontWeight:700,marginBottom:12,letterSpacing:"-0.02em"}} placeholder="Titre" value={ed.title} onChange={e=>setEd(p=>({...p,title:e.target.value}))}/>
      <textarea style={{...IP(),height:320,resize:"vertical",fontSize:15,lineHeight:1.7}} placeholder="Écrivez ici…" value={ed.body||""} onChange={e=>setEd(p=>({...p,body:e.target.value}))}/>
      <div style={{display:"flex",gap:10,marginTop:14}}>
        {ed.id&&<button onClick={()=>{setNotes(p=>p.filter(n=>n.id!==ed.id));setEd(null);}} style={{flex:1,background:"#FFF0F0",color:"#FF3B30",border:"1.5px solid #FFCDD0",borderRadius:16,padding:14,fontWeight:700,cursor:"pointer"}}>Supprimer</button>}
        <button onClick={save} style={{flex:2,background:T.text,color:"#fff",border:"none",borderRadius:16,padding:14,fontWeight:700,cursor:"pointer",fontSize:15}}>Enregistrer</button>
      </div>
    </div>
  );
  return(
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
          <div style={{fontSize:11,color:T.muted,marginTop:10}}>{n.date}</div>
        </div>
      ))}
    </div>
  );
}
