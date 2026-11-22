"use client";
import { startTransition,useActionState,useState } from "react";
import { saveRoadmapAction } from "./actions";
import type { Roadmap } from "@/lib/roadmaps";
export function Editor({choices,roadmap,initial=[]}:{choices:{id:string;title:string;is_public:boolean}[];roadmap?:Roadmap;initial?:string[]}){
 const [stages,setStages]=useState(initial.length?initial:[""]);
 const [state,action,pending]=useActionState(saveRoadmapAction,{});
 function move(index:number,offset:number){setStages(old=>{const next=[...old];[next[index],next[index+offset]]=[next[index+offset],next[index]];return next;});}
 return <form className="form roadmap-editor" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);startTransition(()=>action(form));}}>
 {roadmap && <input type="hidden" name="id" value={roadmap.id}/>}
 <label>Title<input name="title" required maxLength={120} defaultValue={roadmap?.title??""}/></label>
 <label>Goal<textarea name="description" maxLength={1000} rows={3} defaultValue={roadmap?.description??""}/></label>
 <label className="check"><input type="checkbox" name="public" defaultChecked={roadmap?.is_public??false}/>Make this roadmap public</label>
 <p className="muted">Arrange up to 20 paths. Public roadmaps require public paths. Learners can open any stage.</p>
 {stages.map((value,index)=><div className="roadmap-stage-editor" key={index}>
 <label>Stage {index+1}<select name="stage" value={value} required onChange={e=>setStages(old=>old.map((v,i)=>i===index?e.target.value:v))}>
 <option value="">Choose a learning path</option>
 {value && !choices.some(c=>c.id===value) && <option value={value}>Unavailable path, choose a replacement</option>}
 {choices.map(c=><option key={c.id} value={c.id}>{c.title}{c.is_public?"":" (private)"}</option>)}
 </select></label>
 <div className="actions"><button type="button" className="button quiet small" disabled={index===0||pending} onClick={()=>move(index,-1)} aria-label={`Move stage ${index+1} up`}>Up</button>
 <button type="button" className="button quiet small" disabled={index===stages.length-1||pending} onClick={()=>move(index,1)} aria-label={`Move stage ${index+1} down`}>Down</button>
 <button type="button" className="button quiet small" disabled={pending||stages.length===1} onClick={()=>setStages(old=>old.filter((_,i)=>i!==index))} aria-label={`Remove stage ${index+1}`}>Remove</button></div>
 </div>)}
 <div className="actions"><button type="button" className="button outline small" disabled={pending||stages.length>=20} onClick={()=>setStages(old=>[...old,""])}>Add stage</button>
 <button className="button" disabled={pending}>{pending?"Saving…":"Save roadmap"}</button></div>
 {state.error && <p role="alert" className="error">{state.error}</p>}
 </form>;
}
