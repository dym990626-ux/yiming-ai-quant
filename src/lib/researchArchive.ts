import type { IntervalId, SymbolId } from '../types'

export type ResearchSnapshot={id:string;createdAt:number;symbol:SymbolId;interval:IntervalId;source:string;price:number;decision:string;risk:string;evidence:string[]}
const key='yiming-research-snapshots-v1'
export const readSnapshots=():ResearchSnapshot[]=>{try{return JSON.parse(localStorage.getItem(key)??'[]')}catch{return[]}}
export const saveSnapshot=(snapshot:ResearchSnapshot)=>localStorage.setItem(key,JSON.stringify([snapshot,...readSnapshots()].slice(0,30)))
export const deleteSnapshot=(id:string)=>localStorage.setItem(key,JSON.stringify(readSnapshots().filter(x=>x.id!==id)))
