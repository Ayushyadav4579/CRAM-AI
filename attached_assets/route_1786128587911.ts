import {NextResponse} from 'next/server';
import {GoogleGenerativeAI} from '@google/generative-ai';
export async function POST(req:Request){
 try{
  const {text,question}=await req.json();
  if(!text||!question)return NextResponse.json({error:'Missing document or question'},{status:400});
  if(!process.env.GEMINI_API_KEY)return NextResponse.json({error:'Missing GEMINI_API_KEY'},{status:500});
  const model=new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({model:'gemini-2.5-flash'});
  const r=await model.generateContent(`Answer the student's question using ONLY this document. If it is not in the document, say so. Explain simply.\nDOCUMENT:\n${text.slice(0,180000)}\nQUESTION:\n${question}`);
  return NextResponse.json({answer:r.response.text()});
 }catch(e:any){return NextResponse.json({error:e?.message||'Chat failed'},{status:500})}
}