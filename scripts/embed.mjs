// scripts/embed.mjs
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; 

// --- CONFIGURATION ---
// ❗️ You need to fill in your 3 secret keys.

const SUPABASE_URL = 'https://ofixbnsaxwmsqltqjcfu.supabase.co/';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9maXhibnNheHdtc3FsdHFqY2Z1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDQzMzcxOCwiZXhwIjoyMDcwMDA5NzE4fQ.KMbhHoalTLm_0lq6ylpBRo99AQRL1wQMIA4AoLaxJOo';
const OPENAI_KEY = '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';

const sources = [
    // --- Your list of websites ---
    'https://www.housing-ombudsman.org.uk/landlords-info/complaint-handling-code/the-code-2024/',
    'https://www.housing-ombudsman.org.uk/app/uploads/2024/09/03.Complaint-Handling-Code-24.pdf',
    'https://www.housing-ombudsman.org.uk/wp-content/uploads/2024/03/Understand-your-rights-as-a-resident.pdf',
    'https://www.legislation.gov.uk/ukpga/2018/34',
    'https://www.legislation.gov.uk/ukpga/2010/15/enacted?view=extent',
    'https://www.legislation.gov.uk/ukpga/2010/15?view=extent',
    'https://www.legislation.gov.uk/ukpga/2018/12/enacted?view=extent',
    'https://www.legislation.gov.uk/ukpga/1974/7/enacted',
    'https://www.legislation.gov.uk/ukpga/2022/30/enacted',
    'https://www.gov.uk/government/publications/awaabs-law-draft-guidance-for-social-landlords/awaabs-law-draft-guidance-for-social-landlords',
    'https://www.gov.uk/government/publications/neighbourhood-and-community-standard',
    'https://www.gov.uk/government/publications/safety-and-quality-standard',
    'https://www.gov.uk/government/publications/tenancy-standard',
    'https://www.gov.uk/government/collections/transparency-influence-and-accountability-including-tenant-satisfaction-measures',
    'https://www.gov.uk/government/publications/consumer-standards-code-of-practice',
    'https://www.gov.uk/government/publications/governance-and-financial-viability-standard',
    'https://www.gov.uk/government/collections/rent-standard-and-guidance',
    'https://www.gov.uk/government/publications/value-for-money-standard'
];

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// --- END OF CONFIGURATION ---

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_KEY });

async function chunkText(text) {
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(text.substring(i, i + CHUNK_SIZE));
    }
    return chunks;
}

async function getTextFromPdf(dataBuffer) {
    const doc = await pdfjs.getDocument(dataBuffer).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ');
    }
    return text;
}

async function processSources() {
    console.log('Processing sources...');
    let allChunks = [];

    for (const source of sources) {
        let text;
        try {
            if (source.startsWith('http')) {
                console.log(`Fetching: ${source}`);
                const response = await fetch(source);
                if (!response.ok) throw new Error(`Failed to fetch with status: ${response.status}`);
                
                if (source.endsWith('.pdf')) {
                    const arrayBuffer = await response.arrayBuffer();
                    text = await getTextFromPdf(new Uint8Array(arrayBuffer));
                } else {
                    const html = await response.text();
                    const $ = cheerio.load(html);
                    $('script, style, nav, footer, header, a[href^="#"]').remove();
                    text = $('body').text().replace(/\s\s+/g, ' ').trim();
                }
            } else {
                console.log(`Parsing local PDF: ${source}`);
                const filePath = path.join(import.meta.dirname, source);
                const dataBuffer = await fs.readFile(filePath);
                text = await getTextFromPdf(dataBuffer);
            }
            const chunks = await chunkText(text);
            allChunks = allChunks.concat(chunks);
            console.log(`Added ${chunks.length} chunks from ${source}`);
        } catch (e) {
            console.error(`Failed to process ${source}:`, e.message);
            continue;
        }
    }

    if (allChunks.length === 0) {
        console.log("\nNo chunks were generated. Please check your `sources` array and API keys.");
        return;
    }

    console.log(`\nTotal chunks to embed: ${allChunks.length}`);
    console.log('Creating embeddings and storing in Supabase...');

    for (let i = 0; i < allChunks.length; i += 50) {
        const batch = allChunks.slice(i, i + 50);
        try {
            const embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-small', input: batch,
            });
            const records = embeddingResponse.data.map((embedding, index) => ({
                content: batch[index], embedding: embedding.embedding,
            }));
            const { error } = await supabase.from('documents').insert(records);
            if (error) throw error;
            console.log(`Successfully stored batch ${Math.ceil(i/50) + 1} of ${Math.ceil(allChunks.length/50)}`);
        } catch (e) {
            console.error(`Error storing batch ${Math.ceil(i/50) + 1}:`, e.message);
        }
    }
    console.log('\n✅ Knowledge base update complete!');
}

processSources();