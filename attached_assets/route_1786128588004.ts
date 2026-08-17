import {NextResponse} from 'next/server';
import {GoogleGenerativeAI} from '@google/generative-ai';

export async function POST(req:Request){
  try{
    const {text,mode='detailed',language='English',count=20,types=[]}=await req.json();
    if(!text || text.length<20) return NextResponse.json({error:'Please provide more study material.'},{status:400});
    if(text.length>120000) return NextResponse.json({error:'Material is too large for this starter. Add chunking/RAG for large books.'},{status:413});
    if(!process.env.GEMINI_API_KEY) return NextResponse.json({error:'Missing GEMINI_API_KEY in .env.local'},{status:500});
    const ai=new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model=ai.getGenerativeModel({model:'gemini-2.5-flash'});
    const prompt=`You are CRAM AI, an expert educational content generator.
Create a structured study pack ONLY from the supplied source material. Do not invent facts.
Difficulty: ${mode}. Output language: ${language}. Requested question count: ${count}.
Requested formats: ${types.join(', ')}.
For MCQs include 4 options and the correct answer plus a brief explanation.
For short answers give concise exam-ready answers.
For long answers give well-structured answers with key points.
For notes use headings, bullets, definitions and examples when supported.
For formulas include symbols and meaning when present in the source.
For flashcards use front/back.
For fill-in-the-blanks provide answer keys.
For true/false provide answers.
For mind maps use a clear text hierarchy.
Return valid JSON only with a top-level "sections" array. Each section must contain "type", "title", and "items". Avoid markdown fences.

SOURCE MATERIAL:
${text}`;
    const out=await model.generateContent(prompt);
    let raw=out.response.text().trim().replace(/^```json\s*/,'').replace(/```$/,'').trim();
    let data; try{data=JSON.parse(raw)}catch{data={sections:[{type:'raw',title:'Generated Study Pack',items:[raw]}]}}
    return NextResponse.json(data);
  }catch(e:any){return NextResponse.json({error:e?.message||'AI generation failed'},{status:500})}
}