import { NextResponse } from 'next/server';
import { runHermesTradingMission } from '@/lib/hermes-trading';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function profileFrom(request:Request) {
  const token=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length+1);
  return verifyProfileToken(token);
}

export async function POST(request:Request) {
  if (!profileFrom(request)) return NextResponse.json({error:'Identity not established.'},{status:401});
  try {
    const body=await request.json() as {objective?:string;universe?:string;horizon?:string;riskBudget?:string;context?:string};
    const objective=(body.objective||'').trim();
    if (!objective) return NextResponse.json({error:'objective is required.'},{status:400});
    const result=await runHermesTradingMission({objective,universe:body.universe?.trim(),horizon:body.horizon?.trim(),riskBudget:body.riskBudget?.trim(),context:body.context?.trim()});
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store, private'}});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:'Trading mission failed.'},{status:500});
  }
}
