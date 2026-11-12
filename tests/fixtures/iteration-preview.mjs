// Isolated visual/integration preview. Never connects to a live account or DB.
import { mkdtempSync, readFileSync, cpSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const previewCaptions = JSON.parse(readFileSync('tests/fixtures/iteration-captions.json','utf8'));
const root = mkdtempSync(join(tmpdir(), 'funnystudy-iteration-'));
const write = (path, content) => writeFileSync(join(root, path), content);
mkdirSync(join(root, 'src/app/study'), {recursive:true});
for (const dir of ['components','lib','types']) cpSync(resolve('src',dir),join(root,'src',dir),{recursive:true});
symlinkSync(resolve('node_modules'),join(root,'node_modules'));
cpSync('tsconfig.json',join(root,'tsconfig.json'));
cpSync('postcss.config.mjs',join(root,'postcss.config.mjs'));
cpSync('src/app/globals.css',join(root,'src/app/globals.css'));
mkdirSync(join(root,'public'),{recursive:true});
write('package.json' ,JSON.stringify({private:true,scripts:{dev:'next dev'},dependencies:{next:'16.1.1',react:'19.2.3','react-dom':'19.2.3'}}));
write('src/app/layout.tsx',`import './globals.css';export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}`);
write('src/app/actions.ts',`"use server";
export async function saveCaptionVote(){await new Promise(r=>setTimeout(r,400)); return {success:true};}
export async function removeCaptionVote(){await new Promise(r=>setTimeout(r,400)); return {success:true};}
export async function saveCaptionNavigationEvent(){return {success:true};}
export async function loadMoreCaptionVoteCaptions(){return {success:true,captions:[]};}`);
write('src/app/study/actions.ts',`"use server";
export async function startStudy(){return {success:true,participation:{started_at:new Date().toISOString(),ended_at:null}};}
export async function endStudy(_studyId:number,stats:any){return {success:true,participation:{started_at:new Date().toISOString(),ended_at:new Date().toISOString(),completion_stats:stats}};}`);
write('src/app/page.tsx',`"use client";
import {CaptionVoteFlow} from '@/components/CaptionVoteFlow';
import {CompletedStudy} from '@/components/CompletedStudy';
import {useState} from 'react';
const captions=${JSON.stringify(previewCaptions)};
export default function Page(){const [summary,setSummary]=useState(false);return <main className="flex h-svh flex-col p-4 text-[var(--foreground)]"><header className="flex shrink-0 justify-between gap-2 text-xs"><span>Iteration 1 · teaching study images · simulated saves</span><button onClick={()=>setSummary(!summary)}>Toggle sample summary</button></header><div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 items-center justify-center">{summary?<CompletedStudy participation={{completion_stats:{likedCount:8,viewedCount:22,medianVoteTimeMs:4953,medianNavigationTimeMs:9193},started_at:'2026-11-05T10:00:00Z',ended_at:'2026-11-05T10:05:00Z'} as any}/>:<CaptionVoteFlow captionOrder={captions.map(c=>c.id)} captions={captions} initialNextOffset={null} initialTotalCaptionCount={captions.length} initialParticipation={null} studyId={122}/>}</div></main>}`);
console.log('Teaching-image preview: http://127.0.0.1:3016 (temporary directory '+root+')');
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3016'],{cwd:root,stdio:'inherit'});
process.on('SIGINT',()=>child.kill('SIGTERM'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>process.exit(code??0));
