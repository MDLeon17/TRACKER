import { useState, type FormEvent } from 'react'
import { Check, CheckCheck, Eye, EyeOff, Fingerprint, GitBranch, GitPullRequest, Laptop, Palette, Send, UserRoundCheck } from 'lucide-react'
import { type Session, type Theme, post, message } from './data'
import { Brand, Dialog, ErrorBox, ThemePicker } from './ui'

function Workflow() {
  return <section className="auth-story" aria-label="Cómo funciona Relevo">
    <div className="story-grid" aria-hidden="true"/><Brand/>
    <div className="story-main"><div className="overline"><GitBranch size={15}/> FLUJO DE TRABAJO</div>
      <h1>De la asignación<br/>a la <em>entrega.</em></h1>
      <div className="flow-diagram">
        <div className="flow-node"><span className="node-icon"><Send size={19}/></span><div><strong>Objetivo asignado</strong><small>El responsable recibe una solicitud</small></div><span className="node-end"><GitPullRequest size={16}/></span></div>
        <div className="flow-connector" aria-hidden="true"/>
        <div className="flow-node second"><span className="node-icon"><UserRoundCheck size={20}/></span><div><strong>Asignación aceptada</strong><small>El objetivo pasa a estar en curso</small></div><span className="node-end"><Check size={16}/></span></div>
        <div className="flow-connector second" aria-hidden="true"/>
        <div className="flow-node current"><span className="node-icon"><CheckCheck size={21}/></span><div><strong>Trabajo confirmado</strong><small>El historial registra quién y cuándo</small></div><span className="node-end"><Check size={16}/></span></div>
      </div>
    </div>
    <div className="story-foot"><span className="pulse"/><span>Seguimiento de proyectos de software</span></div>
  </section>
}
export function Auth({session,theme,onTheme,onEnter}:{session:Session;theme:Theme;onTheme:(v:Theme)=>void;onEnter:()=>Promise<void>}) {
  const [mode,setMode]=useState<'login'|'register'>(session.linkedName?'login':'register')
  const [name,setName]=useState(session.linkedName)
  const [password,setPassword]=useState('')
  const [show,setShow]=useState(false)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [appearance,setAppearance]=useState(false)
  function switchMode(next:'login'|'register') { setMode(next);setPassword('');setError('');setShow(false) }
  async function submit(e:FormEvent) {
    e.preventDefault();if(busy)return
    setError('');setBusy(true)
    try { await post(mode,{name:name.trim(),password,...(mode==='register'?{theme}:{})}); await onEnter() }
    catch(err){setError(message(err))} finally {setBusy(false)}
  }
  return <main className="auth-page">
    <Workflow/>
    <section className="auth-side">
      <div className="auth-tools"><div className="mobile-brand"><Brand/></div><button className="icon-btn" aria-label="Cambiar apariencia" title="Apariencia" onClick={()=>setAppearance(true)}><Palette size={19}/></button></div>
      <div className="auth-form-wrap">
        <div className="overline auth-kicker"><span className="mini-rule"/> ESPACIO DE TRABAJO</div>
        <h2>{mode==='register'?'Únete al equipo':'Inicia sesión'}</h2>
        <p className="auth-intro">{mode==='register'?'Crea tu cuenta para asignar objetivos y registrar tus entregas.':'Accede a tus proyectos y a las asignaciones del equipo.'}</p>
        {!session.linkedName && <div className="segment" aria-label="Acceso a Relevo">
          <button type="button" aria-pressed={mode==='register'} onClick={()=>switchMode('register')}>Crear cuenta</button>
          <button type="button" aria-pressed={mode==='login'} onClick={()=>switchMode('login')}>Iniciar sesión</button>
        </div>}
        <form onSubmit={submit} className="stack-form">
          <label className="field"><span>{mode==='login'&&!session.linkedName?'Nombre o ID de usuario':'Nombre de usuario'}</span>
            <input required autoComplete="username" readOnly={!!session.linkedName} minLength={2} maxLength={64} placeholder="Tu nombre en el equipo" value={name} onChange={e=>setName(e.target.value)}/></label>
          <label className="field"><span>Contraseña</span><span className="password-field">
            <input required autoComplete={mode==='register'?'new-password':'current-password'} minLength={mode==='register'?10:1} value={password} type={show?'text':'password'} placeholder={mode==='register'?'Al menos 10 caracteres':'Tu contraseña'} onChange={e=>setPassword(e.target.value)}/>
            <button className="icon-btn" type="button" title={show?'Ocultar contraseña':'Mostrar contraseña'} aria-label={show?'Ocultar contraseña':'Mostrar contraseña'} aria-pressed={show} onClick={()=>setShow(!show)}>{show?<EyeOff size={17}/>:<Eye size={17}/>}</button></span></label>
          <ErrorBox text={error}/>
          <button className="btn primary full" disabled={busy}>{busy?'Conectando…':mode==='register'?'Crear mi cuenta':'Entrar al tablero'}</button>
        </form>
        <div className="device-note"><Fingerprint size={22}/><div><strong>Cuenta vinculada al navegador</strong><p>{session.linkedName?'Este perfil recuerda tu nombre. Usa tu contraseña para entrar.':'Puedes usar tu nombre y contraseña para acceder desde otro equipo.'}</p></div></div>
      </div>
      <div className="device-foot"><Laptop size={15}/> Dispositivo <span>{session.deviceCode}</span></div>
    </section>
    {appearance && <Dialog title="Apariencia" onClose={()=>setAppearance(false)}><div className="dialog-body"><ThemePicker value={theme} onChoose={onTheme}/></div></Dialog>}
  </main>
}

