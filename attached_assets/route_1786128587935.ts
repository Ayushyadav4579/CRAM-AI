import {NextResponse} from 'next/server';
import {GoogleGenerativeAI} from '@google/generative-ai';
import {buildPrompt} from '@/lib/prompt';

export async function POST(req:Request){
 try{
  const body=await req.json();
  if(!body.text||body.text.length<30)return NextResponse.json({error:'Add more study material.'},{status:400});
  if(!process.env.GEMINI_API_KEY)return NextResponse.json({error:'Add GEMINI_API_KEY to .env.local.'},{status:500});
  const ai=new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model=ai.getGenerativeModel({model:'gemini-2.5-flash'});
  const result=await model.generateContent(buildPrompt(body));
  let raw=result.response.text().trim().replace(/^```json\s*/,'').replace(/```$/,'').trim();
  try{return NextResponse.json(JSON.parse(raw))}
  catch{return NextResponse.json({title:'Study Pack',summary:'Generated response',topics:[],sections:[{type:'raw',title:'AI Output',items:[raw]}]})}
 }catch(e:any){return NextResponse.json({error:e?.message||'Generation failed'},{status:500})}
}