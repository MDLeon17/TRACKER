import { useState, type FormEvent } from 'react'
import { CheckCheck, Fingerprint, Plus, Trash2 } from 'lucide-react'
import { type Workspace, type DraftTask, type Task, type Project, type Priority, priorityLabels, priorities, message } from './data'
import { Dialog, ErrorBox, MultiPick } from './ui'

export type FormSpec = {kind:'project'} | {kind:'task';project:Project} | {kind:'complete'|'assign';task:Task}
export type Mutate = <T = {ok:boolean}>(path:string,data?:unknown,requestKey?:string)=>Promise<T>
export function WorkForm({spec,ws,mutate,onClose,onSaved}:{spec:FormSpec;ws:Workspace;mutate:Mutate;onClose:()=>void;onSaved:(msg:string,project?:number)=>void}) {
  const [requestKey]=useState(()=>crypto.randomUUID())
  const fresh=():DraftTask=>({name:'',priority:'media',people:[ws.me.id]})
  const [rows,setRows]=useState<DraftTask[]>([fresh()])
  const [name,setName]=useState(''),[due,setDue]=useState(''),[repo,setRepo]=useState('')
  const [password,setPassword]=useState(''),[people,setPeople]=useState<string[]>([])
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const title=spec.kind==='project'?'Nuevo proyecto':spec.kind==='task'?'Nuevo objetivo':spec.kind==='assign'?'Reasignar objetivo':'Confirmar trabajo'
  const submitLabel=spec.kind==='project'?'Crear proyecto':spec.kind==='task'?'Agregar objetivo':spec.kind==='assign'?'Asignar objetivo':'Confirmar con contraseña'
  function updateRow(i:number,values:Partial<DraftTask>) { setRows(old=>old.map((r,k)=>i===k?{...r,...values}:r)) }
  async function submit(e:FormEvent){
    e.preventDefault();if(busy)return
    setError('')
    if((spec.kind==='project'||spec.kind==='task')&&rows.some(r=>!r.people.length)){setError('Selecciona al menos un responsable para cada objetivo.');return}
    if(spec.kind==='assign'&&!people.length){setError('Selecciona al menos un responsable.');return}
    setBusy(true)
    try {
      if(spec.kind==='project'){
        const result=await mutate<{id:number}>('projects',{name,due,repo,tasks:rows},requestKey)
        onSaved('Proyecto creado.',result.id)
      } else if(spec.kind==='task'){
        await mutate('projects/'+spec.project.id+'/tasks',rows[0],requestKey);onSaved('Objetivo agregado.')
      } else if(spec.kind==='assign'){
        await mutate('tasks/'+spec.task.id+'/assign',{people});onSaved('Asignación guardada.')
      } else {
        await mutate('tasks/'+spec.task.id+'/complete',{password});onSaved('Tu confirmación quedó en el historial.')
      }
    }catch(err){setError(message(err))}finally{setBusy(false)}
  }
  return <Dialog title={title} onClose={onClose} busy={busy} wide={spec.kind==='project'}>
    <form onSubmit={submit}><fieldset disabled={busy} className="form-fields"><div className="dialog-body form-body">
      {spec.kind==='project' && <>
        <label className="field"><span>Nombre del proyecto</span><input autoFocus required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Portal de clientes"/></label>
        <div className="two-fields date-repo"><label className="field"><span>Fecha de entrega</span><input type="date" required value={due} onChange={e=>setDue(e.target.value)}/></label>
        <label className="field"><span>Repositorio</span><input required type="url" maxLength={512} value={repo} onChange={e=>setRepo(e.target.value)} placeholder="https://github.com/equipo/proyecto"/></label></div>
        <div className="section-label"><h3>Objetivos iniciales</h3><span className="count-chip">{rows.length}</span></div>
      </>}
      {spec.kind==='task' && <p className="context-label">Proyecto <strong>{spec.project.name}</strong></p>}
      {(spec.kind==='project'||spec.kind==='task') && <>
        {rows.map((row,i)=><div key={i} className={spec.kind==='project'?'draft-row':'draft-plain'}>
          <div className="draft-title"><label className="field"><span>{spec.kind==='project'?'Objetivo '+(i+1):'Nombre del objetivo'}</span><input required maxLength={180} value={row.name} onChange={e=>updateRow(i,{name:e.target.value})} placeholder="¿Qué se necesita completar?"/></label>
          {rows.length>1&&<button type="button" className="icon-btn" onClick={()=>setRows(old=>old.filter((_,k)=>k!==i))} title={'Quitar objetivo '+(i+1)} aria-label={'Quitar objetivo '+(i+1)}><Trash2 size={17}/></button>}</div>
          <div className="two-fields"><div className="field"><span>Responsables</span><MultiPick label={'Responsables del objetivo '+(i+1)} options={ws.people} values={row.people} onChange={people=>updateRow(i,{people})} placeholder="Elegir personas"/></div>
          <label className="field"><span>Urgencia</span><select value={row.priority} onChange={e=>updateRow(i,{priority:e.target.value as Priority})}>{priorities.map(p=><option key={p} value={p}>{priorityLabels[p]}</option>)}</select></label></div>
        </div>)}
        {spec.kind==='project'&&rows.length<50&&<button type="button" className="btn subtle fit" onClick={()=>setRows([...rows,fresh()])}><Plus size={16}/> Otro objetivo</button>}
        <p className="form-help">Cada persona que elijas recibirá una solicitud. Tus propias asignaciones se aceptan al guardar.</p>
      </>}
      {spec.kind==='assign'&&<><p className="context-label">Objetivo <strong>{spec.task.name}</strong></p><div className="field"><span>Responsables</span><MultiPick label="Nuevos responsables" options={ws.people} values={people} onChange={setPeople} placeholder="Elegir personas"/></div></>}
      {spec.kind==='complete'&&<><div className="confirm-task"><CheckCheck size={22}/><strong>{spec.task.name}</strong></div>
        <p className="form-help">El historial guardará tu nombre y la fecha de confirmación.{spec.task.people.filter(a=>a.state!=='declined').length>1?' Cada responsable confirma su parte por separado.':''}</p>
        <label className="field"><span>Tu contraseña</span><input type="password" required autoFocus autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Ingresa tu contraseña"/></label></>}
      <ErrorBox text={error}/>
    </div><div className="dialog-foot"><button type="button" className="btn subtle" onClick={onClose}>Cancelar</button><button className="btn primary" type="submit">{spec.kind==='complete'?<Fingerprint size={16}/>:<Plus size={16}/>}{busy?'Guardando…':submitLabel}</button></div></fieldset></form>
  </Dialog>
}

