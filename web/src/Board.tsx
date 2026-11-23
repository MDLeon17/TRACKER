import { useState, type ReactNode } from 'react'
import { Archive, ArrowDownWideNarrow, ArrowUpNarrowWide, Bell, CalendarDays, Check, CheckCheck, ChevronRight, CircleCheck, ClipboardCheck, Clock3, ExternalLink, Filter, Folder, FolderClosed, FolderKanban, GitBranch, Layers3, ListChecks, Plus, Send, UserRoundPlus, UsersRound, X } from 'lucide-react'
import { date, get, message, navigate, pending, priorities, priorityLabels, projectCode, taskStatus, type Feed, type Project, type SortKey, type Task, type Workspace } from './data'
import { Avatar, Empty, ErrorBox, MultiPick, Urgency } from './ui'
import type { FormSpec, Mutate } from './Forms'

export type OpenForm = (form:FormSpec)=>void
export type SortProps = {sort:SortKey;asc:boolean;onSort:(s:SortKey)=>void;onDirection:()=>void}
export function Sorter({sort,asc,onSort,onDirection}:SortProps){
  return <div className="sort-control"><select aria-label="Ordenar proyectos por" value={sort} onChange={e=>onSort(e.target.value as SortKey)}>
    <option value="recent">Recién agregados</option><option value="due">Fecha de entrega</option><option value="pending">Objetivos pendientes</option></select>
    <button type="button" className="icon-btn" aria-label={'Orden '+(asc?'ascendente':'descendente')+'. Cambiar orden'} title={'Orden '+(asc?'ascendente':'descendente')} onClick={onDirection}>{asc?<ArrowUpNarrowWide size={17}/>:<ArrowDownWideNarrow size={17}/>}</button></div>
}
export function PageTitle({title,detail,action}:{title:string;detail?:string;action?:ReactNode}){
  return <div className="page-title"><div><h1>{title}</h1>{detail&&<p>{detail}</p>}</div>{action}</div>
}
function Progress({p}:{p:Project}){
  const total=p.tasks.length, complete=total-pending(p), value=total?Math.round(100*complete/total):0
  return <div className="progress-cell"><div><span>{complete}/{total} objetivos</span><strong>{value}%</strong></div><progress value={value} max="100" aria-label={'Progreso de '+p.name}>{value}%</progress></div>
}
function ProjectRows({projects}:{projects:Project[]}){
  return <div className="project-rows">{projects.map(p=><button type="button" className="project-row" key={p.id} onClick={()=>navigate('proyecto/'+p.id)}>
    <span className={'project-symbol color-'+(p.id%4)}><FolderClosed size={23}/></span><span className="row-name"><small>{projectCode(p.id)}</small><strong>{p.name}</strong></span>
    <span className="row-date"><CalendarDays size={15}/>{date(p.due)}</span><Progress p={p}/><ChevronRight size={17} className="row-chevron"/>
  </button>)}</div>
}
export function Home({ws,projects,open,sorter}:{ws:Workspace;projects:Project[];open:OpenForm;sorter:SortProps}){
  const all=ws.projects.flatMap(p=>p.tasks), dueSoon=[...projects].sort((a,b)=>a.due.localeCompare(b.due))[0]
  return <><PageTitle title="Panel de proyectos" detail="Entregas y objetivos de tu equipo." action={<button className="btn primary" onClick={()=>open({kind:'project'})}><Plus size={18}/>Nuevo proyecto</button>}/>
    <div className="metrics">
      <div className="metric lead"><div><FolderKanban/><span>Proyectos activos</span></div><strong>{projects.length.toString().padStart(2,'0')}</strong><div className="metric-art" aria-hidden="true"><i/><i/><i/></div></div>
      <div className="metric"><div><ListChecks/><span>Objetivos pendientes</span></div><strong>{all.filter(t=>!t.completedAt).length.toString().padStart(2,'0')}</strong></div>
      <div className="metric"><div><CircleCheck/><span>Objetivos completados</span></div><strong>{all.filter(t=>t.completedAt).length.toString().padStart(2,'0')}</strong></div>
    </div>
    <section className="panel"><div className="panel-head"><h2>Proyectos en curso <span className="count-chip">{projects.length}</span></h2><Sorter {...sorter}/></div>
      {projects.length>0?<ProjectRows projects={projects}/>:<Empty icon={<FolderKanban/>} title="Crea el primer proyecto" text="Reúne el repositorio, la fecha de entrega y los primeros objetivos del equipo." action={<button className="btn subtle" onClick={()=>open({kind:'project'})}><Plus size={16}/>Crear proyecto</button>}/>}
    </section>
    {dueSoon&&<section className="next-delivery"><span className="next-icon"><CalendarDays/></span><div><span className="overline">PRÓXIMA ENTREGA</span><h3>{dueSoon.name}</h3></div><strong>{date(dueSoon.due)}</strong><button className="btn subtle" onClick={()=>navigate('proyecto/'+dueSoon.id)}>Ver proyecto</button></section>}
  </>
}

type TaskActions = {ws:Workspace;open:OpenForm;mutate:Mutate}
function TaskRow({t,ws,open,mutate,showProject=false}:{t:Task;showProject?:boolean}&TaskActions){
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const mine=t.people.find(a=>a.user===ws.me.id)
  const owners=t.people.filter(a=>a.state!=='declined')
  const names=owners.map(a=>ws.people.find(p=>p.id===a.user)?.name||a.user)
  const state=taskStatus(t), done=!!t.completedAt || mine?.state==='done'
  const canCheck=mine?.state==='accepted'&&!t.completedAt
  const project=ws.projects.find(p=>p.id===t.projectId)
  async function respond(decision:'accepted'|'declined'){
    setBusy(true);setError('')
    try{await mutate('tasks/'+t.id+'/respond',{decision})}catch(e){setError(message(e))}finally{setBusy(false)}
  }
  return <div className="task-row">
    <label className={'task-check '+(done?'checked':'')} title={canCheck?'Confirmar mi trabajo':done?'Trabajo confirmado':'Solo puede confirmar quien haya aceptado su asignación'}>
      <input type="checkbox" checked={done} disabled={!canCheck} aria-label={'Completar '+t.name} onChange={()=>open({kind:'complete',task:t})}/><span>{done&&<Check size={13}/>}</span>
    </label>
    <div className="task-content"><strong className={t.completedAt?'finished-title':''}>{t.name}</strong>
      <div className="task-meta">{showProject&&project&&<button className="project-link" onClick={()=>navigate('proyecto/'+project.id)}>{project.name}</button>}<span className={'task-state '+(t.completedAt?'done':'')}>{state}</span>
      {mine?.state==='done'&&!t.completedAt&&<span>Mi parte confirmada</span>}
      {owners.length>1&&<span>{owners.filter(a=>a.state==='done').length}/{owners.length} confirmaciones</span>}</div>
      <ErrorBox text={error}/></div>
    <div className="task-owners">{names.length>0&&<Avatar name={names[0]} small/>}<span>{names.join(', ')||'Por reasignar'}</span></div>
    <Urgency value={t.priority}/>
    {mine?.state==='invited'&&!t.completedAt&&<div className="row-actions"><button className="btn mini subtle" disabled={busy} onClick={()=>respond('declined')}>Rechazar</button><button className="btn mini accent" disabled={busy} onClick={()=>respond('accepted')}><Check size={14}/>Aceptar</button></div>}
    {state==='Sin responsable'&&<div className="row-actions"><button className="btn mini subtle" onClick={()=>open({kind:'assign',task:t})}><UserRoundPlus size={14}/>Reasignar</button></div>}
  </div>
}
export function Tasks({tasks,ws,mutate,open,showProject=false,closed=false}:{tasks:Task[];showProject?:boolean;closed?:boolean}&TaskActions){
  const [people,setPeople]=useState<string[]>([]),[urgencies,setUrgencies]=useState<string[]>([]),[status,setStatus]=useState(closed?'todos':'abiertos')
  const matching=tasks.filter(t=>(status==='todos'||(status==='abiertos'?!t.completedAt:!!t.completedAt))&&(!urgencies.length||urgencies.includes(t.priority))&&(!people.length||t.people.some(a=>a.state!=='declined'&&people.includes(a.user))))
  function clear(){setPeople([]);setUrgencies([]);setStatus('todos')}
  return <section className="panel"><div className="panel-head"><h2>{showProject?'Mis asignaciones':'Objetivos'} <span className="count-chip">{tasks.length}</span></h2></div>
    <div className="filters"><Filter size={16} aria-hidden="true"/><MultiPick label="Filtrar por responsables" placeholder="Responsables" options={ws.people} values={people} onChange={setPeople} filter/>
      <MultiPick label="Filtrar por urgencia" placeholder="Urgencia" options={priorities.map(p=>({id:p,name:priorityLabels[p]}))} values={urgencies} onChange={setUrgencies} filter/>
      <select className="status-select" aria-label="Estado del objetivo" value={status} onChange={e=>setStatus(e.target.value)}><option value="abiertos">Pendientes</option><option value="cerrados">Completados</option><option value="todos">Todos los estados</option></select>
      {(people.length>0||urgencies.length>0)&&<button className="text-button" onClick={clear}><X size={14}/>Limpiar</button>}
    </div>
    {matching.length?matching.map(t=><TaskRow key={t.id} t={t} ws={ws} open={open} mutate={mutate} showProject={showProject}/>):<Empty icon={<ListChecks/>} title={tasks.length?'Sin coincidencias':'Aún no tienes objetivos'} text={tasks.length?'Prueba con otros responsables, urgencias o estados.':'Aquí aparecerán las actividades que te asigne el equipo.'} action={tasks.length>0?<button className="text-button" onClick={clear}>Ver todos los objetivos</button>:undefined}/>}
  </section>
}
export function ProjectBoard({p,...actions}:{p:Project}&TaskActions){
  return <><div className="overline page-code"><Folder size={14}/>{projectCode(p.id)}</div><PageTitle title={p.name} action={!p.completedAt&&<button className="btn primary" onClick={()=>actions.open({kind:'task',project:p})}><Plus size={17}/>Nuevo objetivo</button>}/>
    <section className="project-details"><div><span><CalendarDays size={15}/>Entrega</span><strong>{date(p.due)}</strong></div><div><span><GitBranch size={15}/>Repositorio</span><a href={p.repo} target="_blank" rel="noopener noreferrer">{new URL(p.repo).pathname.slice(1)} <ExternalLink size={13}/></a></div><div><span><Layers3 size={15}/>Progreso</span><Progress p={p}/></div></section>
    {p.completedAt&&<div className="archive-note"><Archive size={16}/>Proyecto completado el {date(p.completedAt,true)}</div>}
    <Tasks key={p.completedAt ? 'archivo' : 'activo'} tasks={p.tasks} {...actions} closed={!!p.completedAt}/>
  </>
}
export function History({ws}:{ws:Workspace}){
  const [tab,setTab]=useState('personas'),[people,setPeople]=useState<string[]>([])
  const records=ws.projects.flatMap(p=>p.tasks.flatMap(t=>t.people.filter(a=>a.state==='done'&&(!people.length||people.includes(a.user))).map(a=>({p,t,a})))).sort((a,b)=>b.a.completedAt.localeCompare(a.a.completedAt))
  const archived=ws.projects.filter(p=>p.completedAt).sort((a,b)=>b.completedAt.localeCompare(a.completedAt))
  return <><PageTitle title="Historial" detail="Entregas registradas con su responsable y fecha de confirmación."/>
    <div className="view-tabs"><button aria-pressed={tab==='personas'} onClick={()=>setTab('personas')}><ClipboardCheck size={16}/>Trabajo confirmado</button><button aria-pressed={tab==='proyectos'} onClick={()=>setTab('proyectos')}><Archive size={16}/>Proyectos completados <span className="count-chip">{archived.length}</span></button></div>
    <section className="panel">{tab==='proyectos'?archived.length?<ProjectRows projects={archived}/>:<Empty icon={<Archive/>} title="Todavía no hay proyectos completados" text="Un proyecto pasa aquí al completarse todos sus objetivos."/>:<>
      <div className="panel-head"><h2>Confirmaciones <span className="count-chip">{records.length}</span></h2><MultiPick filter label="Filtrar historial por persona" options={ws.people} values={people} onChange={setPeople} placeholder="Todas las personas"/></div>
      {records.length?records.map(({p,t,a})=><div className="history-row" key={t.id+a.user}><span className="event-icon confirmed"><CheckCheck/></span><div><strong>{t.name}</strong><button className="project-link" onClick={()=>navigate('proyecto/'+p.id)}>{p.name}</button></div><span>{ws.people.find(u=>u.id===a.user)?.name}</span><time dateTime={a.completedAt}>{date(a.completedAt,true)}</time></div>):<Empty icon={<Clock3/>} title="Sin confirmaciones para mostrar" text="Cuando un responsable confirme su trabajo, quedarán aquí su nombre y la fecha."/>}
    </>}</section></>
}
export function Team({ws}:{ws:Workspace}){
  const tasks=ws.projects.flatMap(p=>p.tasks)
  return <><PageTitle title="Equipo" detail="Personas registradas que pueden recibir asignaciones."/><section className="panel"><div className="panel-head"><h2>Integrantes <span className="count-chip">{ws.people.length}</span></h2><UsersRound size={19}/></div>
    {ws.people.map(person=><div className="team-row" key={person.id}><Avatar name={person.name}/><div><strong>{person.name}</strong>{person.id===ws.me.id&&<span className="you-tag">Tú</span>}<small className="member-id">{person.id}</small></div><span className="member-since">Desde {date(person.joinedAt)}</span><span className="team-count">{tasks.filter(t=>t.people.some(a=>a.user===person.id&&a.state==='done')).length} confirmados</span></div>)}
    </section></>
}
export function Notifications({ws,open,mutate}:TaskActions){
  const [history,setHistory]=useState<Feed|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const feed=history??ws.feed
  const invitations=ws.projects.flatMap(p=>p.tasks).filter(t=>t.people.some(a=>a.user===ws.me.id&&a.state==='invited'))
  const log=feed.events
  const newActivity=!!history && (ws.feed.events[0]?.id??0)>(log[0]?.id??0)
  async function older(){setBusy(true);setError('');try{
    const before=log.at(-1)?.id
    if(!before)return
    const res=await get<Feed>('events?before='+before)
    setHistory({events:[...log,...res.events],more:res.more})
  }catch(e){setError(message(e))}finally{setBusy(false)}}
  async function mark(){setBusy(true);setError('');try{await mutate('notifications/read',{through:log[0]?.id})}catch(e){setError(message(e))}finally{setBusy(false)}}
  return <><PageTitle title="Notificaciones" detail="Solicitudes personales y actividad de todo el equipo." action={(log[0]?.id??0)>ws.readThrough&&<button className="btn subtle" onClick={mark} disabled={busy}><CheckCheck size={17}/>Marcar como leídas</button>}/>
    <section className="panel"><div className="panel-head"><h2>Solicitudes para ti <span className="count-chip">{invitations.length}</span></h2><Send size={18}/></div>
    {invitations.length?invitations.map(t=><TaskRow key={t.id} t={t} ws={ws} open={open} mutate={mutate} showProject/>):<p className="inline-empty">Estás al día con tus solicitudes.</p>}</section>
    <section className="panel"><div className="panel-head"><h2>Actividad del equipo</h2>{newActivity?<button className="text-button" onClick={()=>setHistory(null)}>Ver actividad reciente</button>:<Bell size={18}/>}</div><ErrorBox text={error}/>
      {log.map(e=><div className={'event-row '+(e.id>ws.readThrough?'unread':'')} key={e.id}><span className={'event-icon '+e.kind}>{e.kind==='joined'?<UsersRound/>:e.kind==='project'||e.kind==='project_done'?<Folder/>:e.kind==='assigned'?<Send/>:<CheckCheck/>}</span>
        <div><p>{e.message}</p>{e.projectId>0&&<button className="project-link" onClick={()=>navigate('proyecto/'+e.projectId)}>{ws.projects.find(p=>p.id===e.projectId)?.name||'Ver proyecto'}</button>}</div><time dateTime={e.at}>{date(e.at,true)}</time></div>)}
      {feed.more&&<div className="panel-foot"><button className="btn subtle" onClick={older} disabled={busy}>{busy?'Cargando…':'Cargar actividad anterior'}</button></div>}
    </section></>
}

