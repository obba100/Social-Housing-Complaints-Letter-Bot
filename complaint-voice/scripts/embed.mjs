// scripts/embed.mjs

// 1) Load secrets from .env.local
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// 2) Deps
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as cheerio from "cheerio";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Try to use pdfjs legacy Node build
let pdfjs = null;
let pdfEnabled = true;
try {
  pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = undefined;
  }
} catch (err) {
  pdfEnabled = false;
  console.warn(
    "⚠️  PDF support disabled (pdfjs or canvas not available). " +
      "HTML sources will still be processed. To enable PDF ingestion later: " +
      "npm i pdfjs-dist canvas"
  );
}

/* -------------------------- ENV -------------------------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_API_KEY) {
  console.error(
    "❌ Missing environment variables. Please set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE, and OPENAI_API_KEY in .env.local"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ---------------------- YOUR SOURCES ---------------------- */
const sources = [
  // Housing Ombudsman + PDFs
  "https://www.housing-ombudsman.org.uk/landlords-info/complaint-handling-code/the-code-2024/",
  "https://www.housing-ombudsman.org.uk/app/uploads/2024/09/03.Complaint-Handling-Code-24.pdf",
  "https://www.housing-ombudsman.org.uk/wp-content/uploads/2024/03/Understand-your-rights-as-a-resident.pdf",
  // Legislation
  "https://www.legislation.gov.uk/ukpga/2018/34",
  "https://www.legislation.gov.uk/ukpga/2010/15/enacted?view=extent",
  // "https://www.legislation.gov.uk/ukpga/2010/15?view=extent", // <-- Removed duplicate URL
  "https://www.legislation.gov.uk/ukpga/2018/12/enacted?view=extent",
  "https://www.legislation.gov.uk/ukpga/1974/7/enacted",
  "https://www.legislation.gov.uk/ukpga/2022/30/enacted",
  // Regulator / Gov standards & guidance
  "https://www.gov.uk/government/publications/awaabs-law-draft-guidance-for-social-landlords/awaabs-law-draft-guidance-for-social-landlords",
  "https://www.gov.uk/government/publications/neighbourhood-and-community-standard",
  "https://www.gov.uk/government/publications/safety-and-quality-standard",
  "https://www.gov.uk/government/publications/tenancy-standard",
  "https://www.gov.uk/government/collections/transparency-influence-and-accountability-including-tenant-satisfaction-measures",
  "https://www.gov.uk/government/publications/consumer-standards-code-of-practice",
  "https://www.gov.uk/government/publications/governance-and-financial-viability-standard",
  "https://www.gov.uk/government/collections/rent-standard-and-guidance",
  "https://www.gov.uk/government/publications/value-for-money-standard",
];

/* ------------------------ SETTINGS ------------------------ */
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 50;

/* ------------------------ HELPERS ------------------------- */
function normalizeWhitespace(s) {
  return s.replace(/\u00a0/g, " ").replace(/\s\s+/g, " ").trim();
}

async function fetchTextFromHtml(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  $('a[href^="#"]').remove();
  return normalizeWhitespace($("body").text());
}

async function fetchTextFromPdf(url) {
  if (!pdfEnabled || !pdfjs) {
    console.warn("   (skip PDF; pdf backend unavailable):", url);
    return "";
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const ab = await res.arrayBuffer();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(ab),
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str || "").join(" ") + "\n";
  }
  return normalizeWhitespace(text);
}

function chunkText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

/* -------------------------- MAIN -------------------------- */
async function run() {
  console.log(`[embed] starting… sources: ${sources.length}`);

  const allChunks = [];

  for (const src of sources) {
    try {
      console.log("→ fetching", src);
      let text = "";
      if (src.toLowerCase().endsWith(".pdf")) {
        text = await fetchTextFromPdf(src);
      } else {
        text = await fetchTextFromHtml(src);
      }

      if (!text || text.length < 50) {
        console.warn("   (skip: very short or empty)", src);
        continue;
      }

      const chunks = chunkText(text);
      chunks.forEach((c) => allChunks.push({ source: src, content: c }));
      console.log(`   ✓ ${chunks.length} chunks`);
    } catch (e) {
      console.error("   ✗ failed:", src, "-", e?.message || e);
    }
  }

  if (allChunks.length === 0) {
    console.log("No chunks produced. Check sources and connectivity.");
    return;
  }
  
  // --- DE-DUPLICATION STEP ---
  console.log(`\n[embed] De-duplicating ${allChunks.length} chunks...`);
  const chunkMap = new Map();
  allChunks.forEach(chunk => {
    chunkMap.set(chunk.content, chunk);
  });
  const uniqueChunks = Array.from(chunkMap.values());
  console.log(`[embed] Found ${uniqueChunks.length} unique chunks.`);
  // --- END OF STEP ---

  console.log(
    `[embed] Creating embeddings & upserting into Supabase…`
  );

  for (let i = 0; i < uniqueChunks.length; i += BATCH_SIZE) {
    const batch = uniqueChunks.slice(i, i + BATCH_SIZE);

    let emb;
    try {
      emb = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch.map((b) => b.content),
      });
    } catch (e) {
      console.error(`   ✗ embedding error @${i}-${i + batch.length - 1}:`, e?.message || e);
      continue;
    }

    const rows = batch.map((b, j) => ({
      content: b.content,
      embedding: emb.data[j].embedding,
      metadata: {
        source: b.source,
      },
    }));

    const { error } = await supabase.from("documents").upsert(rows, {
      onConflict: 'content'
    });

    if (error) {
      console.error(`   ✗ upsert error @${i}-${i + batch.length - 1}:`, error.message);
    } else {
      console.log(`   ✓ stored ${i + 1}–${i + batch.length} / ${uniqueChunks.length}`);
    }
  }

  console.log("\n✅✅✅ KNOWLEDGE BASE EMBEDDED SUCCESSFULLY! ✅✅✅");
}

run().catch((err) => {
  console.error("Fatal:", err?.message || err);
  process.exit(1);
});