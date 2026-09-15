import { NextResponse } from 'next/server';
import { getMarketConnectorStatus } from '@/lib/market-connectors';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime='nodejs';

function profileFrom(request:Request){
  const token=(request.headers.get('cookie')||'').split(';').map((part)=>part.trim()).find((part)=>part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length+1);
  return verifyProfileToken(token);
}

export async function GET(request:Request){
  if(!profileFrom(request)) return NextResponse.json({error:'Identity not established.'},{status:401});
  const connectors=getMarketConnectorStatus();
  return NextResponse.json({connectors,ready:connectors.filter((connector)=>connector.runtimeReady).map((connector)=>connector.id)},{headers:{'Cache-Control':'private, no-store'}});
}
