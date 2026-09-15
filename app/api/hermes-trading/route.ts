import { NextRequest, NextResponse } from 'next/server';
import { runHermesTradingMission } from '@/lib/hermes-trading';
import { requireProfileToken } from '@/lib/security';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:NextRequest){
  try{
    const profile=await requireProfileToken(request);
    const body=await request.json() as {objective?:string;universe?:string;horizon?:string;riskBudget?:string;context?:string};
    if(!body.objective?.trim()) return NextResponse.json({error:'objective is required'},{status:400});
    const result=await runHermesTradingMission(profile.profileId,{objective:body.objective.trim(),universe:body.universe?.trim(),horizon:body.horizon?.trim(),riskBudget:body.riskBudget?.trim(),context:body.context?.trim()});
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Hermes Trading Mode failed.';
    const status=/auth|token|session|profile/i.test(message)?401:500;
    return NextResponse.json({error:message},{status,headers:{'Cache-Control':'private, no-store'}});
  }
}
