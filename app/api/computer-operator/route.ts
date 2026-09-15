import { NextResponse } from 'next/server';
import { planComputerOperatorStep } from '@/lib/computer-operator';
import { enqueueDeviceCommand, listDeviceCommands, type DeviceCommandType } from '@/lib/device-control';
import { listCompanionDevices } from '@/lib/principal-authority';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime='nodejs'; export const maxDuration=90;
const EXECUTABLE=new Set<DeviceCommandType>(['screen_describe','browser_open','open_app','type_text','key_press','mouse_click']);

export async function GET(request:Request){const context=await requireZeroTrustAuthority(request,'read_context');if(!context)return NextResponse.json({error:'Authorized principal session is required.'},{status:401});const devices=(await listCompanionDevices(context.profileId)).filter((d)=>d.status==='active');return NextResponse.json({devices,commands:(await listDeviceCommands(context.profileId,80)).filter((c)=>EXECUTABLE.has(c.type))},{headers:{'Cache-Control':'no-store, private'}});}

export async function POST(request:Request){const context=await requireZeroTrustAuthority(request,'control_devices');if(!context)return NextResponse.json({error:'Device-control permission is required.'},{status:403});const body=await request.json().catch(()=>null) as Record<string,unknown>|null;const action=typeof body?.action==='string'?body.action:'';try{
 if(action==='plan'){const history=Array.isArray(body?.history)?body.history.filter((x):x is {type:string;summary:string;result?:string}=>Boolean(x&&typeof x==='object'&&typeof (x as {type?:unknown}).type==='string'&&typeof (x as {summary?:unknown}).summary==='string')).slice(-12):[];const step=await planComputerOperatorStep({objective:typeof body?.objective==='string'?body.objective:'',screenDescription:typeof body?.screenDescription==='string'?body.screenDescription:undefined,history});return NextResponse.json({ok:true,step});}
 if(action==='execute-step'){const deviceId=typeof body?.deviceId==='string'?body.deviceId.trim().slice(0,96):'';const type=typeof body?.type==='string'?body.type as DeviceCommandType:'screen_describe';if(!deviceId||!EXECUTABLE.has(type))return NextResponse.json({error:'A valid device and computer-operator command are required.'},{status:400});const devices=(await listCompanionDevices(context.profileId)).filter((d)=>d.status==='active');const device=devices.find((d)=>d.id===deviceId);if(!device)return NextResponse.json({error:'Target companion is not active.'},{status:400});if(!device.allowedCommands.includes(type))return NextResponse.json({error:`This companion is not enrolled for ${type}.`},{status:403});const command=await enqueueDeviceCommand(context.profileId,type,typeof body?.target==='string'?body.target:undefined,{targetDeviceId:deviceId,requestedByPrincipalId:context.principal.id,allowWithoutLegacyAgent:true});return NextResponse.json({ok:true,command});}
 return NextResponse.json({error:'Unsupported computer-operator action.'},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Computer operator failed.'},{status:400});}}
