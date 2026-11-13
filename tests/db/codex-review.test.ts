import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDb, seedOwner, asUser, createTask, one, type Db, type Fixture } from './harness';
let db: Db; let f: Fixture;
beforeAll(async()=>{db=await createDb();f=await seedOwner(db)},60000);
afterAll(async()=>{await db.close()});
async function finalized(){return asUser(db,f.userId,async tx=>{
  const task=await createTask(tx,f,f.projectB,'quote');
  const d=await one<{artifact_id:string;version_id:string}>(tx,"select * from save_draft_version($1,null,'h','{}',$2)",[task,JSON.stringify({form:{taxMode:'EXCLUSIVE',taxRateBasisPoints:1000,items:[{name:'Original',quantityHundredths:100,unitPriceWon:1000}]},totals:{subtotalWon:1000,taxWon:100,totalWon:1100,isFinalizable:true},customer:{name:'B'}})]);
  const result=await one<{quote_version_id:string}>(tx,`select * from finalize_quote($1,$2,null,'{"legal_name":"Supplier"}','{"name":"B"}','EXCLUSIVE',1000,1000,100,1100,'2026-11-13',null,null,null,$3)`,[d.artifact_id,d.version_id,JSON.stringify([{name:'Original',quantity_hundredths:100,unit_price_won:1000,line_amount_won:1000}])]);
  return {...d,...result};
})}
it('CR03: a finalized quote cannot acquire new rows without a new version',async()=>{
 const d=await finalized();
 await expect(asUser(db,f.userId,tx=>tx.query(`insert into quote_items(workspace_id,quote_version_id,position,name,quantity_hundredths,unit_price_won,line_amount_won) values($1,$2,99,'Added after approval',100,9999,9999)`,[f.workspaceId,d.quote_version_id]))).rejects.toThrow();
});
it('CR04: a result for customer B cannot reference a snapshot from customer A',async()=>{
 await expect(asUser(db,f.userId,async tx=>{
  const taskA=await createTask(tx,f,f.projectA);const taskB=await createTask(tx,f,f.projectB);
  const snapshot=await one<{id:string}>(tx,"insert into task_input_snapshots(workspace_id,task_id,profile_snapshot,input_hash) values($1,$2,'{\"customer\":\"A\"}','h') returning id",[f.workspaceId,taskA]);
  const art=await one<{id:string}>(tx,"insert into artifacts(workspace_id,project_id,task_id,type) values($1,$2,$3,'logo_brief') returning id",[f.workspaceId,f.projectB,taskB]);
  return tx.query("insert into artifact_versions(workspace_id,artifact_id,version,content,input_snapshot_id,generator) values($1,$2,1,'{}',$3,'template')",[f.workspaceId,art.id,snapshot.id]);
 })).rejects.toThrow();
});
