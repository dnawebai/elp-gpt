import { NextResponse } from 'next/server';
import { ELP_AGENTS, runSeriousMission } from '@/lib/agent-swarm';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime='nodejs';
export const maxDuration=60;

function profileFrom(request:Request){
  const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length+1);
  return verifyProfileToken(token);
}

export async function GET(request:Request){
  if(!profileFrom(request)) return NextResponse.json({error:'Identity not established.'},{status:401});
  return NextResponse.json({mode:'serious',agents:ELP_AGENTS,count:ELP_AGENTS.length},{headers:{'Cache-Control':'no-store, private'}});
}

export async function POST(request:Request){
  if(!profileFrom(request)) return NextResponse.json({error:'Identity not established.'},{status:401});
  const body=await request.json().catch(()=>null) as {objective?:string;context?:string;maxAgents?:number}|null;
  const objective=body?.objective?.trim();
  if(!objective) return NextResponse.json({error:'objective is required.'},{status:400});
  if(objective.length>6000 || (body?.context?.length||0)>18000) return NextResponse.json({error:'Mission input is too large.'},{status:413});
  try{
    const mission=await runSeriousMission({objective,context:body?.context||'',maxAgents:body?.maxAgents});
    return NextResponse.json(mission,{headers:{'Cache-Control':'no-store, private'}});
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:'Serious Mode failed.'},{status:502});
  }
}
