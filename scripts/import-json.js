const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const config = require('../src/config');

if (!config.databaseUrl) throw new Error('Defina DATABASE_URL no arquivo .env');

async function main() {
  const file = path.join(__dirname, '..', 'data', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: false } : false });
  const client = await pool.connect();
  const workspaceId = 'default';
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO roles(id,name,permissions) VALUES ('admin','Administrador','[\"manage\",\"edit\",\"delete\",\"view\"]'),('member','Membro','[\"edit\",\"view\"]'),('viewer','Leitor','[\"view\"]') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,permissions=EXCLUDED.permissions");
    await client.query('INSERT INTO workspaces(id,name,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,updated_at=NOW()', [workspaceId, state.meta?.workspace || 'Orbit Labs']);
    for (const [index, user] of state.members.entries()) {
      const roleId = user.roleId || (index === 0 ? 'admin' : 'member');
      await client.query('INSERT INTO users(id,name,initials,job_title,color,role_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,initials=EXCLUDED.initials,job_title=EXCLUDED.job_title,color=EXCLUDED.color,role_id=EXCLUDED.role_id', [user.id,user.name,user.initials,user.role||'',user.color,roleId]);
      await client.query('INSERT INTO workspace_members(workspace_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role_id=EXCLUDED.role_id', [workspaceId,user.id,roleId]);
    }
    for (const [position, status] of state.statuses.entries()) {
      await client.query('INSERT INTO statuses(id,workspace_id,name,color,wip_limit,position) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color,wip_limit=EXCLUDED.wip_limit,position=EXCLUDED.position', [status.id,workspaceId,status.name,status.color,status.limit||0,position]);
    }
    for (const project of state.projects) {
      await client.query('INSERT INTO projects(id,workspace_id,key,name,description,type,management,color,lead_id,archived) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET key=EXCLUDED.key,name=EXCLUDED.name,description=EXCLUDED.description,type=EXCLUDED.type,management=EXCLUDED.management,color=EXCLUDED.color,lead_id=EXCLUDED.lead_id,archived=EXCLUDED.archived,updated_at=NOW()', [project.id,workspaceId,project.key,project.name,project.description||'',project.type||'kanban',project.management||'team',project.color,project.lead,!!project.archived]);
    }
    for (const sprint of state.sprints) {
      await client.query('INSERT INTO sprints(id,project_id,name,goal,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,goal=EXCLUDED.goal,starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,status=EXCLUDED.status', [sprint.id,sprint.projectId,sprint.name,sprint.goal||'',sprint.start||null,sprint.end||null,sprint.status]);
    }
    for (const release of state.releases) {
      await client.query('INSERT INTO releases(id,project_id,name,release_date,status,progress,notes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,release_date=EXCLUDED.release_date,status=EXCLUDED.status,progress=EXCLUDED.progress,notes=EXCLUDED.notes', [release.id,release.projectId,release.name,release.date||null,release.status,release.progress||0,release.notes||'']);
    }
    for (const issue of state.issues) {
      await client.query('INSERT INTO issues(id,project_id,issue_key,title,description,type,priority,status_id,assignee_id,reporter_id,sprint_id,parent_id,epic,points,original_estimate,due_date,rank,custom_fields,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$15,$16,$17::jsonb,$18,$19) ON CONFLICT(id) DO UPDATE SET project_id=EXCLUDED.project_id,issue_key=EXCLUDED.issue_key,title=EXCLUDED.title,description=EXCLUDED.description,type=EXCLUDED.type,priority=EXCLUDED.priority,status_id=EXCLUDED.status_id,assignee_id=EXCLUDED.assignee_id,reporter_id=EXCLUDED.reporter_id,sprint_id=EXCLUDED.sprint_id,epic=EXCLUDED.epic,points=EXCLUDED.points,original_estimate=EXCLUDED.original_estimate,due_date=EXCLUDED.due_date,rank=EXCLUDED.rank,custom_fields=EXCLUDED.custom_fields,updated_at=EXCLUDED.updated_at', [issue.id,issue.projectId,issue.key,issue.title,issue.description||'',issue.type,issue.priority,issue.status,issue.assignee||null,issue.reporter||null,issue.sprintId||null,issue.epic||'',Number(issue.points)||0,Number(issue.originalEstimate)||0,issue.due||null,Number(issue.order)||999,JSON.stringify(issue.customFields||{}),issue.created||new Date().toISOString(),issue.updated||new Date().toISOString()]);
      await client.query('DELETE FROM issue_labels WHERE issue_id=$1', [issue.id]);
      for (const label of issue.labels || []) await client.query('INSERT INTO issue_labels(issue_id,label) VALUES($1,$2) ON CONFLICT DO NOTHING', [issue.id,label]);
      for (const comment of issue.comments || []) await client.query('INSERT INTO comments(id,issue_id,author_id,body,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(id) DO UPDATE SET body=EXCLUDED.body,updated_at=EXCLUDED.updated_at', [comment.id,issue.id,comment.author||null,comment.text,comment.date]);
      for (const log of issue.worklogs || []) await client.query('INSERT INTO worklogs(id,issue_id,user_id,minutes,work_date,note) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,minutes=EXCLUDED.minutes,work_date=EXCLUDED.work_date,note=EXCLUDED.note', [log.id,issue.id,log.user||null,log.minutes,log.date,log.note||'']);
    }
    for (const issue of state.issues) if (issue.parentId) await client.query('UPDATE issues SET parent_id=$1 WHERE id=$2', [issue.parentId,issue.id]);
    for (const activity of state.activity || []) await client.query('INSERT INTO activities(id,workspace_id,user_id,description,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET description=EXCLUDED.description', [activity.id,workspaceId,activity.user||null,activity.text,activity.date]);
    await client.query('INSERT INTO app_state(id,version,state,updated_at) VALUES(1,$1,$2::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,state=EXCLUDED.state,updated_at=NOW()', [Number(state.meta?.version||1),JSON.stringify(state)]);
    await client.query('COMMIT');
    console.log(`Importação concluída: ${state.projects.length} projetos, ${state.issues.length} tarefas e ${state.members.length} usuários.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
