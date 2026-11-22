import Link from "next/link";
import {Suspense} from "react";
import {getCurrentUser} from "@/lib/server/session";
import {getDb} from "@/lib/server/db";
import {roadmapsFor,roadmapChoices} from "@/lib/roadmaps";
import {Editor} from "./Editor";
export const metadata={title:"Learning roadmaps"};
export default function Page(){return <><header className="page-head"><h1>Learning roadmaps</h1><p>Connect learning paths into a sequence toward your goal.</p></header><Suspense fallback={<p>Loading roadmaps…</p>}><Content/></Suspense></>;}
async function Content(){
 const user=await getCurrentUser(),db=await getDb();
 const [maps,choices]=await Promise.all([roadmapsFor(db,user?.id??null),user?roadmapChoices(db,user.id):Promise.resolve([])]);
 return <><Link href="/paths">Browse learning paths</Link>
 {maps.length?<ul className="rows">{maps.map(m=><li key={m.id}><div><h2><Link href={`/roadmaps/${m.id}`}>{m.title}</Link></h2><p>{m.description}</p>{!m.is_public&&<span className="pill quiet">Private</span>}</div></li>)}</ul>:<p className="empty">No roadmaps shared here yet.</p>}
 {user?<section className="section"><h2>Create a roadmap</h2>{choices.length?<Editor choices={choices}/>:<p>Create a learning path in <Link href="/lists">Collections</Link> first.</p>}</section>:<p><Link href="/signin">Sign in</Link> to build a roadmap.</p>}</>;
}
