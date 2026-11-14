import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LayoutDashboard, WandSparkles, Layers3, Images, SlidersHorizontal, ShieldCheck, Download, Plus, Trash2, CheckCircle2, AlertTriangle, ChevronRight, KeyRound, Menu, X, Upload, Clock, Copy, Sparkles} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import CloudWorkspace from './CloudWorkspace';
import ProviderSettings, { requestProvider, providers } from './OpenAIProvider';
import { auth } from './firebase';
import './style.css';
const INITIAL_SKILLS=[{id:'iso',name:'Isometric 2D',type:'Isometric',description:'Clean 45° perspective, crisp vector-like geometry',prompt:'Clean isometric 2D vector-like illustration, 45-degree view, centered isolated object, crisp geometry, consistent proportions, subtle shading, no logos or text.',negative:'no text, no watermark, no brand, no halo, no noise',color:'#8b9cff'},{id:'kawaii',name:'Cute Kawaii Flat Cartoon',type:'Flat Cartoon',description:'Chibi proportions, expressive eyes, rosy cheeks, pastel palette',prompt:'Cute kawaii flat vector cartoon, adorable chibi proportions, rounded simplified shapes, big expressive eyes, rosy cheeks, vibrant pastel palette, subtle dark brown outlines, minimal shading, clean 2D clipart.',negative:'no realism, no 3D, no text, no watermark, no complex textures',color:'#ff9ec6'}];
const uid=()=>Math.random().toString(36).slice(2,10);
function useStored(k,initial){const [v,setV]=useState(()=>{try{return JSON.parse(localStorage.getItem(k))??initial}catch{return initial}});useEffect(()=>localStorage.setItem(k,JSON.stringify(v)),[k,v]);return [v,setV]}
const angles=['Front','Back','Left side','Right side','Top','Three-quarter','Isometric 45°'];
const iconMap={Dashboard:LayoutDashboard,Generator:WandSparkles,Skills:Layers3,Library:Images,Distribution:Download,Settings:SlidersHorizontal};
function App(){const [tab,setTab]=useState('Dashboard'),[skills,setSkills]=useStored('sis.skills',INITIAL_SKILLS),[jobs,setJobs]=useStored('sis.jobs',[]),[assets,setAssets]=useStored('sis.assets',[]),[showSkill,setShowSkill]=useState(false),[editing,setEditing]=useState(null),[mobile,setMobile]=useState(false),[toast,setToast]=useState('');const notify=t=>{setToast(t);setTimeout(()=>setToast(''),3500)};
const [user, setUser] = useState(auth ? undefined : null);
const [connections, setConnections] = useState({});
const [provider, setProvider] = useState('openai');
useEffect(() => auth ? onAuthStateChanged(auth, nextUser => {
  setUser(nextUser);
  setConnections(previous => Object.fromEntries(Object.entries(previous).filter(([, value]) => value.uid === nextUser?.uid)));
}) : undefined, []);
const connection = user && connections[provider]?.uid === user.uid ? connections[provider] : null;
function connectProvider(id, value) {
  if (auth.currentUser?.uid !== user?.uid) return;
  setConnections(previous => ({ ...previous, [id]: { ...value, uid: user.uid } }));
  setProvider(id);
}
function disconnectProvider(id) {
  setConnections(previous => {
    const next = { ...previous };
    delete next[id];
    return next;
  });
}
const [generating, setGenerating] = useState(false);
const [results, setResults] = useState([]);
const [generationError, setGenerationError] = useState('');
const resultUrls = useRef([]);
useEffect(() => () => resultUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
const workspace = {skills, jobs, assets};
const loadWorkspace = ({skills, jobs, assets}) => {
  setSkills(skills);
  setJobs(jobs);
  setAssets(assets);
};
const [mode,setMode]=useState('multi-angle'),[skillId,setSkillId]=useState('iso'),[subject,setSubject]=useState('Ergonomic office chair'),[batch,setBatch]=useState('Office chair\nDesk lamp\nFiling cabinet\nPrinter'),[selectedAngles,setSelectedAngles]=useState(['Front','Back','Three-quarter','Isometric 45°']),[target,setTarget]=useState(['adobe','freepik']),[quality,setQuality]=useState('high');
const selectedSkill=skills.find(s=>s.id===skillId)||skills[0];const activeCount=mode==='multi-angle'?selectedAngles.length:mode==='batch'?batch.split('\n').filter(x=>x.trim()).length:1;
const createJob=async()=>{if(!subject.trim()&&mode!=='batch')return notify('Enter a subject first');if(activeCount<1)return notify('Select at least one output');const id=uid(),items=mode==='batch'?batch.split('\n').map(x=>x.trim()).filter(Boolean):mode==='multi-angle'?selectedAngles:[null];const job={id,mode,skill:selectedSkill.name,skillId,subject:mode==='batch'?'Multiple subjects':subject,count:items.length,status:'draft',created:new Date().toISOString(),targets:target,quality,items:items.map((item,i)=>({id:uid(),subject:mode==='batch'?item:subject,angle:mode==='multi-angle'?item:null,status:'pending'}))};setJobs(p=>[job,...p]);notify('Draft saved. Open it in the Generator when ready.');setTab('Library')};
function openDraft(job) {
  setMode(job.mode);
  setSkillId(job.skillId);
  setSubject(job.subject);
  setTarget(job.targets ?? ['adobe']);
  setQuality(job.quality === 'medium' ? 'medium' : 'high');
  if (job.mode === 'batch') setBatch(job.items.map(item => item.subject).join('\n'));
  if (job.mode === 'multi-angle') setSelectedAngles(job.items.map(item => item.angle).filter(Boolean));
  setGenerationError('');
  setTab('Generator');
  window.scrollTo(0, 0);
}

async function generateImage() {
  if (!connection || !selectedSkill || generating || !activeCount) return;
  const outputs = mode === 'batch'
    ? batch.split('\n').map(subject => subject.trim()).filter(Boolean).map(item => ({ item }))
    : mode === 'multi-angle'
      ? selectedAngles.map(angle => ({ item: subject.trim(), angle }))
      : [{ item: subject.trim() }];
  if (!outputs[0]?.item) return setGenerationError('Enter a subject first.');

  setGenerating(true);
  resultUrls.current.forEach(url => URL.revokeObjectURL(url));
  resultUrls.current = [];
  setResults([]);
  setGenerationError('');
  let completed = 0;
  try {
    for (const { item, angle } of outputs) {
      if (auth.currentUser?.uid !== user.uid) break;
      const prompt = [
        'Subject: ' + item,
        angle && 'Camera angle: ' + angle,
        selectedSkill.prompt,
        selectedSkill.negative && 'Avoid: ' + selectedSkill.negative,
      ].filter(Boolean).join('\n');
      const image = await requestProvider(user, { provider, action: 'generate', key: connection.key, prompt,
        quality: quality === 'medium' ? 'medium' : 'high' });
      if (auth.currentUser?.uid !== user.uid) break;
      const url = URL.createObjectURL(image);
      resultUrls.current.push(url);
      completed++;
      const name = 'stock-image-' + completed + '.' + ({ 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.type] ?? 'png');
      setResults(previous => [...previous, { url, item: angle ? item + ' · ' + angle : item, name }]);
    }
  } catch (error) {
    setGenerationError(completed + ' of ' + outputs.length + ' completed. ' + error.message);
  } finally {
    setGenerating(false);
  }
}
const addSkill=s=>{setSkills(p=>editing?p.map(x=>x.id===editing.id?{...s,id:x.id}:x):[...p,{...s,id:uid()}]);setShowSkill(false);setEditing(null);notify('Skill saved')};
const downloadJSON=(name,data)=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)};
const exportCSV=()=>{const rows=[['filename','title','keywords','ai_generated','marketplace','status']];assets.forEach(a=>target.forEach(t=>rows.push([a.filename,a.title||a.subject,(a.keywords||[]).join('; '),'yes',t,a.status||'draft'])));const csv=rows.map(r=>r.map(c=>'"'+String(c??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='stock-metadata-draft.csv';a.click();URL.revokeObjectURL(a.href)};
return <div className="shell"><aside className={'sidebar '+(mobile?'show':'')}><div className="brand"><div className="brandicon"><Sparkles size={21}/></div><div><b>Stock Image Studio</b><small>Creator workspace · MVP</small></div><button className="mobileClose" onClick={()=>setMobile(false)}><X size={20}/></button></div><div className="sideLabel">WORKSPACE</div><nav>{Object.entries(iconMap).map(([name,Icon])=><button key={name} className={tab===name?'active':''} onClick={()=>{setTab(name);setMobile(false)}}><Icon size={18}/>{name}{tab===name&&<ChevronRight size={15} className="right"/>}</button>)}</nav><div className="sidefoot"><div className="statusdot"/>{user ? 'Firebase signed in' : 'Local drafts'}<small>{auth ? 'Cloud workspace in Settings' : 'Firebase setup pending'}</small></div></aside><main><header><button className="menuButton" onClick={()=>setMobile(true)}><Menu/></button><div><div className="eyebrow">STOCK IMAGE PRODUCTION</div><h1>{tab}</h1></div><div className="headerActions"><span className="chip"><ShieldCheck size={14}/> {connection ? providers[provider] + ' verified' : 'BYOK'}</span><button className="primary small" onClick={()=>setTab('Generator')}><Plus size={16}/> New generation</button></div></header>
{tab==='Dashboard'&&<><div className="hero"><div><div className="eyebrow light">YOUR CREATIVE PIPELINE</div><h2>From one idea to an entire stock collection.</h2><p>Build reusable illustration skills, plan multi-angle or batch jobs, and prepare marketplace-specific exports.</p><button className="whitebtn" onClick={()=>setTab('Generator')}><WandSparkles size={17}/> Create images <ChevronRight size={16}/></button></div><div className="heroArt"><div className="shape shape1">✦</div><div className="shape shape2">◈</div><div className="shape shape3">✳</div></div></div><div className="stats"><Stat title="Saved skills" value={skills.length} icon={Layers3}/><Stat title="Generation jobs" value={jobs.length} icon={WandSparkles}/><Stat title="Stored assets" value={assets.length} icon={Images}/><Stat title="Configured providers" value={Object.keys(connections).length} icon={KeyRound}/></div><div className="twoCols"><section className="panel"><div className="sectionhead"><h3>Your illustration skills</h3><button className="textbtn" onClick={()=>setTab('Skills')}>View all →</button></div>{skills.slice(0,4).map(s=><div className="skillrow" key={s.id}><div className="skillmark" style={{background:s.color||'#9aa8ff'}}>✦</div><div><b>{s.name}</b><small>{s.description}</small></div><span className="tag">{s.type}</span></div>)}</section><section className="panel"><div className="sectionhead"><h3>Production workflow</h3></div>{['Create or select a skill','Choose single, multi-angle, or batch','Connect your AI provider (BYOK)','Generate and run quality checks','Export for Adobe Stock / Freepik'].map((x,i)=><div className="workflow" key={i}><span>{i+1}</span>{x}</div>)}</section></div></>}
{tab==='Generator'&&<div className="twoCols gen"><section className="panel"><div className="sectionhead"><h3>Generation setup</h3><span className="tag">Draft workflow</span></div><label>Illustration skill</label><select value={skillId} onChange={e=>setSkillId(e.target.value)}>{skills.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><div className="hint">{selectedSkill?.description}</div><label>Generation mode</label><div className="modegrid">{[['single','Single image'],['multi-angle','Multi-angle'],['batch','Batch objects']].map(([v,n])=><button className={mode===v?'selected':''} onClick={()=>setMode(v)} key={v}>{n}</button>)}</div>{mode!=='batch'?<><label>Subject / object</label><input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="What would you like to create?"/></>:<><label>Objects — one per line</label><textarea rows="7" value={batch} onChange={e=>setBatch(e.target.value)} placeholder="Enter one subject per line"/></>}{mode==='multi-angle'&&<><label>Camera angles</label><div className="checks">{angles.map(a=><label key={a}><input type="checkbox" checked={selectedAngles.includes(a)} onChange={e=>setSelectedAngles(p=>e.target.checked?[...p,a]:p.filter(x=>x!==a))}/>{a}</label>)}</div></>}<label>Output quality</label><select value={quality} onChange={e=>setQuality(e.target.value)}><option value="medium">Medium</option><option value="high">High</option></select><label>Marketplace targets</label><div className="checks"><label><input type="checkbox" checked={target.includes('adobe')} onChange={e=>setTarget(p=>e.target.checked?[...p,'adobe']:p.filter(x=>x!=='adobe'))}/>Adobe Stock</label><label><input type="checkbox" checked={target.includes('freepik')} onChange={e=>setTarget(p=>e.target.checked?[...p,'freepik']:p.filter(x=>x!=='freepik'))}/>Freepik / Magnific</label></div><button className="primary full" onClick={createJob}><WandSparkles size={18}/> Save draft · {activeCount} image{activeCount!==1?'s':''}</button><label htmlFor="generator-provider">Image provider</label><select id="generator-provider" value={provider} disabled={generating} onChange={event=>setProvider(event.target.value)}>{Object.entries(providers).map(([id,name])=><option key={id} value={id}>{name}{connections[id] ? ' · connected' : ''}</option>)}</select>{connection ? <button className="primary full" disabled={generating || !activeCount} onClick={generateImage}>{generating ? 'Generating · ' + results.length + ' complete' : 'Generate ' + activeCount + (activeCount === 1 ? ' image' : ' images')}</button> : <button className="outline full" onClick={()=>setTab('Settings')}>Connect {providers[provider]} in Settings</button>}{generationError && <p role="alert">{generationError}</p>}</section><section className="panel"><h3>Output preview</h3>{results.map(result=><div key={result.url} className="generatedImage"><img src={result.url} alt={result.item}/><a className="outline full" href={result.url} download={result.name}>Download image</a></div>)}<div className="previewArt"><span>✳</span><p>{mode==='multi-angle'?'Consistent object · multiple viewpoints':mode==='batch'?'Different objects · one visual style':'One subject · one output'}</p></div><div className="previewline"><span>Skill</span><b>{selectedSkill?.name}</b></div><div className="previewline"><span>Images planned</span><b>{activeCount}</b></div><div className="previewline"><span>Format target</span><b>Image · 1:1</b></div><div className="previewline"><span>Platform profiles</span><b>{target.join(', ')||'None'}</b></div><div className="notice">Image consistency across angles requires reference-image editing; exact geometry is not guaranteed.</div></section></div>}
{tab==='Skills'&&<section className="panel"><div className="sectionhead"><div><h3>Skill library</h3><p>Reusable art direction and prompt presets</p></div><button className="primary" onClick={()=>{setEditing(null);setShowSkill(true)}}><Plus size={17}/> Create skill</button></div><div className="skillgrid">{skills.map(s=><div className="skillcard" key={s.id}><div className="skillcover" style={{background:`linear-gradient(135deg,${s.color||'#98a8ff'},#e7ebff)`}}><span>✦</span></div><div className="skillbody"><span className="tag">{s.type}</span><h3>{s.name}</h3><p>{s.description}</p><div className="cardactions"><button onClick={()=>{setEditing(s);setShowSkill(true)}}>Edit</button><button onClick={()=>{setEditing({...s,name:s.name+' Copy',id:null});setShowSkill(true)}}><Copy size={14}/> Duplicate</button>{!['iso','kawaii'].includes(s.id)&&<button className="danger" onClick={()=>setSkills(p=>p.filter(x=>x.id!==s.id))}><Trash2 size={14}/></button>}</div></div></div>)}</div></section>}
{tab==='Library'&&<section className="panel"><div className="sectionhead"><div><h3>Production jobs</h3><p>Job drafts and asset pipeline</p></div><button className="primary" onClick={()=>setTab('Generator')}><Plus size={17}/> New job</button></div>{jobs.length===0?<Empty icon={Images} title="No generation jobs yet" detail="Create a job to start building your production queue."/>:<div className="jobs">{jobs.map(j=><div className="job" key={j.id}><div><b>{j.subject}</b><small>{j.skill} · {j.mode} · {j.count} planned images</small><small><Clock size={12}/> {new Date(j.created).toLocaleString()}</small></div><div className="jobright"><span className="tag amber">Draft</span><button onClick={()=>openDraft(j)}>Open in Generator</button><button onClick={()=>downloadJSON('job-'+j.id+'.json',j)}>Export JSON</button><button className="iconbtn" title="Delete job" onClick={()=>setJobs(p=>p.filter(x=>x.id!==j.id))}><Trash2 size={16}/></button></div></div>)}</div>}<div className="notice">Open a draft in the Generator to create and download its images.</div></section>}
{tab==='Distribution'&&<div className="twoCols"><section className="panel"><h3>Marketplace export profiles</h3><div className="marketcard"><div className="marketicon">A</div><div><b>Adobe Stock</b><small>Platform-specific metadata, AI disclosure and raster export</small></div><span className="tag">Profile</span></div><div className="marketcard"><div className="marketicon pink">F</div><div><b>Freepik / Magnific</b><small>Platform-specific file preparation and AI metadata</small></div><span className="tag">Profile</span></div><div className="notice"><ShieldCheck size={16}/>Marketplace rules change. The final app must use versioned rules and human review before submission.</div></section><section className="panel"><h3>Export center</h3><p>Metadata and downloadable assets are prepared separately for each marketplace.</p><div className="previewline"><span>Available image assets</span><b>{assets.length}</b></div><div className="previewline"><span>Draft jobs</span><b>{jobs.length}</b></div><button className="primary full" onClick={exportCSV}><Download size={17}/> Export metadata CSV (draft)</button><button className="outline full" onClick={()=>downloadJSON('stock-studio-jobs.json',jobs)}><Download size={17}/> Export jobs JSON</button><div className="notice">CSV is a generic draft, not a guaranteed marketplace-ready upload template. PNG/JPEG/ZIP export requires actual generated assets.</div></section></div>}
{tab==='Settings'&&<div className="twoCols"><ProviderSettings key={user?.uid ?? 'guest'} user={user} connected={connections} onConnect={connectProvider} onDisconnect={disconnectProvider}/><section className="panel"><h3>Workspace data</h3><p>Skill and job drafts are stored in this browser. Sign in to save or load your Firestore workspace.</p><button className="outline full" onClick={()=>downloadJSON('stock-studio-backup.json',{skills,jobs,assets})}><Download size={17}/> Download workspace backup</button><CloudWorkspace user={user} workspace={workspace} onLoad={loadWorkspace}/><div className="settingblock"><b>Next integration milestones</b>{['Cloud Storage for images','Provider adapters and job workers'].map(x=><div className="workflow" key={x}><CheckCircle2 size={16}/>{x}</div>)}</div></section></div>}
</main>{toast&&<div className="toast"><CheckCircle2 size={16}/>{toast}</div>}{showSkill&&<SkillModal initial={editing} onClose={()=>{setShowSkill(false);setEditing(null)}} onSave={addSkill}/>}</div>}
function Stat({title,value,icon:Icon}){return <div className="stat"><div><small>{title}</small><strong>{value}</strong></div><div className="staticon"><Icon size={22}/></div></div>}
function Empty({icon:Icon,title,detail}){return <div className="empty"><Icon size={32}/><h3>{title}</h3><p>{detail}</p></div>}
function SkillModal({initial,onClose,onSave}){const [form,setForm]=useState({name:initial?.name||'',type:initial?.type||'Custom',description:initial?.description||'',prompt:initial?.prompt||'',negative:initial?.negative||'',color:initial?.color||'#9aa8ff'});const change=(k,v)=>setForm(p=>({...p,[k]:v}));return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal"><div className="sectionhead"><h3>{initial?.id?'Edit skill':'Create new skill'}</h3><button className="iconbtn" onClick={onClose}><X/></button></div><label>Skill name</label><input value={form.name} onChange={e=>change('name',e.target.value)} placeholder="e.g. Minimal Line Art"/><label>Illustration type</label><select value={form.type} onChange={e=>change('type',e.target.value)}><option>Custom</option><option>Isometric</option><option>Flat Cartoon</option><option>Line Art</option><option>Watercolor</option><option>3D</option></select><label>Description</label><input value={form.description} onChange={e=>change('description',e.target.value)} placeholder="Visual characteristics"/><label>Master prompt</label><textarea rows="5" value={form.prompt} onChange={e=>change('prompt',e.target.value)} placeholder="Describe the style, composition, lighting, palette..."/><label>Negative constraints</label><textarea rows="2" value={form.negative} onChange={e=>change('negative',e.target.value)}/><label>Accent color</label><input type="color" value={form.color} onChange={e=>change('color',e.target.value)}/><div className="modalbuttons"><button className="outline" onClick={onClose}>Cancel</button><button className="primary" disabled={!form.name.trim()||!form.prompt.trim()} onClick={()=>onSave(form)}>Save skill</button></div></div></div>}
createRoot(document.getElementById('root')).render(<App/>);
