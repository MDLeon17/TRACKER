import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, Bell, ChevronRight, FolderClosed, FolderKanban, LayoutGrid, ListChecks, LogOut, Menu, Palette, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, UsersRound, X } from 'lucide-react'
import '@fontsource-variable/dm-sans/wght.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './style.css'
import { ApiError, date, get, message, navigate, post, saveSetting, setting, snapshot, sortProjects, themeOptions, type Member, type Session, type SortKey, type Theme, type Workspace } from './data'
import { Avatar, Brand, Dialog, Empty, ErrorBox, ThemePicker } from './ui'
import { Auth } from './Auth'
import { History, Home, Notifications, PageTitle, ProjectBoard, Sorter, Tasks, Team } from './Board'
import { WorkForm, type FormSpec, type Mutate } from './Forms'

const items=[
  {id:'proyectos',name:'Proyectos',icon:LayoutGrid},
  {id:'objetivos',name:'Mis objetivos',icon:ListChecks},
  {id:'notificaciones',name:'Notificaciones',icon:Bell},
  {id:'historial',name:'Historial',icon:Archive},
  {id:'equipo',name:'Equipo',icon:UsersRound},
]
function currentRoute(){return window.location.hash.replace(/^#\/?/,'')||'proyectos'}
function LoadScreen({error,retry}:{error?:string;retry?:()=>void}){
  return <main className="loading-screen"><Brand/>{error?<><ErrorBox text={error}/><button className="btn primary" onClick={retry}><RefreshCw size={16}/>Reintentar</button></>:<p role="status">Cargando el espacio de trabajo…</p>}</main>
}
function Desk({account,checkSession,setLocalTheme}:{account:Member;checkSession:()=>Promise<void>;setLocalTheme:(t:Theme)=>void}){
  const [ws,setWs]=useState<Workspace|null>(null),[loadError,setLoadError]=useState('')
  const tag=useRef(''),serial=useRef(0)
  const [route,setRoute]=useState(currentRoute),[mobileMenu,setMobileMenu]=useState(false),[collapsed,setCollapsed]=useState(false)
  const [form,setForm]=useState<FormSpec|null>(null),[appearance,setAppearance]=useState(false),[themeBusy,setThemeBusy]=useState(false)
  const [alert,setAlert]=useState(''),[themeError,setThemeError]=useState('')
  const menuBtn=useRef<HTMLButtonElement>(null),navRef=useRef<HTMLElement>(null)
  const [sort,setSort]=useState<SortKey>(()=>{const value=setting('sort','due');return value==='recent'||value==='pending'?value:'due'})
  const [asc,setAsc]=useState(()=>setting('direction','asc')==='asc')
  const refresh=useCallback(async(force=false)=>{
    const version=++serial.current
    try{
      const result=await snapshot(force?'':tag.current)
      if(version!==serial.current)return
      if(result){tag.current=result.tag;setWs(result.data);setLocalTheme(result.data.me.theme)}
      setLoadError('')
    }catch(err){
      if(version!==serial.current)return
      if(err instanceof ApiError && err.status===401){await checkSession();return}
      setLoadError(message(err))
    }
  },[checkSession,setLocalTheme])
  useEffect(()=>{
    void refresh(true)
    const tick=()=>{if(document.visibilityState==='visible')void refresh()}
    const timer=window.setInterval(tick,12000)
    window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick)
    return ()=>{serial.current++;window.clearInterval(timer);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick)}
  },[refresh])
  useEffect(()=>{function changed(){setRoute(currentRoute());setMobileMenu(false);setForm(null);window.scrollTo(0,0)}window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[])
  useEffect(()=>{if(!alert)return;const t=window.setTimeout(()=>setAlert(''),4800);return()=>clearTimeout(t)},[alert])
  useEffect(()=>{
    if(!mobileMenu)return
    navRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    function esc(e:KeyboardEvent){if(e.key==='Escape'){setMobileMenu(false);menuBtn.current?.focus()}}
    function wide(){if(window.innerWidth>850)setMobileMenu(false)}
    window.addEventListener('keydown',esc);window.addEventListener('resize',wide)
    return()=>{window.removeEventListener('keydown',esc);window.removeEventListener('resize',wide)}
  },[mobileMenu])
  const mutate:Mutate=async <T,>(path:string,body:unknown={},requestKey?:string)=>{
    try{const result=await post<T>(path,body,requestKey);await refresh(true);return result}
    catch(err){if(err instanceof ApiError&&err.status===401)await checkSession();throw err}
  }
  async function logout(){try{await post('logout');await checkSession()}catch(err){setAlert(message(err))}}
  async function pickTheme(t:Theme){if(themeBusy)return;setThemeBusy(true);setThemeError('');try{await mutate('theme',{theme:t});setLocalTheme(t);setAppearance(false)}catch(err){setThemeError(message(err))}finally{setThemeBusy(false)}}
  if(!ws)return <LoadScreen error={loadError} retry={()=>void refresh(true)}/>
  const projectId=route.startsWith('proyecto/')?Number(route.split('/')[1]):0
  const selected=ws.projects.find(p=>p.id===projectId)
  const section=projectId?'proyectos':route
  const heading=items.find(i=>i.id===section)?.name||'Proyectos'
  const projects=sortProjects(ws.projects.filter(p=>!p.completedAt),sort,asc)
  function selectSort(v:SortKey){setSort(v);saveSetting('sort',v);const direction=v==='due';setAsc(direction);saveSetting('direction',direction?'asc':'desc')}
  function toggleSort(){setAsc(!asc);saveSetting('direction',asc?'desc':'asc')}
  const sorter={sort,asc,onSort:selectSort,onDirection:toggleSort}
  function go(path:string){setMobileMenu(false);navigate(path)}
  function openNew(){setMobileMenu(false);setForm({kind:'project'})}
  function themes(){setThemeError('');setAppearance(true);setMobileMenu(false)}
  const actions={ws,open:setForm,mutate}
  return <div className={'app-shell'+(collapsed?' collapsed':'')+(mobileMenu?' mobile-open':'')}>
    {mobileMenu&&<button className="mobile-scrim" aria-label="Cerrar menú" onClick={()=>setMobileMenu(false)}/>}
    <aside className="sidebar" ref={navRef} aria-label="Navegación lateral">
      <div className="side-brand"><button className="brand-link" onClick={()=>go('proyectos')} aria-label="Relevo, inicio"><Brand/></button><button className="icon-btn mobile-close" aria-label="Cerrar menú" onClick={()=>setMobileMenu(false)}><X size={18}/></button></div>
      <div className="side-content"><div className="side-label">ESPACIO DE TRABAJO</div><nav className="side-nav">{items.map(i=><button key={i.id} className={section===i.id?'active':''} aria-current={section===i.id?'page':undefined} onClick={()=>go(i.id)}><i.icon size={18}/><span>{i.name}</span>{i.id==='notificaciones'&&ws.unread>0&&<b>{ws.unread>99?'99+':ws.unread}</b>}</button>)}</nav>
      <div className="side-divider"/><div className="side-project-head"><span className="side-label">PROYECTOS ACTIVOS</span><button className="side-add" aria-label="Agregar nuevo proyecto" title="Nuevo proyecto" onClick={openNew}><Plus size={17}/></button></div>
      <div className="side-sort"><Sorter {...sorter}/></div><div className="side-projects">{projects.map(p=><button key={p.id} className={selected?.id===p.id?'selected':''} onClick={()=>go('proyecto/'+p.id)}><FolderClosed size={15}/><span>{p.name}</span></button>)}{!projects.length&&<p>Aún no hay proyectos activos.</p>}</div></div>
      <div className="side-bottom"><button onClick={themes}><Palette size={17}/>Apariencia</button><div className="side-identity"><Avatar name={account.name}/><div><strong>{account.name}</strong><span>Miembro del equipo</span></div><button aria-label="Cerrar sesión" title="Cerrar sesión" onClick={logout}><LogOut size={17}/></button></div></div>
    </aside>
    <div className="main-shell" inert={mobileMenu||undefined}>
      <header className="topbar"><button className="icon-btn desktop-menu" aria-label={collapsed?'Mostrar barra lateral':'Ocultar barra lateral'} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button>
        <button ref={menuBtn} className="icon-btn mobile-menu" aria-label="Abrir menú" onClick={()=>setMobileMenu(true)}><Menu size={20}/></button>
        <div className="breadcrumbs"><span>Espacio de trabajo</span><ChevronRight size={13}/><strong>{heading}</strong></div>
        <div className="top-actions"><time>{date(new Date().toLocaleDateString('sv-SE'))}</time><span className="top-divider"/><button className="icon-btn bell" aria-label={'Notificaciones, '+ws.unread+' sin leer'} title="Notificaciones" onClick={()=>go('notificaciones')}><Bell size={19}/>{ws.unread>0&&<i/>}</button><button className="account-link" title="Ver equipo" aria-label="Ver equipo" onClick={()=>go('equipo')}><Avatar small name={account.name}/></button></div>
      </header>
      <main className="content" id="contenido">
        {loadError&&<div role="alert" className="connection-alert">{loadError}<button className="text-button" onClick={()=>void refresh(true)}>Reintentar</button></div>}
        {selected?<ProjectBoard key={selected.id} p={selected} {...actions}/>:projectId?<Empty title="Proyecto desconocido" action={<button className="btn subtle" onClick={()=>go('proyectos')}>Ver proyectos</button>}/>:section==='objetivos'?<>
          <PageTitle title="Mis objetivos" detail="Tus solicitudes, trabajo en curso y confirmaciones."/><Tasks key="mine" tasks={ws.projects.flatMap(p=>p.tasks).filter(t=>t.people.some(a=>a.user===ws.me.id&&a.state!=='declined'))} showProject {...actions}/></>:section==='notificaciones'?<Notifications {...actions}/>:section==='historial'?<History ws={ws}/>:section==='equipo'?<Team ws={ws}/>:<Home ws={ws} projects={projects} open={setForm} sorter={sorter}/>}
      </main>
    </div>
    {form&&<WorkForm spec={form} ws={ws} mutate={mutate} onClose={()=>setForm(null)} onSaved={(msg,id)=>{setForm(null);setAlert(msg);if(id)go('proyecto/'+id)}}/>}
    {appearance&&<Dialog title="Apariencia" busy={themeBusy} onClose={()=>setAppearance(false)}><div className="dialog-body"><p className="form-help">El tema se guarda en tu cuenta.</p><fieldset disabled={themeBusy}><ThemePicker value={ws.me.theme} onChoose={pickTheme}/></fieldset><ErrorBox text={themeError}/></div></Dialog>}
    {alert&&<div className="toast" role="status">{alert}<button aria-label="Cerrar aviso" onClick={()=>setAlert('')}><X size={15}/></button></div>}
  </div>
}
function App(){
  const [session,setSession]=useState<Session|null>(null),[error,setError]=useState('')
  const [theme,setTheme]=useState<Theme>(()=>{const s=setting('theme','papel');return themeOptions.some(t=>t.id===s)?s as Theme:'papel'})
  const apply=useCallback((t:Theme)=>{document.documentElement.dataset.theme=t;setTheme(t);saveSetting('theme',t)},[])
  const check=useCallback(async()=>{
    try{const s=await get<Session>('session');setSession(s);setError('');if(s.me)apply(s.me.theme)}
    catch(e){setError(message(e));throw e}
  },[apply])
  useEffect(()=>{document.documentElement.dataset.theme=theme},[theme])
  useEffect(()=>{void check().catch(()=>{})},[check])
  if(!session||error)return <LoadScreen error={error} retry={()=>void check().catch(()=>{})}/>
  return session.me?<Desk key={session.me.id} account={session.me} setLocalTheme={apply} checkSession={check}/>:<Auth session={session} theme={theme} onTheme={apply} onEnter={check}/>
}
createRoot(document.getElementById('root')!).render(<App/>)

