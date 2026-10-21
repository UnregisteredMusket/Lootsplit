import assert from "node:assert/strict";
// A startup retry of a stored deletion intent that fails must not lock the tab out.
const values=new Map();
const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
const victim={id:"victim",name:"Deleting",db:"quire-delete-victim"};
const survivor={id:"survivor",name:"Survivor",db:"quire-delete-survivor"};
const intent=JSON.stringify({target:victim,next:{campaigns:[survivor],activeId:"survivor"}});
storage.setItem("quire.campaigns.v1",JSON.stringify([victim,survivor]));
storage.setItem("quire.campaign.v1","victim");
storage.setItem("quire.owner.victim","fixture-owner");
storage.setItem("quire.owner.survivor","fixture-owner");
storage.setItem("lootsplit.verified-account","fixture-owner");
storage.setItem("quire.deletion.v1",intent);
// The storage deletion fails asynchronously, as IndexedDB reports errors.
const indexedDB={deleteDatabase(){const request={error:new Error("Injected deletion failure")};setTimeout(()=>request.onerror?.(),0);return request;}};
Object.assign(globalThis,{indexedDB,localStorage:storage,sessionStorage:storage,window:{localStorage:storage,location:{search:"",hash:""}}});
const {getCampaigns,createCampaign,renameCampaign,switchCampaign,deleteCampaign,campaignDeletionFailed,subscribeCampaigns}=await import("../src/lib/quire/campaigns.ts");
getCampaigns();
assert.throws(()=>createCampaign("Blocked"),/deletion is still finishing/);
assert.equal(campaignDeletionFailed(),false);
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("The failed deletion was never reported")),2000);const off=subscribeCampaigns(()=>{off();clearTimeout(timer);resolve();});});
assert.equal(campaignDeletionFailed(),true);
assert.equal(storage.getItem("quire.deletion.v1"),intent,"The intent is kept so the next load retries");
assert.deepEqual(getCampaigns().campaigns.map(c=>c.id),["victim","survivor"]);
renameCampaign("survivor","Renamed after failure");
switchCampaign("survivor");
assert.equal(getCampaigns().activeId,"survivor");
createCampaign("After failure");
assert.equal(getCampaigns().campaigns.length,3);
// A second deletion would replace the retained intent, so it waits for the reload retry.
await assert.rejects(deleteCampaign("survivor"),/deletion failed\. It will retry when Lootsplit is reloaded/);
assert.equal(storage.getItem("quire.deletion.v1"),intent);
console.log("Failed deletion retry unlocks campaign changes and keeps the intent for reload.");
