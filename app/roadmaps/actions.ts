"use server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { str,UUID } from "@/lib/server/form";
import { allow,LIMIT_MESSAGE } from "@/lib/limits";
import { saveRoadmap,deleteRoadmap } from "@/lib/roadmaps";
export type RoadmapState={error?:string};
export async function saveRoadmapAction(_state:RoadmapState,form:FormData):Promise<RoadmapState>{
 const user=await getCurrentUser();
 if(!user)return {error:"Sign in to create or edit a roadmap."};
 const id=str(form,"id");
 if(id && !UUID.test(id))return {error:"Choose a roadmap."};
 const db=await getDb();
 if(!(await allow(db,"write",user.id)))return {error:LIMIT_MESSAGE};
 const stages=form.getAll("stage").filter((v):v is string=>typeof v==="string");
 const result=await saveRoadmap(db,user.id,id||null,{title:str(form,"title"),description:str(form,"description"),isPublic:form.get("public")==="on",stages});
 if(!result.ok)return {error:result.error};
 redirect(`/roadmaps/${result.id}`);
}
export async function deleteRoadmapAction(form:FormData){
 const user=await getCurrentUser();if(!user)redirect("/signin");
 const id=str(form,"id");if(!UUID.test(id))return;
 const db=await getDb();if(!(await allow(db,"write",user.id)))return;
 await deleteRoadmap(db,user.id,id);redirect("/roadmaps");
}
