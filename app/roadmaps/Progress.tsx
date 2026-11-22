"use client";
import Link from "next/link";
import {useSyncExternalStore} from "react";
import {parse,readLocal,subscribeLocal} from "@/lib/learning/local";
import {pathProgress} from "@/lib/paths/progress";
import type {Stage} from "@/lib/roadmaps";
export function Progress({stages,signedIn}:{stages:Stage[];signedIn:boolean}){
 const raw=useSyncExternalStore(subscribeLocal,readLocal,()=>"{}"),local=parse(raw);
 const results=stages.map(stage=>({stage,progress:pathProgress(stage.lessons.map(lesson=>signedIn?lesson:{...lesson,status:local.watched[lesson.resource_id]?"watched":local.progress[lesson.resource_id]?.status??null}))}));
 const completed=results.filter(r=>r.progress.completed&&r.stage.hidden===0).length;
 return <section aria-label="Roadmap progress">
 <p>{completed} of {stages.length} stages watched.</p>
 <div className="progress" role="progressbar" aria-label="Stages watched" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stages.length?Math.round(completed/stages.length*100):0}><span style={{width:`${stages.length?completed/stages.length*100:0}%`}}/></div>
 {!signedIn&&<p className="muted">Progress is saved in this browser.</p>}
 <ol className="roadmap-stages">{results.map(({stage,progress})=><li key={stage.position}>
 <p className="kicker">Stage {stage.position+1}</p>
 <h2>{stage.listId?<Link href={`/lists/${stage.listId}`}>{stage.title}</Link>:stage.title}</h2>
 {stage.listId?<><p>{progress.watched} of {progress.total} available lessons watched{progress.skipped?`, ${progress.skipped} skipped`:""}.</p>
 {stage.hidden>0&&<p className="muted">{stage.hidden} lessons hidden by your rules. This stage is not counted complete.</p>}
 <Link className="button outline small" href={`/lists/${stage.listId}`}>{progress.completed&&stage.hidden===0?"Review stage":"Open stage"}</Link></>:<p className="muted">This path was removed or is no longer shared with you.</p>}
 </li>)}</ol></section>;
}
