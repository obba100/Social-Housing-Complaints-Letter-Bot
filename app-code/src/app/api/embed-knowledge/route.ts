// app-code/src/app/api/analyze-file/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { Formidable } from 'formidable';
import fs from 'fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// This tells Next.js how to handle the file upload stream
export const config = {
  api: { bodyParser: false },
};

// Function to extract text from a PDF buffer
async function getTextFromPdf(dataBuffer: Buffer) {
    // We need to provide a workerSrc for pdfjs to work in this environment
    pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;
    
    const doc = await pdfjs.getDocument(dataBuffer).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ');
    }
    return text;
}

export async function POST(req: NextRequest) {
  try {
    // Using Formidable to parse the incoming file data
    const form = new Formidable();
    const [fields, files] = await form.parse(req as any);
    const file = files.file?.[0];

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    let analysis = '';
    // Read the file from its temporary path
    const fileBuffer = await fs.readFile(file.filepath);

    if (file.mimetype?.startsWith('image/')) {
      // It's an image - send to GPT-4o Vision for analysis
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image in detail as if it were evidence for a housing complaint. Be objective and factual. Do not offer advice, just describe what you see.' },
              { type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${fileBuffer.toString('base64')}` } },
            ],
        }],
      });
      analysis = response.choices[0].message.content || 'Could not analyze image.';
    } else if (file.mimetype === 'application/pdf') {
      // It's a PDF - extract the text content
      analysis = await getTextFromPdf(fileBuffer);
    } else {
      // Clean up the temp file before returning an error
      await fs.unlink(file.filepath);
      return NextResponse.json({ error: 'Unsupported file type. Please upload an image or PDF.' }, { status: 400 });
    }

    // IMPORTANT: Clean up the temporary file from the server's memory
    await fs.unlink(file.filepath);

    return NextResponse.json({ analysis });

  } catch (error) {
    console.error('Error analyzing file:', error);
    return NextResponse.json({ error: 'Failed to analyze file.' }, { status: 500 });
  }
}