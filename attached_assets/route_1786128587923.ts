import {NextResponse} from 'next/server';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

export async function POST(req:Request){
 try{
  const form=await req.formData(); const file=form.get('file');
  if(!(file instanceof File)) return NextResponse.json({error:'No file supplied'},{status:400});
  const name=file.name.toLowerCase(); const buf=Buffer.from(await file.arrayBuffer());
  let text='';
  if(name.endsWith('.txt')||name.endsWith('.md')) text=buf.toString('utf8');
  else if(name.endsWith('.pdf')) text=(await pdf(buf)).text;
  else if(name.endsWith('.docx')) text=(await mammoth.extractRawText({buffer:buf})).value;
  else return NextResponse.json({error:'Supported formats: PDF, DOCX, TXT, MD.'},{status:415});
  text=text.replace(/\s+/g,' ').trim();
  if(!text) return NextResponse.json({error:'No readable text found. Scanned PDFs need OCR.'},{status:422});
  if(text.length>180000) text=text.slice(0,180000);
  return NextResponse.json({name:file.name,text,characters:text.length});
 }catch(e:any){return NextResponse.json({error:e?.message||'Extraction failed'},{status:500})}
}