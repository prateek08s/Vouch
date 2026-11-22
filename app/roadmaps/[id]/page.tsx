import Link from "next/link";
import {Suspense} from "react";
import {notFound} from "next/navigation";
import {getCurrentUser} from "@/lib/server/session";
import {getDb} from "@/lib/server/db";
import {UUID} from "@/lib/server/form";
import {roadmapDetail,roadmapChoices} from "@/lib/roadmaps";
import {Editor} from "../Editor";
import {Progress} from "../Progress";
import {deleteRoadmapAction} from "../actions";
export const metadata={title:"Learning roadmap"};
export default function Page(props:PageProps<"/roadmaps/[id]">){return <Suspense fallback={<p>Loading roadmap…</p>}><Content {...props}/></Suspense>;}
async function Content({params}:PageProps<"/roadmaps/[id]">){
 const {id}=await params;if(!UUID.test(id))notFound();
 const user=await getCurrentUser(),db=await getDb(),view=await roadmapDetail(db,user?.id??null,id);
 if(!view)notFound();
 const owned=user?.id===view.roadmap.owner_id;
 const choices=owned?await roadmapChoices(db,user!.id):[];
 return <><header className="page-head"><Link href="/roadmaps">Learning roadmaps</Link><h1>{view.roadmap.title}</h1><p>{view.roadmap.description}</p>{!view.roadmap.is_public&&<span className="pill quiet">Private</span>}</header>
 <Progress stages={view.stages} signedIn={!!user}/>
 {owned&&<><details className="path-editor"><summary>Edit roadmap</summary><Editor choices={choices} roadmap={view.roadmap} initial={view.stages.map(s=>s.listId??"")}/></details>
 <form action={deleteRoadmapAction}><input type="hidden" name="id" value={id}/><button className="button quiet">Delete roadmap</button></form></>}</>;
}
