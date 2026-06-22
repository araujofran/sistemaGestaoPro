const assert = require('node:assert/strict');
process.env.GITHUB_REPOSITORY = 'araujofran/sistemaGestaoPro';
const originalFetch = global.fetch;
global.fetch = async url => {
  const path = new URL(url).pathname;
  const payload = path.includes('/commits') ? [{ sha:'abc123',commit:{message:'ORB-142 ajuste',author:{name:'Ana',date:'2026-01-01'}},author:{login:'ana'},html_url:'https://github.com/commit' }] : path.includes('/branches') ? [{name:'main',commit:{sha:'abc123'},protected:true}] : path.includes('/pulls') ? [{number:1,title:'Mudança',state:'open',draft:false,user:{login:'ana'},html_url:'https://github.com/pr/1',updated_at:'2026-01-01'}] : path.includes('/actions/runs') ? {workflow_runs:[{id:1,name:'CI',status:'completed',conclusion:'success',head_branch:'main',event:'push',html_url:'https://github.com/run/1',updated_at:'2026-01-01'}]} : {full_name:'araujofran/sistemaGestaoPro',html_url:'https://github.com/araujofran/sistemaGestaoPro',default_branch:'main',visibility:'public'};
  return { ok:true,status:200,json:async()=>payload };
};
const { createGitHubApi } = require('../src/github-api');
let state={meta:{version:1},issues:[{id:'i1',key:'ORB-142'}],devopsEvents:[]};
const storage={getState:async()=>structuredClone(state),saveState:async next=>{next.meta.version++;state=structuredClone(next);return state}};
const json=(res,status,data)=>Object.assign(res,{status,data});
const api=createGitHubApi({storage,json,parseBody:async()=>({})});
async function call(path,method='GET'){const req={method,headers:{}},res={};await api(req,res,new URL(path,'http://localhost'),{memberId:'u1',roleId:'admin'});return res}
(async()=>{const overview=await call('/api/github/overview');assert.equal(overview.data.repository.fullName,'araujofran/sistemaGestaoPro');assert.equal(overview.data.commits[0].sha,'abc123');const sync=await call('/api/github/sync','POST');assert.equal(sync.status,200);assert.deepEqual(state.devopsEvents[0].issueIds,['i1']);console.log('GitHub e vinculação de tarefas validados.');global.fetch=originalFetch})().catch(error=>{global.fetch=originalFetch;console.error(error);process.exit(1)});
