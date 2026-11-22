import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { openPglite } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { createList } from "@/lib/lists";
import { savePath } from "@/lib/paths";
import { roadmapDetail } from "@/lib/roadmaps";
const context=vi.hoisted(()=>({user:null as null|{id:string},db:null as unknown,allowed:true}));
vi.mock("@/lib/server/session",()=>({getCurrentUser:async()=>context.user}));
vi.mock("@/lib/server/db",()=>({getDb:async()=>context.db}));
vi.mock("@/lib/limits",()=>({allow:async()=>context.allowed,LIMIT_MESSAGE:"Too many updates."}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error("REDIRECT "+url);}}));
import { saveRoadmapAction,deleteRoadmapAction } from "./actions";
let db:Awaited<ReturnType<typeof openPglite>>;
beforeAll(async()=>{db=await openPglite();context.db=db;});
afterAll(async()=>{await db.close();});
beforeEach(()=>{context.user=null;context.allowed=true;});
function form(stages:string[],id?:string){const f=new FormData();f.set("title","My goal");f.set("description","A sequence");if(id)f.set("id",id);for(const stage of stages)f.append("stage",stage);return f;}
async function paths(owner:string){const ids:string[]=[];for(let i=0;i<2;i++){const r=await createList(db,owner,{title:"Path "+i});if(!r.ok)throw Error(r.error);await savePath(db,owner,r.list.id,{enabled:true,level:"beginner",prerequisites:"",outcomes:"Understand it"});ids.push(r.list.id);}return ids;}
it("requires a session for save and delete",async()=>{
 expect(await saveRoadmapAction({},form([]))).toMatchObject({error:expect.stringContaining("Sign in")});
 await expect(deleteRoadmapAction(form([]))).rejects.toThrow("REDIRECT /signin");
});
it("creates privately by default and preserves submitted stage order when editing",async()=>{
 const owner=await fx.user(db);context.user={id:owner};const ids=await paths(owner);
 await expect(saveRoadmapAction({},form(ids))).rejects.toThrow(/REDIRECT \/roadmaps\//);
 const [row]=await db.query<{id:string}>("select id from roadmaps where owner_id=$1",[owner]);
 expect((await roadmapDetail(db,owner,row.id))?.roadmap.is_public).toBe(false);
 const edit=form([...ids].reverse(),row.id);edit.set("public","on");
 await expect(saveRoadmapAction({},edit)).rejects.toThrow("REDIRECT /roadmaps/"+row.id);
 expect((await roadmapDetail(db,null,row.id))?.stages.map(s=>s.listId)).toEqual([...ids].reverse());
 await expect(deleteRoadmapAction(form([],row.id))).rejects.toThrow("REDIRECT /roadmaps");
 expect(await roadmapDetail(db,owner,row.id)).toBeNull();
});
it("prevents cross-account changes and rate-limited writes",async()=>{
 const owner=await fx.user(db);context.user={id:owner};const ids=await paths(owner);
 await expect(saveRoadmapAction({},form(ids))).rejects.toThrow(/REDIRECT/);
 const [row]=await db.query<{id:string}>("select id from roadmaps where owner_id=$1",[owner]);
 context.user={id:await fx.user(db)};
 expect(await saveRoadmapAction({},form(ids,row.id))).toMatchObject({error:expect.any(String)});
 await expect(deleteRoadmapAction(form([],row.id))).rejects.toThrow(/REDIRECT/);
 expect(await roadmapDetail(db,owner,row.id)).not.toBeNull();
 context.user={id:owner};context.allowed=false;
 expect(await saveRoadmapAction({},form(ids,row.id))).toEqual({error:"Too many updates."});
 await deleteRoadmapAction(form([],row.id));
 expect(await roadmapDetail(db,owner,row.id)).not.toBeNull();
});
it("rejects malformed IDs and blank stages without silently dropping them",async()=>{
 context.user={id:await fx.user(db)};
 expect(await saveRoadmapAction({},form([],"bad"))).toMatchObject({error:expect.any(String)});
 const ids=await paths(context.user.id);
 expect(await saveRoadmapAction({},form([ids[0],""]))).toMatchObject({error:expect.any(String)});
 expect(await db.query("select 1 from roadmaps where owner_id=$1",[context.user.id])).toEqual([]);
});
