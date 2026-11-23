export type Theme = 'papel' | 'grafito' | 'oceano'
export type Priority = 'alta' | 'media' | 'baja'
export type AssignmentState = 'invited' | 'accepted' | 'declined' | 'done'
export type Member = { id: string; name: string; theme: Theme }
export type Person = { id: string; name: string; joinedAt: string }
export type Assignment = { user: string; state: AssignmentState; completedAt: string }
export type Task = { id: number; projectId: number; name: string; priority: Priority; createdAt: string; completedAt: string; people: Assignment[] }
export type Project = { id: number; name: string; due: string; repo: string; createdAt: string; completedAt: string; tasks: Task[] }
export type TeamEvent = { id: number; kind: string; actor: string; projectId: number; taskId: number; message: string; at: string }
export type Feed = { events: TeamEvent[]; more: boolean }
export type Workspace = { me: Member; people: Person[]; projects: Project[]; feed: Feed; readThrough: number; unread: number }
export type Session = { me: Member | null; linkedName: string; deviceCode: string }
export type DraftTask = { name: string; priority: Priority; people: string[] }
export type SortKey = 'recent' | 'due' | 'pending'
export const priorities: Priority[] = ['alta', 'media', 'baja']
export const priorityLabels = { alta: 'Alta', media: 'Media', baja: 'Baja' }
export const themeOptions: { id: Theme; name: string }[] = [{id:'papel',name:'Papel'},{id:'grafito',name:'Grafito'},{id:'oceano',name:'Océano'}]
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
async function failure(response: Response): Promise<never> {
  let detail = 'No se pudo conectar con el servidor. Inténtalo de nuevo.'
  try { const body = await response.json(); if (typeof body.error === 'string') detail = body.error } catch { /* No JSON from upstream. */ }
  throw new ApiError(detail, response.status)
}
export async function get<T>(path: string): Promise<T> {
  const r = await fetch('/api/' + path, {cache:'no-store'})
  if (!r.ok) return failure(r)
  return r.json()
}
export async function post<T = {ok:boolean}>(path: string, data: unknown = {}, requestKey?:string): Promise<T> {
  const r = await fetch('/api/' + path,{method:'POST',headers:{'Content-Type':'application/json',...(requestKey?{'Idempotency-Key':requestKey}:{})},body:JSON.stringify(data)})
  if (!r.ok) return failure(r)
  return r.json()
}
export async function snapshot(tag: string): Promise<{data: Workspace; tag: string} | null> {
  const r = await fetch('/api/workspace',{cache:'no-store',headers:tag ? {'If-None-Match':tag} : {}})
  if (r.status === 304) return null
  if (!r.ok) return failure(r)
  return { data:await r.json(), tag:r.headers.get('etag') || '' }
}
export function message(err: unknown) {
  return err instanceof ApiError ? err.message : 'Se interrumpió la conexión. Vuelve a intentarlo.'
}
export function setting(key: string, fallback: string) {
  try { return localStorage.getItem('relevo.' + key) || fallback } catch { return fallback }
}
export function saveSetting(key:string, value:string) {
  try { localStorage.setItem('relevo.' + key,value) } catch { /* Theme still applies to this tab. */ }
}
export function initials(name:string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length-1][0] : '')).toLocaleUpperCase('es')
}
export function date(value:string, withTime=false) {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? value + 'T12:00:00' : value)
  return d.toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric',...(withTime ? {hour:'2-digit',minute:'2-digit'} : {})})
}
export function projectCode(id:number) { return 'PR-' + String(id).padStart(3,'0') }
export function pending(p:Project) { return p.tasks.filter(t=>!t.completedAt).length }
export function sortProjects(projects:Project[], key:SortKey, asc:boolean) {
  return [...projects].sort((a,b)=>{
    const cmp = key==='due' ? a.due.localeCompare(b.due) : key==='pending' ? pending(a)-pending(b) : a.createdAt.localeCompare(b.createdAt)
    return (cmp || a.id-b.id)*(asc?1:-1)
  })
}
export function taskStatus(t:Task) {
  if (t.completedAt) return 'Completado'
  if (t.people.every(a=>a.state==='declined')) return 'Sin responsable'
  if (t.people.some(a=>a.state==='invited')) return 'Por aceptar'
  return 'En curso'
}
export function navigate(path:string) { window.location.hash = '/' + path }

