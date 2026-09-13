'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const { listGenerationHistory } = require('../backend/src/services/generationHistory');

test('thousand-record history uses constant-count bulk page reads with unchanged counts, cursor and node scope', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-history-scale-'));
  const database = new ProjectDatabase(path.join(directory, 'projects.sqlite3'));
  t.after(async () => {
    await database.close();
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(directory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const scope = { projectId: 'scale-project', canvasId: 'scale-canvas' };
  const uids = ['a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'];
  const canvas = database.ensureCanvas(scope.canvasId, { nodes: uids.map((entityUid, index) => ({id:`source-${index}`,entityUid,type:'seedance',position:{x:index*100,y:0},data:{}})), edges: [] }, scope.projectId);
  const run = database.createRun({ ...scope, canvasRevision: canvas.revision, status: 'succeeded' });
  const node = database.createNodeRun({runId:run.id,nodeId:'source-0',status:'succeeded'});
  const attempt = database.createAttempt({nodeRunId:node.id,status:'succeeded'});
  const { assets } = database.recordRunOutputAssets({runId:run.id,nodeRunId:node.id,attemptId:attempt.id,outputs:[{kind:'video',sourceUrl:'/files/output/scale.mp4',filename:'scale.mp4',availability:'available',storageMode:'managed'}]});
  // Synthetic legacy lineage, one reused file but 1,000 distinct historical
  // events. Real writer validates project/canvas/asset; no media is generated.
  const individualWrites = process.env.T8_HISTORY_SCALE_INDIVIDUAL_WRITES === '1';
  const seed = () => {
    for (let i=0;i<1000;i++) {
      try { database.recordAssetLineageEvent({assetId:assets[0].id,canvasId:scope.canvasId,sourceType:'node-output',sourceNodeId:`source-${i%2}`,sourceNodeEntityUid:uids[i%2],derivedOperation:`fixture-${i}`,createdAt:1000+i,promptSummary:`historical prompt ${i}`,metadata:{fixturePadding:'x'.repeat(8192)}}); }
      catch (error) {
        // Diagnostic opt-in never retries a committed write. Keep only codes
        // and phases, not filesystem paths, raw metadata, or credentials.
        const causes=[];
        for (let cause=error;cause&&causes.length<5;cause=cause.cause) causes.push({code:cause.code||null,reason:cause.reason||null,phase:cause.details?.phase||null,published:cause.details?.published??cause.details?.acknowledgementPublished??null,syscall:cause.syscall||null});
        console.log(JSON.stringify({historySeedFailure:{individualWrites,index:i,committed:error.committed===true,causes}}));
        throw error;
      }
    }
  };
  if (individualWrites) seed(); else database.withProjectDatabaseWrite('asset.lineage.record', seed);
  const originalPrepare = database.db.prepare;
  let projectionReads = 0;
  database.db.prepare = function(sql, ...args) {
    if (/WITH candidates AS/.test(sql)) projectionReads++;
    return originalPrepare.call(this, sql, ...args);
  };
  const measurements=[];
  const measure = (name, input) => {
    projectionReads=0;
    const start=performance.now();const page=listGenerationHistory(database,input);
    measurements.push({name,ms:Math.round((performance.now()-start)*100)/100,projectionReads});
    return page;
  };
  try {
    const changes=database.db.prepare('SELECT total_changes() n').get().n;
    const first=measure('first-48', {...scope,limit:48});
    assert.equal(first.total,1001);assert.equal(first.groups.length,48);
    assert.equal(first.counts.video,1001);
    assert.ok(first.groups.every(group=>group.outputs.length===1&&!group.hasMoreOutputs&&!group.inputArchive));
    const next=measure('next-48',{...scope,limit:48,cursor:first.nextCursor});
    assert.equal(next.total,1001);assert.equal(new Set([...first.groups,...next.groups].map(group=>group.id)).size,96);
    const filtered=measure('source-1',{...scope,nodeId:'source-1',limit:48});
    assert.equal(filtered.total,500);assert.ok(filtered.groups.every(group=>group.nodeEntityUid===uids[1]));
    const detail=measure('detail',{...scope,groupId:next.groups[0].id,includeInput:true});
    assert.equal(detail.groups.length,1);assert.equal(detail.groups[0].promptPreview,next.groups[0].promptPreview);
    assert.equal(database.db.prepare('SELECT total_changes() n').get().n,changes);
    console.log(JSON.stringify({historyScale:{records:1001,metadataBytesPerLegacyEvent:8192,individualWrites,synthetic:true,measurements}}));
    assert.ok(measurements.every(item=>item.projectionReads<=5),'one bounded page must not rerun the history projection separately for each card');
  } finally {database.db.prepare=originalPrepare;}
});
