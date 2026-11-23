import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Circle, Layers3, X } from 'lucide-react'
import { initials, priorityLabels, type Priority, themeOptions, type Theme } from './data'

export function Brand() {
  return <span className="brand"><img src="/favicon.svg" alt="" width="39" height="39"/><span>relevo<span className="brand-dot">.</span></span></span>
}
export function Avatar({name,small=false}:{name:string;small?:boolean}) {
  const color = [...name].reduce((n,c)=>n+c.codePointAt(0)!,0)%5
  return <span aria-hidden="true" className={'avatar avatar-'+color+(small?' small':'')}>{initials(name)}</span>
}
export function Urgency({value}:{value:Priority}) {
  return <span className={'urgency '+value}><i aria-hidden="true"><b/><b/><b/></i>{priorityLabels[value]}</span>
}
export function Empty({icon, title, text, action}:{icon?:ReactNode; title:string; text?:string; action?:ReactNode}) {
  return <div className="empty"><div className="empty-icon">{icon || <Layers3/>}</div><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>
}
export function ErrorBox({text}:{text:string}) { return text ? <p className="error-box" role="alert">{text}</p> : null }
export function Dialog({title,children,onClose,busy=false,wide=false}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null)
  const label=useId()
  useEffect(()=>{ const d=ref.current!; d.showModal(); return ()=>d.close() },[])
  return <dialog className={'dialog'+(wide?' wide':'')} ref={ref} aria-labelledby={label}
    onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
    <div className="dialog-head"><h2 id={label}>{title}</h2><button type="button" className="icon-btn" title="Cerrar" aria-label="Cerrar" disabled={busy} onClick={onClose}><X size={19}/></button></div>
    {children}
  </dialog>
}
type Choice = {id:string;name:string}
export function MultiPick({label,options,values,onChange,placeholder='Seleccionar',filter=false}:{label:string;options:Choice[];values:string[];onChange:(v:string[])=>void;placeholder?:string;filter?:boolean}) {
  const [open,setOpen]=useState(false)
  const ref=useRef<HTMLDivElement>(null)
  const id=useId()
  useEffect(()=>{
    if(!open)return
    function click(e:PointerEvent){ if(!ref.current?.contains(e.target as Node))setOpen(false) }
    function key(e:KeyboardEvent){ if(e.key==='Escape' && ref.current?.contains(document.activeElement)){ e.preventDefault();setOpen(false);ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown',click);document.addEventListener('keydown',key)
    return ()=>{document.removeEventListener('pointerdown',click);document.removeEventListener('keydown',key)}
  },[open])
  const names=options.filter(o=>values.includes(o.id)).map(o=>o.name)
  return <div className={'picker'+(filter?' filter-picker':'')} ref={ref}>
    <button className={'select-button'+(values.length?' has-value':'')} type="button" aria-expanded={open} aria-controls={id} aria-label={label+' · '+(names.join(', ')||placeholder)} onClick={()=>setOpen(!open)}>
      <span>{names.length===0?placeholder:names.length===1?names[0]:names.length+' seleccionados'}</span><ChevronDown size={15}/>
    </button>
    {open && <fieldset id={id} className="pick-menu"><legend className="sr-only">{label}</legend>
      {options.length===0 && <span className="muted">Aún no hay personas registradas.</span>}
      {options.map(o=><label key={o.id}><input type="checkbox" checked={values.includes(o.id)} onChange={e=>onChange(e.target.checked?[...values,o.id]:values.filter(v=>v!==o.id))}/><span>{o.name}</span></label>)}
      <button type="button" className="text-button pick-done" onClick={()=>setOpen(false)}><Check size={14}/> Listo</button>
    </fieldset>}
  </div>
}
export function ThemePicker({value,onChoose}:{value:Theme;onChoose:(t:Theme)=>void}) {
  return <div className="theme-options" aria-label="Tema de la aplicación">{themeOptions.map(t=><button type="button" key={t.id} onClick={()=>onChoose(t.id)} aria-pressed={value===t.id} className={'theme-option '+(value===t.id?'selected':'')}>
    <span className={'theme-swatch '+t.id}><i/><i/><i/></span><span>{t.name}</span>{value===t.id?<Check size={15}/>:<Circle size={13}/>}
  </button>)}</div>
}

