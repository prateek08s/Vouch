import type { Db } from "@/lib/db";
import { getList } from "@/lib/lists";
import type { PathLesson } from "@/lib/paths/progress";
export type Roadmap = { id: string; owner_id: string; title: string; description: string; is_public: boolean };
export type Stage = { position: number; listId: string | null; title: string; lessons: PathLesson[]; hidden: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function saveRoadmap(db: Db, owner: string, id: string | null, input: {
 title: string; description: string; isPublic: boolean; stages: string[];
}): Promise<{ok:true; id:string} | {ok:false; error:string}> {
 const title=input.title.trim(), description=input.description.trim(), stages=input.stages;
 if(!title || title.length>120 || description.length>1000 || !stages.length || stages.length>20 ||
   stages.some(s=>!uuid.test(s)) || new Set(stages).size!==stages.length) return {ok:false,error:"Add a title and 1 to 20 different learning paths."};
 return db.transaction(async tx=>{
  if(id && !(await tx.query("select 1 from roadmaps where id=$1 and owner_id=$2 for update",[id,owner])).length) return {ok:false,error:"That roadmap is unavailable or belongs to someone else."};
  const paths=await tx.query<{list_id:string;is_public:boolean;owner_id:string}>(
   "select p.list_id,l.is_public,l.owner_id from learning_paths p join lists l on l.id=p.list_id where p.list_id=any($1::uuid[]) for share of l,p",[stages]);
  if(paths.length!==stages.length || paths.some(p=>!p.is_public && (input.isPublic || p.owner_id!==owner)))
   return {ok:false,error:"Choose available learning paths. Public roadmaps can only contain public paths."};
  let roadmapId=id;
  if(!roadmapId){const [row]=await tx.query<{id:string}>("insert into roadmaps(owner_id,title,description,is_public) values($1,$2,$3,$4) returning id",[owner,title,description,input.isPublic]);roadmapId=row.id;}
  else await tx.query("update roadmaps set title=$2,description=$3,is_public=$4,updated_at=now() where id=$1",[roadmapId,title,description,input.isPublic]);
  await tx.query("delete from roadmap_stages where roadmap_id=$1",[roadmapId]);
  for(const [position,listId] of stages.entries()) await tx.query("insert into roadmap_stages(roadmap_id,position,list_id) values($1,$2,$3)",[roadmapId,position,listId]);
  return {ok:true,id:roadmapId};
 });
}
export async function roadmapChoices(db:Db,viewer:string){
 return db.query<{id:string;title:string;is_public:boolean}>("select l.id,l.title,l.is_public from learning_paths p join lists l on l.id=p.list_id where l.is_public or l.owner_id=$1 order by l.title,l.id",[viewer]);
}
export async function roadmapsFor(db:Db,viewer:string|null){
 return db.query<Roadmap>("select * from roadmaps where is_public or owner_id=$1 order by updated_at desc,id limit 100",[viewer]);
}
export async function roadmapDetail(db:Db,viewer:string|null,id:string):Promise<{roadmap:Roadmap;stages:Stage[]}|null>{
 const [roadmap]=await db.query<Roadmap>("select * from roadmaps where id=$1 and (is_public or owner_id=$2)",[id,viewer]);
 if(!roadmap)return null;
 const rows=await db.query<{position:number;list_id:string|null;active:boolean}>("select s.position,s.list_id,p.list_id is not null as active from roadmap_stages s left join learning_paths p on p.list_id=s.list_id where roadmap_id=$1 order by position",[id]);
 const stages:Stage[]=[];
 for(const row of rows){
  const list=row.active && row.list_id ? await getList(db,viewer,row.list_id):null;
  stages.push(list?{position:row.position,listId:list.list.id,title:list.list.title,lessons:list.items,hidden:list.hiddenByRules}:
   {position:row.position,listId:null,title:"Stage unavailable",lessons:[],hidden:0});
 }
 return {roadmap,stages};
}
export async function deleteRoadmap(db:Db,owner:string,id:string){
 await db.query("delete from roadmaps where id=$1 and owner_id=$2",[id,owner]);
}
