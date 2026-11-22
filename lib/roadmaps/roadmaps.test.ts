import {beforeAll,afterAll,expect,it} from "vitest";
import {openPglite} from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import {createList,addToList,deleteList} from "@/lib/lists";
import {savePath} from "@/lib/paths";
import {saveRoadmap,roadmapDetail,roadmapsFor,deleteRoadmap} from "./index";
import {exportAccount} from "@/lib/users/account";
let db:Awaited<ReturnType<typeof openPglite>>;
beforeAll(async()=>{db=await openPglite();});
afterAll(async()=>{await db.close();});
async function path(owner:string,isPublic=true){
 const result=await createList(db,owner,{title:"Path",isPublic});if(!result.ok)throw Error(result.error);
 await savePath(db,owner,result.list.id,{enabled:true,level:"beginner",prerequisites:"",outcomes:"Explain the idea"});
 await addToList(db,owner,result.list.id,await fx.resource(db));
 return result.list.id;
}
it("creates ordered stages, reorders atomically and rejects unauthorized edits",async()=>{
 const owner=await fx.user(db),other=await fx.user(db),a=await path(owner),b=await path(owner);
 const input={title:"Goal",description:"Learn in order",isPublic:true,stages:[a,b]};
 const result=await saveRoadmap(db,owner,null,input);if(!result.ok)throw Error(result.error);
 expect((await roadmapDetail(db,null,result.id))?.stages.map(s=>s.listId)).toEqual([a,b]);
 expect((await saveRoadmap(db,other,result.id,{...input,stages:[b,a]})).ok).toBe(false);
 await saveRoadmap(db,owner,result.id,{...input,stages:[b,a]});
 expect((await roadmapDetail(db,null,result.id))?.stages.map(s=>s.listId)).toEqual([b,a]);
 expect((await saveRoadmap(db,owner,result.id,{...input,stages:[a,a]})).ok).toBe(false);
 expect((await roadmapDetail(db,null,result.id))?.stages.map(s=>s.listId)).toEqual([b,a]);
 await deleteRoadmap(db,other,result.id);expect(await roadmapDetail(db,null,result.id)).not.toBeNull();
 expect((await exportAccount(db,owner)).roadmaps).toMatchObject([{id:result.id}]);
 await deleteRoadmap(db,owner,result.id);expect(await roadmapDetail(db,null,result.id)).toBeNull();
});
it("protects private roadmaps and rejects private stages in public roadmaps",async()=>{
 const owner=await fx.user(db),other=await fx.user(db),id=await path(owner,false);
 const input={title:"Private",description:"",isPublic:false,stages:[id]};
 expect((await saveRoadmap(db,owner,null,{...input,isPublic:true})).ok).toBe(false);
 expect((await saveRoadmap(db,other,null,input)).ok).toBe(false);
 const result=await saveRoadmap(db,owner,null,input);if(!result.ok)throw Error(result.error);
 expect(await roadmapDetail(db,null,result.id)).toBeNull();
 expect(await roadmapDetail(db,other,result.id)).toBeNull();
 expect((await roadmapsFor(db,null)).some(r=>r.id===result.id)).toBe(false);
 expect(await roadmapDetail(db,owner,result.id)).not.toBeNull();
});
it("redacts stages when a path becomes private or is deleted",async()=>{
 const owner=await fx.user(db),id=await path(owner);
 const result=await saveRoadmap(db,owner,null,{title:"Public",description:"",isPublic:true,stages:[id]});if(!result.ok)throw Error(result.error);
 await db.query("update lists set is_public=false where id=$1",[id]);
 expect((await roadmapDetail(db,null,result.id))?.stages).toMatchObject([{title:"Stage unavailable",listId:null,lessons:[]}]);
 await deleteList(db,owner,id);
 expect((await roadmapDetail(db,owner,result.id))?.stages).toMatchObject([{listId:null}]);
});
