'use strict';
// Actual editor/React/Chromium; no database, Provider or user profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const { chromium } = require('playwright');
  const { createServer } = await import('vite');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-editor-selection-'));
  const artifacts = path.join(ROOT, 'artifacts/mention-prompt-selection'); fs.mkdirSync(artifacts, { recursive: true });
  const report = { startedAt: new Date().toISOString(), passed: false, cases: [], errors: [] };
  const entry = `import React,{useState} from 'react'; import{createRoot}from'react-dom/client';
    import Editor from '/src/components/nodes/MentionPromptInput.tsx'; import '/src/i18n'; import '/src/styles/index.css';
    const query=new URLSearchParams(location.search),rich=query.has('rich'),leading=query.has('leading');
    const initial=rich?(leading?'@image1 后文':'前🙂 @image1 后文\\nnext'):'old prompt ABC';
    const material={kind:'image',url:'/pixel.png',sourceId:'fixture',label:'fixture'};
    const start=initial.indexOf('@image1');
    const mention={id:'m1',kind:'image',materialKey:'image:/pixel.png',url:'/pixel.png',token:'@image1',start,end:start+7};
    function App(){const[value,setValue]=useState(initial),[mentions,setMentions]=useState(rich?[mention]:[]),[tick,setTick]=useState(0);
      window.refreshRefs=()=>setTick(t=>t+1);window.editorState={value,mentions,tick};
      return React.createElement(Editor,{value,mentions,materials:rich?[{...material}]:[],isDark:false,isPixel:false,
        expandable:false,onChange:(v,m)=>{setValue(v);setMentions(m);},style:{height:160,padding:12,border:'1px solid #777'}});}
    createRoot(document.getElementById('root')).render(React.createElement(App));`;
  let server, browser;
  try {
    server = await createServer({ root: ROOT, configFile: false, cacheDir: path.join(temporary, 'vite'),
      esbuild: { jsx: 'automatic' }, define: { __APP_VERSION__: JSON.stringify('3.1.5') },
      optimizeDeps: { entries: ['src/components/nodes/MentionPromptInput.tsx'], include: ['react', 'react-dom/client'] }, server: { host: '127.0.0.1', port: 0 },
      plugins: [{ name: 'selection-fixture', resolveId: id => id === '/selection-entry.js' ? '\0selection-entry'
        : id === 'virtual:t8-local-extensions' ? path.join(ROOT, 'src/extensions/emptyLocalExtensions.tsx') : null,
        load: id => id === '\0selection-entry' ? entry : null,
        configureServer(vite) { vite.middlewares.use((req, res, next) => {
          if (req.url === '/pixel.png') { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')); return; }
          if (!req.url.startsWith('/__selection')) return next();
          res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><p id="outside">Outside text</p><div id="root" style="padding:40px;max-width:800px"></div><script type="module" src="/selection-entry.js"></script>');
        }); },
      }],
    });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const scenarios = [{rich:false,leading:false},{rich:true,leading:false},{rich:true,leading:true}]
      .flatMap(item => [false,true].map(backwards => ({...item,backwards,special:null})));
    scenarios.push({rich:false,leading:false,backwards:false,special:'caret'}, {rich:false,leading:false,backwards:false,special:'outside'});
    for (const {rich,leading,backwards,special} of scenarios) {
      const page = await browser.newPage();
      const result = { rich, leading, backwards, special, passed: false }; report.cases.push(result);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      try {
        await page.goto(`${origin}/__selection${rich ? '?rich' : ''}${leading ? '&leading' : ''}`, { waitUntil: 'commit' });
        const editor = page.getByRole('textbox'); await editor.waitFor({ timeout: 120000 }); await editor.click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await editor.evaluate((el, {reverse,mode}) => {
          const s=window.getSelection();
          if(mode==='caret') s.setBaseAndExtent(el.firstChild,4,el.firstChild,4);
          else if(mode==='outside') { const n=document.getElementById('outside').firstChild; s.setBaseAndExtent(n,0,n,n.textContent.length); }
          else s.setBaseAndExtent(el,reverse?el.childNodes.length:0,el,reverse?0:el.childNodes.length);
        }, {reverse:backwards,mode:special});
        const selection = () => page.evaluate(() => {
          const s = window.getSelection(), a = document.createRange(), f = document.createRange();
          a.setStart(s.anchorNode, s.anchorOffset); a.collapse(true); f.setStart(s.focusNode, s.focusOffset); f.collapse(true);
          return { text: s.toString(), collapsed: s.isCollapsed, backwards: a.compareBoundaryPoints(Range.START_TO_START, f) > 0 };
        });
        result.before = await selection(); assert.equal(result.before.collapsed, special === 'caret');
        await page.evaluate(() => window.refreshRefs());
        await page.waitForFunction(() => window.editorState.tick === 1);
        result.after = await selection();
        // Typing is intentionally separate from the selection assertion so a
        // failing baseline records the actual append/replace consequence too.
        if (special !== 'outside') await page.keyboard.insertText('替换🙂');
        result.value = await page.evaluate(() => window.editorState.value);
        result.mentionCount = await page.evaluate(() => window.editorState.mentions.length);
        assert.deepEqual(result.after, result.before, 'equivalent reference refresh must preserve the entire selection and its direction');
        assert.equal(result.value, special === 'outside' ? 'old prompt ABC' : special === 'caret' ? 'old 替换🙂prompt ABC' : '替换🙂');
        assert.equal(result.mentionCount, 0);
        result.passed = true;
      } catch (error) { result.error = error.message; }
      finally { await page.close(); }
    }
    report.passed = report.cases.every(item => item.passed) && report.errors.length === 0;
  } finally {
    await browser?.close(); await server?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
  if (!report.passed) throw new Error('Selection regression failed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
